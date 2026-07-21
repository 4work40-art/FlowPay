const express = require('express');
const multer  = require('multer');
const path    = require('path');
const { createHash } = require('crypto');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { readSheetRows } = require('../lib/spreadsheetReader');

const {
  parseCsv, is1CFormat, parse1C, decodeStatement,
  parseAmountToKopecks, purposeContainsNumber, normalizeStatementRows,
} = require('../lib/statementParse');

const router = express.Router();
const STATEMENT_ALLOWED_MIME = new Set([
  'text/csv', 'application/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = ['.csv', '.txt', '.xlsx', '.xls'].includes(ext);
    if (!STATEMENT_ALLOWED_MIME.has(file.mimetype) && !extOk)
      return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
});

router.post('/bank-import', authMiddleware, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message = uploadErr.message === 'UNSUPPORTED_TYPE'
        ? 'Разрешены только CSV, TXT (1С-обмен) и Excel (.xlsx, .xls)'
        : uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 10 МБ' : 'Не удалось прочитать файл';
      return err(res, 400, message, 'VALIDATION_ERROR');
    }
    if (!req.file) return err(res, 400, 'Файл не передан', 'VALIDATION_ERROR');

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const isExcel = ext === '.xlsx' || ext === '.xls' ||
    req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    req.file.mimetype === 'application/vnd.ms-excel';

  let rows;
  try {
    if (isExcel) {
      // Выписки Excel — у каждого банка своя раскладка колонок (Сбербизнес,
      // Тинькофф, Альфа, ВТБ, Точка, Модульбанк и др.) — приводим к общему
      // виду по смыслу заголовков, а не по фиксированным индексам.
      const { rows: sheetRows } = await readSheetRows(req.file.buffer);
      rows = normalizeStatementRows(sheetRows);
    } else {
      const text = decodeStatement(req.file.buffer);
      if (is1CFormat(text)) {
        // 1CClientBankExchange — единый стандарт выгрузки для всех банков
        // РФ (не зависит от конкретного банка), формат уже канонический.
        rows = parse1C(text);
      } else {
        rows = normalizeStatementRows(parseCsv(text));
      }
    }
  } catch (e) {
    return err(res, 400, 'Не удалось прочитать файл — ожидается CSV, Excel-выписка или 1CClientBankExchange', 'VALIDATION_ERROR');
  }
  if (!rows.length) return err(res, 400, 'Файл пуст или не содержит документов', 'VALIDATION_ERROR');

  // Заголовок без опознаваемых нами колонок (узкий легаси-CSV без шапки) —
  // старая эвристика: пропускаем первую строку, если у неё "сумма" не число.
  if (rows.length > 1 && parseAmountToKopecks(rows[0][1] || '') === null) rows = rows.slice(1);

  const orgId = req.user.org_id;
  const invoices = await pool.query(
    `SELECT id, number, amount_kopecks, paid_kopecks, status FROM invoices
     WHERE org_id = $1 AND status NOT IN ('DISPUTED','ARCHIVED','WRITTEN_OFF','PAID')`,
    [orgId]
  );

  const matched = [];
  const unmatched = [];
  const skipped = [];

  // Ключ идемпотентности строки выписки — проверяем ДО сопоставления,
  // иначе уже оплаченный при прошлом импорте счёт выпадает из кандидатов
  // и дубль ошибочно попадает в «не сопоставлено».
  const keyOf = (dateRaw, amountKopecks, purpose) => createHash('sha256')
    .update(`${orgId}|${dateRaw}|${amountKopecks}|${(purpose || '').trim()}`)
    .digest('hex');
  const allKeys = rows
    .map(r => {
      const amt = parseAmountToKopecks(r[1] || '');
      return r[0] && amt !== null ? keyOf(r[0], amt, r[2]) : null;
    })
    .filter(Boolean);
  const existing = allKeys.length
    ? await pool.query(
        `SELECT import_key FROM payments WHERE org_id=$1 AND import_key = ANY($2)`,
        [orgId, allKeys]
      )
    : { rows: [] };
  const alreadyImported = new Set(existing.rows.map(r => r.import_key));

  // Одно соединение на весь файл (а не на строку) — большая выписка не
  // исчерпывает пул; каждая строка остаётся отдельной транзакцией.
  const client = await pool.connect();
  try {
  for (const row of rows) {
    const [dateRaw, amountRaw, purpose] = row;
    const amountKopecks = parseAmountToKopecks(amountRaw || '');
    if (!dateRaw || amountKopecks === null) {
      unmatched.push({ raw: row.join(';'), reason: 'Не удалось разобрать дату/сумму' });
      continue;
    }

    const importKey = keyOf(dateRaw, amountKopecks, purpose);
    if (alreadyImported.has(importKey)) {
      skipped.push({ raw: row.join(';'), reason: 'Эта строка выписки уже была импортирована ранее' });
      continue;
    }
    alreadyImported.add(importKey); // дубль внутри одного файла тоже не проводим дважды

    // Сопоставляем по номеру счёта, встречающемуся в назначении платежа —
    // не по сумме (частичные оплаты меняют логику сравнения).
    const candidates = invoices.rows.filter(inv =>
      inv.number && purpose && purposeContainsNumber(purpose, inv.number) &&
      amountKopecks <= (inv.amount_kopecks - inv.paid_kopecks)
    );

    if (!candidates.length) {
      unmatched.push({ raw: row.join(';'), reason: 'Счёт не найден по номеру в назначении платежа' });
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push({
        raw: row.join(';'),
        reason: `Назначение платежа подходит сразу к нескольким счетам (${candidates.map(c => '№' + c.number).join(', ')}) — проведите платёж вручную`,
      });
      continue;
    }
    const candidate = candidates[0];

    try {
      await client.query('BEGIN');
      const invLock = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [candidate.id]);
      const inv = invLock.rows[0];
      // pg возвращает BIGINT-колонки строками — без явного приведения
      // `inv.paid_kopecks + amountKopecks` даёт конкатенацию строк.
      inv.amount_kopecks = Number(inv.amount_kopecks);
      inv.paid_kopecks   = Number(inv.paid_kopecks);
      const remaining = inv.amount_kopecks - inv.paid_kopecks;
      if (amountKopecks > remaining) {
        await client.query('ROLLBACK');
        unmatched.push({ raw: row.join(';'), reason: `Сумма больше остатка по счёту №${inv.number}` });
        continue;
      }

      const payRows = await client.query(`
        INSERT INTO payments(invoice_id, org_id, amount_kopecks, method, reference, payment_date, created_by, import_key)
        VALUES($1,$2,$3,'bank_transfer',$4,$5,$6,$7)
        ON CONFLICT (org_id, import_key) WHERE import_key IS NOT NULL DO NOTHING
        RETURNING id
      `, [inv.id, orgId, amountKopecks, (purpose || '').slice(0, 255), dateRaw, req.user.id, importKey]);

      if (!payRows.rows.length) {
        await client.query('ROLLBACK');
        skipped.push({ raw: row.join(';'), reason: 'Эта строка выписки уже была импортирована ранее' });
        continue;
      }

      const newPaid = inv.paid_kopecks + amountKopecks;
      const newStatus = newPaid >= inv.amount_kopecks ? 'PAID' : 'PARTIALLY_PAID';
      await client.query('UPDATE invoices SET paid_kopecks=$1, status=$2, updated_at=NOW() WHERE id=$3',
        [newPaid, newStatus, inv.id]);
      await client.query('COMMIT');

      await audit(orgId, req.user.id, 'payment.imported_from_bank', 'payment', payRows.rows[0].id,
        null, { invoice_number: inv.number, amount_kopecks: amountKopecks });

      matched.push({ invoice_number: inv.number, amount_kopecks: amountKopecks, date: dateRaw });
      // Обновляем локальный остаток, чтобы следующая строка того же счёта видела актуальный paid_kopecks
      candidate.paid_kopecks = newPaid;
      candidate.status = newStatus;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      unmatched.push({ raw: row.join(';'), reason: 'Ошибка сохранения платежа' });
    }
  }
  } finally {
    client.release();
  }

  return ok(res, {
    matched_count: matched.length, unmatched_count: unmatched.length,
    skipped_count: skipped.length, matched, unmatched, skipped,
  });
  });
});

module.exports = router;
