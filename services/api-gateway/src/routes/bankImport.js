const express = require('express');
const multer  = require('multer');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Простой CSV-парсер под формат выписки: дата;сумма;назначение платежа
// (разделитель ; или , — оба часто встречаются у банков РФ). Без внешних
// библиотек — формат намеренно узкий и предсказуемый.
function parseCsv(text) {
  const delimiter = text.includes(';') ? ';' : ',';
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, '')));
}

function parseAmountToKopecks(raw) {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

router.post('/bank-import', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return err(res, 400, 'Файл не передан', 'VALIDATION_ERROR');

  let rows;
  try {
    rows = parseCsv(req.file.buffer.toString('utf-8'));
  } catch (e) {
    return err(res, 400, 'Не удалось прочитать файл — ожидается CSV', 'VALIDATION_ERROR');
  }
  if (!rows.length) return err(res, 400, 'Файл пуст', 'VALIDATION_ERROR');

  // Первая строка может быть заголовком — пропускаем, если первая "сумма"
  // не парсится как число.
  if (rows.length > 1 && parseAmountToKopecks(rows[0][1] || '') === null) rows = rows.slice(1);

  const orgId = req.user.org_id;
  const invoices = await pool.query(
    `SELECT id, number, amount_kopecks, paid_kopecks, status FROM invoices
     WHERE org_id = $1 AND status NOT IN ('DISPUTED','ARCHIVED','WRITTEN_OFF','PAID')`,
    [orgId]
  );

  const matched = [];
  const unmatched = [];

  for (const row of rows) {
    const [dateRaw, amountRaw, purpose] = row;
    const amountKopecks = parseAmountToKopecks(amountRaw || '');
    if (!dateRaw || amountKopecks === null) {
      unmatched.push({ raw: row.join(';'), reason: 'Не удалось разобрать дату/сумму' });
      continue;
    }

    // Сопоставляем по номеру счёта, встречающемуся в назначении платежа —
    // не по сумме (частичные оплаты меняют логику сравнения).
    const candidate = invoices.rows.find(inv =>
      inv.number && purpose && purpose.includes(inv.number) &&
      amountKopecks <= (inv.amount_kopecks - inv.paid_kopecks)
    );

    if (!candidate) {
      unmatched.push({ raw: row.join(';'), reason: 'Счёт не найден по номеру в назначении платежа' });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invLock = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [candidate.id]);
      const inv = invLock.rows[0];
      const remaining = inv.amount_kopecks - inv.paid_kopecks;
      if (amountKopecks > remaining) {
        await client.query('ROLLBACK');
        unmatched.push({ raw: row.join(';'), reason: `Сумма больше остатка по счёту №${inv.number}` });
        continue;
      }

      const payRows = await client.query(`
        INSERT INTO payments(invoice_id, org_id, amount_kopecks, method, reference, payment_date, created_by)
        VALUES($1,$2,$3,'bank_transfer',$4,$5,$6) RETURNING id
      `, [inv.id, orgId, amountKopecks, (purpose || '').slice(0, 255), dateRaw, req.user.id]);

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
    } finally {
      client.release();
    }
  }

  return ok(res, { matched_count: matched.length, unmatched_count: unmatched.length, matched, unmatched });
});

module.exports = router;
