const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { randomUUID, createHash } = require('crypto');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware, requireRevocationCheck } = require('../lib/auth');
const { audit } = require('../lib/audit');
const mailer = require('../lib/mailer');
const { UPLOAD_DIR } = require('../lib/storage');
const { validateRequisites } = require('../lib/inn');
const { isValidBik, isValidAccountNumber } = require('../lib/bankRequisites');
const { sniffFile, MIME_KIND } = require('../lib/fileType');

// SVG больше не принимается: логотип отдаётся из /me/logo и раньше рендерился
// инлайн по Content-Type от расширения, а SVG может нести <script> — это был
// вектор stored-XSS. Оставлены только растровые PNG/JPEG, а реальный тип
// сверяется по сигнатуре (см. обработчик загрузки). Уже загруженные SVG
// обезврежены заголовками на отдаче (см. GET /me/logo).
const LOGO_ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `logo-${randomUUID()}${path.extname(file.originalname).slice(0, 10)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(LOGO_ALLOWED_MIME.has(file.mimetype) ? null : new Error('UNSUPPORTED_TYPE'), LOGO_ALLOWED_MIME.has(file.mimetype)),
});

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_ROLES = new Set(['accountant', 'readonly']);
const INVITE_TTL_DAYS = 7;

const ORG_FIELDS = `id, name, inn, kpp, plan, invoice_limit, created_at,
  address, bank_account, bank_name, bank_bik, bank_corr_account, director_name, accountant_name`;

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ORG_FIELDS} FROM organizations WHERE id = $1`,
      [req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[org get]');
  }
});

router.patch('/me', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Изменять данные организации может только владелец', 'FORBIDDEN');

  const {
    name, inn, kpp, address,
    bank_account, bank_name, bank_bik, bank_corr_account, director_name, accountant_name,
  } = req.body || {};
  if (name !== undefined && !name.trim())
    return err(res, 400, 'Название не может быть пустым', 'VALIDATION_ERROR');
  const reqError = validateRequisites({ inn, kpp });
  if (reqError) return err(res, 400, reqError, 'VALIDATION_ERROR');
  if (bank_bik !== undefined && bank_bik && !isValidBik(String(bank_bik).trim()))
    return err(res, 400, 'БИК некорректен: ожидается 9 цифр, начинается с 04', 'VALIDATION_ERROR');
  if (bank_account !== undefined && bank_account && !isValidAccountNumber(String(bank_account).trim()))
    return err(res, 400, 'Номер расчётного счёта некорректен: ожидается 20 цифр', 'VALIDATION_ERROR');
  if (bank_corr_account !== undefined && bank_corr_account && !isValidAccountNumber(String(bank_corr_account).trim()))
    return err(res, 400, 'Номер корреспондентского счёта некорректен: ожидается 20 цифр', 'VALIDATION_ERROR');

  try {
    const existing = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.user.org_id]);
    if (!existing.rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE organizations SET
        name = COALESCE($1, name), inn = COALESCE($2, inn), kpp = COALESCE($3, kpp),
        address = COALESCE($4, address),
        bank_account = COALESCE($5, bank_account), bank_name = COALESCE($6, bank_name),
        bank_bik = COALESCE($7, bank_bik), bank_corr_account = COALESCE($8, bank_corr_account),
        director_name = COALESCE($9, director_name), accountant_name = COALESCE($10, accountant_name),
        updated_at = NOW()
      WHERE id = $11
      RETURNING ${ORG_FIELDS}
    `, [name?.trim() ?? null, inn ?? null, kpp ?? null, address ?? null,
        bank_account ?? null, bank_name ?? null, bank_bik ?? null, bank_corr_account ?? null,
        director_name ?? null, accountant_name ?? null, req.user.org_id]);

    await audit(req.user.org_id, req.user.id, 'organization.updated', 'organization', req.user.org_id, existing.rows[0], rows[0]);
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[org update]');
  }
});

// Настройка «за сколько дней до срока оплаты напоминать» — своя для каждой
// организации (не глобальная переменная окружения).
router.get('/me/reminder-settings', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT reminder_days_before FROM organizations WHERE id=$1', [req.user.org_id]);
    if (!rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[reminder settings get]');
  }
});

router.patch('/me/reminder-settings', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Изменять настройки организации может только владелец', 'FORBIDDEN');

  const { reminder_days_before } = req.body || {};
  if (!Number.isInteger(reminder_days_before) || reminder_days_before < 0 || reminder_days_before > 30)
    return err(res, 400, 'Число дней должно быть целым от 0 до 30', 'VALIDATION_ERROR');

  try {
    const { rows } = await pool.query(
      'UPDATE organizations SET reminder_days_before=$1, updated_at=NOW() WHERE id=$2 RETURNING reminder_days_before',
      [reminder_days_before, req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');
    await audit(req.user.org_id, req.user.id, 'organization.reminder_settings_updated', 'organization', req.user.org_id, null, { reminder_days_before });
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[reminder settings update]');
  }
});

// Полное удаление организации со всеми данными (152-ФЗ: право на отзыв
// согласия и уничтожение персональных данных). Необратимо. Каскадом уходят
// счета, платежи, контрагенты, документы, подписки, транзакции, инвайты;
// пользователи удаляются явно (их FK — SET NULL). Записи журнала аудита
// обезличиваются (org_id/user_id становятся NULL по FK).
router.delete('/me', authMiddleware, requireRevocationCheck, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Удалить организацию может только владелец', 'FORBIDDEN');
  const { password } = req.body || {};
  if (!password) return err(res, 400, 'Для удаления подтвердите пароль', 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    const check = await client.query(
      'SELECT id FROM users WHERE id=$1 AND password_hash = crypt($2, password_hash)',
      [req.user.id, password]
    );
    if (!check.rows.length) return err(res, 401, 'Пароль неверен', 'UNAUTHORIZED');

    // Фиксируем факт удаления до того, как исчезнут связанные записи.
    await audit(req.user.org_id, req.user.id, 'organization.deleted', 'organization', req.user.org_id,
      null, { requested_by: req.user.email });

    await client.query('BEGIN');
    const users = await client.query('SELECT id FROM users WHERE org_id=$1', [req.user.org_id]);
    await client.query('DELETE FROM users WHERE org_id=$1', [req.user.org_id]);
    await client.query('DELETE FROM organizations WHERE id=$1', [req.user.org_id]);
    await client.query('COMMIT');

    // Активные сессии всех пользователей организации гаснут немедленно.
    // Пользователи уже удалены из БД, их токены ни к чему не дают доступ,
    // поэтому неудача отзыва здесь не должна ронять операцию — используем
    // «мягкий» вариант, который сам логирует ошибку.
    const { tryRevokeAllUserSessions } = require('../lib/auth');
    for (const u of users.rows) await tryRevokeAllUserSessions(u.id, 'password');

    return ok(res, { message: 'Организация и все данные удалены' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[org delete]');
  } finally {
    client.release();
  }
});

router.post('/me/logo', authMiddleware, (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Загружать логотип может только владелец организации', 'FORBIDDEN');

  logoUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message = uploadErr.message === 'UNSUPPORTED_TYPE' ? 'Разрешены только PNG и JPG'
        : uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 2 МБ' : 'Не удалось загрузить файл';
      return err(res, 400, message, 'VALIDATION_ERROR');
    }
    if (!req.file) return err(res, 400, 'Файл не передан', 'VALIDATION_ERROR');

    // Сверяем реальное содержимое с заявленным типом: под видом image/png
    // нельзя положить SVG-со-скриптом или произвольные байты (логотип потом
    // отдаётся браузеру).
    if (sniffFile(req.file.path) !== MIME_KIND[req.file.mimetype]) {
      fs.unlink(req.file.path, () => {});
      return err(res, 400, 'Содержимое файла не соответствует его типу — загрузите настоящий PNG или JPG', 'VALIDATION_ERROR');
    }

    try {
      const existing = await pool.query('SELECT logo_path FROM organizations WHERE id=$1', [req.user.org_id]);
      await pool.query('UPDATE organizations SET logo_path=$1, updated_at=NOW() WHERE id=$2', [req.file.filename, req.user.org_id]);
      const oldPath = existing.rows[0]?.logo_path;
      if (oldPath) fs.unlink(path.join(UPLOAD_DIR, oldPath), () => {});
      return ok(res, { logo_path: req.file.filename });
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return dbErr(res, e, '[logo upload]');
    }
  });
});

router.get('/me/logo', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT logo_path FROM organizations WHERE id=$1', [req.user.org_id]);
    if (!rows.length || !rows[0].logo_path) return err(res, 404, 'Логотип не найден', 'NOT_FOUND');
    const filePath = path.join(UPLOAD_DIR, rows[0].logo_path);
    if (!fs.existsSync(filePath)) return err(res, 404, 'Логотип не найден', 'NOT_FOUND');
    // Защита на отдаче: nosniff запрещает браузеру угадывать тип вопреки
    // заголовку, а CSP default-src 'none' нейтрализует скрипт в уже ранее
    // загруженных SVG, если файл откроют как отдельный документ. Новые загрузки
    // SVG уже не принимаются (см. LOGO_ALLOWED_MIME + сверку сигнатуры).
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return res.sendFile(filePath);
  } catch (e) {
    return dbErr(res, e, '[logo get]');
  }
});

router.get('/invites', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Приглашения видит только владелец организации', 'FORBIDDEN');
  try {
    const { rows } = await pool.query(
      `SELECT id, email, role, expires_at, used_at, created_at FROM org_invites
       WHERE org_id = $1 ORDER BY created_at DESC`,
      [req.user.org_id]
    );
    return ok(res, { items: rows });
  } catch (e) {
    return dbErr(res, e, '[invites list]');
  }
});

router.post('/invites', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Приглашать может только владелец организации', 'FORBIDDEN');

  const { email, role } = req.body || {};
  if (!email || !EMAIL_RE.test(email))
    return err(res, 400, 'Укажите корректный email', 'VALIDATION_ERROR');
  const finalRole = role && INVITE_ROLES.has(role) ? role : 'accountant';

  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (existingUser.rows.length)
      return err(res, 409, 'Пользователь с таким email уже зарегистрирован', 'ALREADY_EXISTS');

    const rawToken = randomUUID() + randomUUID();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const { rows } = await pool.query(`
      INSERT INTO org_invites(org_id, email, role, token_hash, expires_at, invited_by)
      VALUES($1,$2,$3,$4, NOW() + INTERVAL '${INVITE_TTL_DAYS} days', $5)
      RETURNING id, email, role, expires_at, created_at
    `, [req.user.org_id, email.toLowerCase().trim(), finalRole, tokenHash, req.user.id]);

    const orgRows = await pool.query('SELECT name FROM organizations WHERE id=$1', [req.user.org_id]);
    const inviteUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/accept-invite?token=${rawToken}`;
    await mailer.sendMail({
      to: email,
      subject: `Приглашение в организацию «${orgRows.rows[0].name}» — Счёт&Контроль`,
      text: `Вас пригласили присоединиться к организации «${orgRows.rows[0].name}» в Счёт&Контроль.\nСсылка действует ${INVITE_TTL_DAYS} дней:\n${inviteUrl}`,
    });

    await audit(req.user.org_id, req.user.id, 'org.invite_created', 'org_invite', rows[0].id, null, { email, role: finalRole });
    return ok(res, rows[0], 201);
  } catch (e) {
    return dbErr(res, e, '[invite create]');
  }
});

router.post('/invites/:id/revoke', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Отозвать приглашение может только владелец организации', 'FORBIDDEN');
  try {
    const { rows } = await pool.query(
      `UPDATE org_invites SET expires_at = NOW() WHERE id=$1 AND org_id=$2 AND used_at IS NULL RETURNING id`,
      [req.params.id, req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Приглашение не найдено', 'NOT_FOUND');
    return ok(res, { message: 'Приглашение отозвано' });
  } catch (e) {
    return dbErr(res, e, '[invite revoke]');
  }
});

module.exports = router;
