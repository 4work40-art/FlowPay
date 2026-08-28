const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { validateRequisites, isValidInn } = require('../lib/inn');
const { isValidOgrn, isValidBik, isValidAccountNumber } = require('../lib/bankRequisites');
const dadata = require('../lib/dadata');
const { classifyAbc } = require('../lib/abcAnalysis');
const { computeOverdueRisk } = require('../lib/overdueRisk');

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

// Нормализация названия для мягкого сравнения на похожесть (пробелы и
// регистр не должны считаться "разными" контрагентами).
function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

// Ищет потенциальные дубли контрагента в организации:
//  - inn: точное совпадение ИНН (сильный сигнал — почти наверняка тот же контрагент);
//  - name: совпадение нормализованного названия при ДРУГОМ (или отсутствующем) ИНН
//    (слабый сигнал — может быть совпадение, а не дубль, поэтому не блокирует).
async function findDuplicates(orgId, { inn, name }) {
  const result = { byInn: null, byName: null };
  if (inn) {
    const { rows } = await pool.query(
      'SELECT id, name, inn FROM counterparties WHERE org_id = $1 AND is_active = true AND inn = $2 LIMIT 1',
      [orgId, inn]
    );
    if (rows.length) result.byInn = rows[0];
  }
  const normalized = normalizeName(name);
  if (normalized) {
    const { rows } = await pool.query(
      `SELECT id, name, inn FROM counterparties
       WHERE org_id = $1 AND is_active = true
         AND lower(regexp_replace(name, '\\s+', '', 'g')) = $2
         AND ($3::text IS NULL OR inn IS DISTINCT FROM $3)
       LIMIT 1`,
      [orgId, normalized, inn || null]
    );
    if (rows.length && rows[0].id !== result.byInn?.id) result.byName = rows[0];
  }
  return result;
}

const router = express.Router();

// Запись в карточки контрагентов доступна только владельцу и бухгалтеру
// (карта PERMISSIONS в routes/users.js). readonly и vendor_admin — только
// чтение. Служебное автосоздание контрагента по ИНН при пакетной загрузке
// счетов (invoices POST /bulk) идёт под теми же ролями записи.
const canWriteCounterparties = requireRole('owner', 'accountant');

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

// Рейтинг поставщиков по объёму закупок (ABC-анализ, правило Парето) —
// не путать с текущим долгом (см. GET / ниже): здесь считаем сумму
// ВЫСТАВЛЕННЫХ счетов за период — это объём сотрудничества, а не факт
// оплаты. Счета в статусе DISPUTED/WRITTEN_OFF исключены — спорная или
// списанная сумма не считается состоявшейся закупкой.
router.get('/rating', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  const { from, to } = req.query;
  try {
    const params = [orgId];
    let where = "i.org_id = $1 AND i.status NOT IN ('DISPUTED','WRITTEN_OFF')";
    if (from) { params.push(from); where += ` AND COALESCE(i.invoice_date, i.created_at::date) >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND COALESCE(i.invoice_date, i.created_at::date) <= $${params.length}`; }

    const { rows } = await pool.query(`
      SELECT c.id AS counterparty_id, c.name, c.inn, SUM(i.amount_kopecks) AS total_kopecks
      FROM invoices i
      JOIN counterparties c ON c.id = i.counterparty_id
      WHERE ${where}
      GROUP BY c.id, c.name, c.inn
    `, params);

    const items = classifyAbc(rows.map(r => ({ ...r, total_kopecks: Number(r.total_kopecks) })));
    const total_kopecks = items.reduce((sum, it) => sum + it.total_kopecks, 0);

    return ok(res, {
      items: items.map(it => ({ ...it, total_display: fmt(it.total_kopecks) })),
      total_kopecks, total_display: fmt(total_kopecks),
    });
  } catch (e) {
    return dbErr(res, e, '[counterparties rating]');
  }
});

router.get('/', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  const q = req.query.q ? String(req.query.q).trim() : null; // поиск по названию/ИНН (глобальный поиск ⌘K)
  try {
    const params = [orgId];
    let where = 'WHERE c.org_id = $1 AND c.is_active = true';
    if (q) { params.push(`%${q}%`); where += ` AND (c.name ILIKE $${params.length} OR c.inn ILIKE $${params.length})`; }
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(i.id) AS invoice_count,
        COALESCE(SUM(i.amount_kopecks - i.paid_kopecks)
          FILTER (WHERE i.status NOT IN ('PAID','ARCHIVED')), 0) AS debt_kopecks
      FROM counterparties c
      LEFT JOIN invoices i ON i.counterparty_id = c.id
      ${where}
      GROUP BY c.id ORDER BY c.name
    `, params);
    return ok(res, { items: rows.map(r => ({ ...r, debt_display: fmt(r.debt_kopecks) })) });
  } catch (e) {
    return dbErr(res, e, '[counterparties]');
  }
});

// ИНН обязателен для НОВЫХ контрагентов (продуктовый аудит: карточки без
// ИНН — риск задвоения контрагентов и ошибок в реквизитах в отчётности).
// Исключение — служебное автосоздание контрагента из документов/импорта
// (invoices/new, import-files, outgoing-invoices/new), где ИНН часто ещё
// не распознан/неизвестен на момент создания счёта: такие вызовы явно
// помечают себя флагом inn_optional и создают контрагента без ИНН как и
// раньше — пользователь дозаполнит карточку в разделе «Контрагенты», где
// это поле уже обязательно. Существующие записи без ИНН эта проверка не
// трогает — миграции на NOT NULL нет и не должно быть.
router.post('/', authMiddleware, canWriteCounterparties, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type,
    ogrn, bank_account, bank_name, bank_bik, bank_corr_account,
    inn_optional, check_duplicates, confirm_duplicate } = req.body || {};
  if (!name || !name.trim())
    return err(res, 400, 'Укажите название', 'VALIDATION_ERROR');
  if (!inn_optional && (!inn || !String(inn).trim()))
    return err(res, 400, 'Укажите ИНН — обязателен при создании контрагента', 'VALIDATION_ERROR');
  const reqError = validateRequisites({ inn, kpp });
  if (reqError) return err(res, 400, reqError, 'VALIDATION_ERROR');
  const bankError = validateBankFields({ ogrn, bank_bik, bank_account, bank_corr_account });
  if (bankError) return err(res, 400, bankError, 'VALIDATION_ERROR');

  const innTrimmed = inn ? String(inn).trim() : null;
  const nameTrimmed = name.trim();

  try {
    // Предупреждение о дублях — не жёсткая блокировка. Точное совпадение
    // ИНН — сильный сигнал: карточку не создаём, пока пользователь явно не
    // подтвердит (confirm_duplicate), а возвращаем данные существующего
    // контрагента, чтобы UI показал предупреждение и дал выбрать "перейти
    // к нему" / "всё равно создать". Проверяется только когда об этом
    // явно просит вызывающая сторона (check_duplicates) — так основной
    // сценарий (без дублей) остаётся одним запросом без лишних round-trip'ов,
    // а служебные автосоздания из других форм этот флаг не шлют и ведут
    // себя как раньше.
    if (check_duplicates && !confirm_duplicate) {
      const dup = await findDuplicates(req.user.org_id, { inn: innTrimmed, name: nameTrimmed });
      if (dup.byInn) {
        return ok(res, {
          duplicate: true,
          match: 'inn',
          existing: dup.byInn,
          message: `Контрагент с ИНН ${innTrimmed} уже есть в списке: «${dup.byInn.name}». Перейти к нему или всё равно создать нового?`,
        });
      }
    }

    const { rows } = await pool.query(`
      INSERT INTO counterparties(org_id, name, inn, kpp, phone, email, address, type,
        ogrn, bank_account, bank_name, bank_bik, bank_corr_account)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [req.user.org_id, nameTrimmed, innTrimmed, kpp || null, phone || null,
        email || null, address || null, type || 'vendor',
        ogrn || null, bank_account || null, bank_name || null, bank_bik || null, bank_corr_account || null]);

    await audit(req.user.org_id, req.user.id, 'counterparty.created', 'counterparty', rows[0].id, null, { name });

    // Мягкое предупреждение по похожести названия (другой/отсутствующий
    // ИНН) — не блокирует, просто прикладывается к успешному ответу.
    let warning = null;
    if (check_duplicates) {
      const dup = await findDuplicates(req.user.org_id, { inn: innTrimmed, name: nameTrimmed });
      if (dup.byName) {
        warning = {
          match: 'name',
          existing: dup.byName,
          message: `Похожее название уже есть в списке: «${dup.byName.name}» (ИНН ${dup.byName.inn ?? '—'}). Проверьте, не тот же ли это контрагент.`,
        };
      }
    }

    return ok(res, { ...rows[0], warning }, 201);
  } catch (e) {
    return dbErr(res, e, '[counterparty create]');
  }
});

// Карточка контрагента (страница /counterparties/:id) — та же выборка
// долга/числа счетов, что и в списке выше, для одной записи.
router.get('/:id', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(i.id) AS invoice_count,
        COALESCE(SUM(i.amount_kopecks - i.paid_kopecks)
          FILTER (WHERE i.status NOT IN ('PAID','ARCHIVED')), 0) AS debt_kopecks
      FROM counterparties c
      LEFT JOIN invoices i ON i.counterparty_id = c.id
      WHERE c.id = $1 AND c.org_id = $2
      GROUP BY c.id
    `, [req.params.id, orgId]);
    if (!rows.length) return err(res, 404, 'Контрагент не найден', 'NOT_FOUND');
    return ok(res, { ...rows[0], debt_display: fmt(rows[0].debt_kopecks) });
  } catch (e) {
    return dbErr(res, e, '[counterparty get]');
  }
});

// Прогнозный риск просрочки — объяснимая эвристика на истории последних
// счетов контрагента (см. lib/overdueRisk.js), а НЕ изменение существующего
// counterparties.trust_score. trust_score — статичное поле 0..100, которое
// уже используется как есть в прогнозе кассовых разрывов
// (dashboard.js/cashflow-forecast: доля суммы недели у контрагентов с
// trust_score < 40) и в ABC-анализе объёма закупок (rating выше) как способ
// связать контрагента с его записью — переиспользование или изменение
// смысла этого поля сломало бы оба потребителя. Поэтому риск считается
// отдельно, "на лету" по каждому запросу карточки — простых объёмов данных
// организации достаточно, чтобы не заводить отдельное кэширующее поле и
// не изобретать инвалидацию кэша при каждом новом платеже.
router.get('/:id/overdue-risk', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const cp = await pool.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!cp.rows.length) return err(res, 404, 'Контрагент не найден', 'NOT_FOUND');

    // Берём счета с известным исходом относительно срока оплаты — оплаченные
    // (в т.ч. частично/архивные/списанные) и уже просроченные неоплаченные.
    // Свежесозданные/ожидающие своего срока счета (CREATED, UNDER_CONTROL,
    // PAYMENT_PENDING, ещё не наступил due_date) и спорные (DISPUTED) в
    // выборку не попадают — по ним рано или неоднозначно судить о просрочке.
    const { rows } = await pool.query(`
      SELECT i.due_date, pd.last_pay AS paid_date
      FROM invoices i
      LEFT JOIN (SELECT invoice_id, MAX(payment_date) AS last_pay FROM payments GROUP BY invoice_id) pd
        ON pd.invoice_id = i.id
      WHERE i.counterparty_id = $1 AND i.org_id = $2
        AND i.due_date IS NOT NULL
        AND i.status IN ('PAID','ARCHIVED','OVERDUE','PARTIALLY_PAID','WRITTEN_OFF')
      ORDER BY i.due_date DESC
      LIMIT 50
    `, [req.params.id, orgId]);

    const risk = computeOverdueRisk(rows);
    if (!risk) {
      return ok(res, {
        available: false,
        message: 'Недостаточно истории платежей для прогноза риска просрочки',
      });
    }
    return ok(res, { available: true, ...risk });
  } catch (e) {
    return dbErr(res, e, '[counterparty overdue-risk]');
  }
});

router.patch('/:id', authMiddleware, canWriteCounterparties, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type, is_active,
    ogrn, bank_account, bank_name, bank_bik, bank_corr_account } = req.body || {};
  const reqError = validateRequisites({ inn, kpp });
  if (reqError) return err(res, 400, reqError, 'VALIDATION_ERROR');
  const bankError = validateBankFields({ ogrn, bank_bik, bank_account, bank_corr_account });
  if (bankError) return err(res, 400, bankError, 'VALIDATION_ERROR');
  try {
    const existing = await pool.query('SELECT * FROM counterparties WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!existing.rows.length) return err(res, 404, 'Контрагент не найден', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE counterparties SET
        name = COALESCE($1, name), inn = COALESCE($2, inn), kpp = COALESCE($3, kpp),
        phone = COALESCE($4, phone), email = COALESCE($5, email), address = COALESCE($6, address),
        type = COALESCE($7, type), is_active = COALESCE($8, is_active),
        ogrn = COALESCE($9, ogrn), bank_account = COALESCE($10, bank_account),
        bank_name = COALESCE($11, bank_name), bank_bik = COALESCE($12, bank_bik),
        bank_corr_account = COALESCE($13, bank_corr_account)
      WHERE id = $14 RETURNING *
    `, [name ?? null, inn ?? null, kpp ?? null, phone ?? null, email ?? null, address ?? null, type ?? null, is_active ?? null,
        ogrn ?? null, bank_account ?? null, bank_name ?? null, bank_bik ?? null, bank_corr_account ?? null, req.params.id]);

    await audit(req.user.org_id, req.user.id, 'counterparty.updated', 'counterparty', req.params.id, existing.rows[0], rows[0]);
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[counterparty update]');
  }
});

module.exports = router;
