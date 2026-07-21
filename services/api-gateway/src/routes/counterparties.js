const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { validateRequisites, isValidInn } = require('../lib/inn');
const { isValidOgrn, isValidBik, isValidAccountNumber } = require('../lib/bankRequisites');
const dadata = require('../lib/dadata');

// Банковские реквизиты и ОГРН — та же схема валидации формата, что и у
// ИНН/КПП в этом файле (см. validateRequisites): явно неверный формат
// отклоняется на создании/обновлении карточки контрагента. Автосоздание
// контрагента из распознанного документа (invoices/new) уже ловит эту
// ошибку и откатывается на ручной выбор, не теряя остальные данные счёта.
function validateBankFields({ ogrn, bank_bik, bank_account, bank_corr_account }) {
  if (ogrn && !isValidOgrn(String(ogrn).trim()))
    return 'ОГРН не прошёл проверку контрольной суммы — проверьте вручную';
  if (bank_bik && !isValidBik(String(bank_bik).trim()))
    return 'БИК некорректен: ожидается 9 цифр, начинается с 04';
  if (bank_account && !isValidAccountNumber(String(bank_account).trim()))
    return 'Номер расчётного счёта некорректен: ожидается 20 цифр';
  if (bank_corr_account && !isValidAccountNumber(String(bank_corr_account).trim()))
    return 'Номер корреспондентского счёта некорректен: ожидается 20 цифр';
  return null;
}

const router = express.Router();

// Автозаполнение реквизитов по ИНН (ЕГРЮЛ/ЕГРИП через DaData).
// GET /counterparties/suggest?inn=... — до создания записи, поэтому раньше CRUD.
router.get('/suggest', authMiddleware, async (req, res) => {
  const inn = String(req.query.inn || '').trim();
  if (!isValidInn(inn))
    return err(res, 400, 'ИНН некорректен: проверьте количество цифр и правильность ввода', 'VALIDATION_ERROR');
  if (!dadata.isConfigured())
    return err(res, 503, 'Подсказки по ИНН не настроены (DADATA_API_KEY)', 'SUGGEST_NOT_CONFIGURED');
  try {
    const party = await dadata.findPartyByInn(inn);
    if (!party) return err(res, 404, 'Организация с таким ИНН не найдена в ЕГРЮЛ/ЕГРИП', 'NOT_FOUND');
    return ok(res, party);
  } catch (e) {
    console.error('[counterparty suggest]', e.message);
    return err(res, 502, 'Сервис подсказок временно недоступен', 'SUGGEST_UNAVAILABLE');
  }
});

router.get('/', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(i.id) AS invoice_count,
        COALESCE(SUM(i.amount_kopecks - i.paid_kopecks)
          FILTER (WHERE i.status NOT IN ('PAID','ARCHIVED')), 0) AS debt_kopecks
      FROM counterparties c
      LEFT JOIN invoices i ON i.counterparty_id = c.id
      WHERE c.org_id = $1 AND c.is_active = true
      GROUP BY c.id ORDER BY c.name
    `, [orgId]);
    return ok(res, { items: rows.map(r => ({ ...r, debt_display: fmt(r.debt_kopecks) })) });
  } catch (e) {
    return dbErr(res, e, '[counterparties]');
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type } = req.body || {};
  if (!name || !name.trim())
    return err(res, 400, 'Укажите название', 'VALIDATION_ERROR');
  const reqError = validateRequisites({ inn, kpp });
  if (reqError) return err(res, 400, reqError, 'VALIDATION_ERROR');

  try {
    const { rows } = await pool.query(`
      INSERT INTO counterparties(org_id, name, inn, kpp, phone, email, address, type)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.user.org_id, name.trim(), inn || null, kpp || null, phone || null,
        email || null, address || null, type || 'vendor']);

    await audit(req.user.org_id, req.user.id, 'counterparty.created', 'counterparty', rows[0].id, null, { name });
    return ok(res, rows[0], 201);
  } catch (e) {
    return dbErr(res, e, '[counterparty create]');
  }
});

router.patch('/:id', authMiddleware, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type, is_active } = req.body || {};
  const reqError = validateRequisites({ inn, kpp });
  if (reqError) return err(res, 400, reqError, 'VALIDATION_ERROR');
  try {
    const existing = await pool.query('SELECT * FROM counterparties WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!existing.rows.length) return err(res, 404, 'Контрагент не найден', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE counterparties SET
        name = COALESCE($1, name), inn = COALESCE($2, inn), kpp = COALESCE($3, kpp),
        phone = COALESCE($4, phone), email = COALESCE($5, email), address = COALESCE($6, address),
        type = COALESCE($7, type), is_active = COALESCE($8, is_active)
      WHERE id = $9 RETURNING *
    `, [name ?? null, inn ?? null, kpp ?? null, phone ?? null, email ?? null, address ?? null, type ?? null, is_active ?? null, req.params.id]);

    await audit(req.user.org_id, req.user.id, 'counterparty.updated', 'counterparty', req.params.id, existing.rows[0], rows[0]);
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[counterparty update]');
  }
});

module.exports = router;
