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

const router = express.Router();

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
