const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { randomUUID } = require('crypto');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { UPLOAD_DIR } = require('../lib/storage');
const { recognize } = require('../lib/documentRecognizer');
const { purposeContainsNumber } = require('../lib/statementParse');
const { parseCsvRegister, parseExcelRegister, MAX_ROWS } = require('../lib/registerParse');
const { rateLimit } = require('../lib/rateLimit');

const router = express.Router();

const recognizeLimiter = rateLimit({
  keyFn: (req) => `recognize:${req.user?.org_id}`,
  max: 30, windowSeconds: 60 * 60,
  message: 'Слишком много запросов на распознавание документов, попробуйте позже',
});
const RECOGNIZE_ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls (в т.ч. устаревший бинарный формат)
  'text/csv', 'application/csv',
]);
const recognizeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Многие учётные системы печатают счёт в файл электронной таблицы
    // вместо PDF — тоже нужно принимать и распознавать как один документ
    // (не путать со страницей «Импорт реестра», где Excel — таблица счетов).
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = ['.xlsx', '.xls', '.csv'].includes(ext);
    if (!RECOGNIZE_ALLOWED_MIME.has(file.mimetype) && !extOk)
      return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
});

// Распознавание счёта на оплату / платёжного поручения из файла (PDF с
// текстовым слоем — напрямую, скан/фото — через OCR, Excel/CSV — как один
// документ той же логикой). Результат — черновик для проверки на форме
// создания счёта/платежа, ничего не сохраняется здесь.
router.post('/documents/recognize', authMiddleware, recognizeLimiter, (req, res) => {
  recognizeUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message = uploadErr.message === 'UNSUPPORTED_TYPE'
        ? 'Разрешены только PDF, JPG, PNG, XLSX, XLS и CSV'
        : uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 15 МБ' : 'Не удалось прочитать файл';
      return err(res, 400, message, 'VALIDATION_ERROR');
    }
    if (!req.file) return err(res, 400, 'Файл не передан', 'VALIDATION_ERROR');

    try {
      const result = await recognize(req.file.buffer, req.file.originalname, req.file.mimetype);

      // Для платёжки/неизвестного документа сразу подбираем счёт-кандидат
      // по номеру, упомянутому в назначении платежа — той же логикой точного
      // совпадения токена, что и импорт банковской выписки.
      let matchedInvoices = [];
      const refNumber = result.fields.referenced_invoice_number;
      if (refNumber) {
        const { rows } = await pool.query(
          `SELECT id, number, amount_kopecks, paid_kopecks, status, counterparty_id
           FROM invoices WHERE org_id = $1 AND status NOT IN ('DISPUTED','ARCHIVED','WRITTEN_OFF')`,
          [req.user.org_id]
        );
        matchedInvoices = rows
          .filter(inv => inv.number && purposeContainsNumber(refNumber, inv.number))
          .map(inv => ({ id: inv.id, number: inv.number, remaining_kopecks: Number(inv.amount_kopecks) - Number(inv.paid_kopecks) }));
      }

      await audit(req.user.org_id, req.user.id, 'document.recognized', 'document', null,
        null, { doc_type: result.doc_type, filename: req.file.originalname });

      return ok(res, { ...result, matched_invoices: matchedInvoices });
    } catch (e) {
      console.error('[document recognize]', e.message);
      return err(res, 502, 'Не удалось распознать документ — попробуйте другой файл или введите данные вручную', 'RECOGNIZE_FAILED');
    }
  });
});

// Разбор реестра счетов (Excel/CSV — массовая выгрузка из 1С/МойСклад/СБИС).
// Тяжёлая операция (парсинг таблицы на десятки строк) — лимит частоты
// строже, чем у одиночного распознавания.
const registerLimiter = rateLimit({
  keyFn: (req) => `recognize-register:${req.user?.org_id}`,
  max: 10, windowSeconds: 60 * 60,
  message: 'Слишком много запросов на разбор реестра счетов, попробуйте позже',
});
const REGISTER_ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]);
const registerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = ['.xlsx', '.xls', '.csv'].includes(ext);
    if (!REGISTER_ALLOWED_MIME.has(file.mimetype) && !extOk)
      return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
});

// Разбор реестра счетов из Excel/CSV в черновик для проверки пользователем —
// ничего не создаёт в БД. Формат по расширению файла (mimetype от браузера
// для .xls/.csv не всегда надёжен).
router.post('/documents/recognize-register', authMiddleware, registerLimiter, (req, res) => {
  registerUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message = uploadErr.message === 'UNSUPPORTED_TYPE'
        ? 'Разрешены только файлы Excel (.xlsx, .xls) или CSV'
        : uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 5 МБ' : 'Не удалось прочитать файл';
      return err(res, 400, message, 'VALIDATION_ERROR');
    }
    if (!req.file) return err(res, 400, 'Файл не передан', 'VALIDATION_ERROR');

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const isExcel = ext === '.xlsx' || ext === '.xls' ||
      req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      req.file.mimetype === 'application/vnd.ms-excel';

    try {
      const items = isExcel
        ? await parseExcelRegister(req.file.buffer)
        : parseCsvRegister(req.file.buffer);

      if (!items.length) return err(res, 400, 'Реестр пуст или не содержит распознаваемых строк', 'VALIDATION_ERROR');

      const warningRows = items.filter(i => i.warnings.length > 0).length;

      await audit(req.user.org_id, req.user.id, 'document.register_recognized', 'document', null,
        null, { filename: req.file.originalname, total_rows: items.length });

      return ok(res, {
        items,
        total_rows: items.length,
        parsed_rows: items.filter(i => i.amount_kopecks !== null).length,
        warning_rows: warningRows,
      });
    } catch (e) {
      console.error('[register recognize]', e.message);
      const message = /максимум/.test(e.message)
        ? e.message
        : 'Не удалось разобрать файл — проверьте, что это корректный Excel/CSV с реестром счетов';
      return err(res, 400, message, 'VALIDATION_ERROR');
    }
  });
});

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 МБ

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).slice(0, 10)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
});

router.post('/invoices/:invoiceId/documents', authMiddleware, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message = uploadErr.message === 'UNSUPPORTED_TYPE'
        ? 'Разрешены только PDF, JPG и PNG'
        : uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 'Файл больше 15 МБ'
          : 'Не удалось загрузить файл';
      return err(res, 400, message, 'VALIDATION_ERROR');
    }
    if (!req.file) return err(res, 400, 'Файл не передан', 'VALIDATION_ERROR');

    try {
      const inv = await pool.query('SELECT id FROM invoices WHERE id=$1 AND org_id=$2', [req.params.invoiceId, req.user.org_id]);
      if (!inv.rows.length) {
        fs.unlink(req.file.path, () => {});
        return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
      }

      const { rows } = await pool.query(`
        INSERT INTO documents(org_id, invoice_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename, mime_type, size_bytes, created_at
      `, [req.user.org_id, req.params.invoiceId, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, req.user.id]);

      await audit(req.user.org_id, req.user.id, 'document.uploaded', 'document', rows[0].id, null, { invoice_id: req.params.invoiceId, filename: req.file.originalname });
      return ok(res, rows[0], 201);
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return dbErr(res, e, '[document upload]');
    }
  });
});

router.get('/invoices/:invoiceId/documents', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, mime_type, size_bytes, created_at FROM documents
       WHERE invoice_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [req.params.invoiceId, req.user.org_id]
    );
    return ok(res, { items: rows });
  } catch (e) {
    return dbErr(res, e, '[documents list]');
  }
});

router.get('/documents/:id/download', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!rows.length) return err(res, 404, 'Документ не найден', 'NOT_FOUND');
    const doc = rows[0];
    const filePath = path.join(UPLOAD_DIR, doc.storage_path);
    if (!fs.existsSync(filePath)) return err(res, 404, 'Файл отсутствует на сервере', 'NOT_FOUND');
    return res.download(filePath, doc.filename);
  } catch (e) {
    return dbErr(res, e, '[document download]');
  }
});

module.exports = router;
