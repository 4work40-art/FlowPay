const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { validateRequisites, isValidInn } = require('../lib/inn');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const orgId  = req.user.org_id;
  const status = req.query.status;
  const from   = req.query.from; // YYYY-MM-DD, по invoice_date
  const to     = req.query.to;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  try {
    const params = [orgId];
    let where = 'WHERE i.org_id = $1';
    if (status) { params.push(status.toUpperCase()); where += ` AND i.status = $${params.length}`; }
    if (from)   { params.push(from); where += ` AND i.created_at >= $${params.length}`; }
    if (to)     { params.push(to);   where += ` AND i.created_at < ($${params.length}::date + INTERVAL '1 day')`; }

    const { rows } = await pool.query(`
      SELECT i.*, c.name AS counterparty_name,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks
      FROM invoices i
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    const cnt = await pool.query(`SELECT COUNT(*) FROM invoices i ${where}`, params);

    return ok(res, {
      items: rows.map(r => ({
        ...r,
        amount_display:    fmt(r.amount_kopecks),
        paid_display:      fmt(r.paid_kopecks),
        remaining_display: fmt(r.remaining_kopecks),
      })),
      total: +cnt.rows[0].count, page, limit,
    });
  } catch (e) {
    return dbErr(res, e, '[invoices list]');
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name AS counterparty_name,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks
      FROM invoices i
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');

    const pmts = await pool.query(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const items = await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    const inv = rows[0];
    return ok(res, {
      ...inv,
      amount_display:    fmt(inv.amount_kopecks),
      paid_display:      fmt(inv.paid_kopecks),
      remaining_display: fmt(inv.remaining_kopecks),
      payments: pmts.rows.map(p => ({ ...p, amount_display: fmt(p.amount_kopecks) })),
      items: items.rows.map(it => ({ ...it, amount_display: fmt(it.amount_kopecks), unit_price_display: fmt(it.unit_price_kopecks) })),
    });
  } catch (e) {
    return dbErr(res, e, '[invoice get]');
  }
});

// Позиции счёта — свободный формат (name/quantity/unit/unit_price_kopecks),
// без привязки к справочнику номенклатуры. Валидируем только числа: сумма
// позиции всегда пересчитывается на сервере (quantity * unit_price), не
// доверяем присланному amount_kopecks позиции.
function validateItems(items) {
  if (items === undefined) return null;
  if (!Array.isArray(items)) return 'Позиции счёта должны быть массивом';
  for (const it of items) {
    if (!it || typeof it.name !== 'string' || !it.name.trim())
      return 'У каждой позиции должно быть название';
    if (!Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0)
      return `Некорректное количество у позиции «${it.name}»`;
    if (!Number.isInteger(it.unit_price_kopecks) || it.unit_price_kopecks <= 0)
      return `Некорректная цена у позиции «${it.name}»`;
  }
  return null;
}

async function insertItems(client, orgId, invoiceId, items) {
  for (const it of items) {
    const quantity = Number(it.quantity);
    const amount = Math.round(quantity * it.unit_price_kopecks);
    await client.query(
      `INSERT INTO invoice_items(org_id, invoice_id, name, quantity, unit, unit_price_kopecks, amount_kopecks)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, invoiceId, it.name.trim(), quantity, it.unit || null, it.unit_price_kopecks, amount]
    );
  }
}

router.post('/', authMiddleware, async (req, res) => {
  const { amount_kopecks, number, counterparty_id, due_date, invoice_date, notes, items } = req.body || {};
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'Сумма должна быть больше нуля', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'Сумма должна быть целым числом (в копейках)', 'VALIDATION_ERROR');
  const itemsError = validateItems(items);
  if (itemsError) return err(res, 400, itemsError, 'VALIDATION_ERROR');

  try {
    const orgId = req.user.org_id;

    const orgRows = await pool.query('SELECT invoice_limit FROM organizations WHERE id=$1', [orgId]);
    const limit = orgRows.rows[0]?.invoice_limit;
    if (limit != null) {
      const cnt = await pool.query('SELECT COUNT(*) FROM invoices WHERE org_id=$1', [orgId]);
      if (+cnt.rows[0].count >= limit)
        return err(res, 403, `Достигнут лимит счетов на вашем тарифе (${limit}). Обновите тариф, чтобы продолжить.`, 'PLAN_LIMIT_REACHED');
    }

    if (counterparty_id) {
      const cp = await pool.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2', [counterparty_id, orgId]);
      if (!cp.rows.length)
        return err(res, 400, 'Контрагент не найден в вашей организации', 'VALIDATION_ERROR');
    }

    let finalNumber = number || null;
    if (!finalNumber) {
      // Атомарно берём и увеличиваем счётчик организации, чтобы два
      // одновременных запроса без ручного номера не получили один и тот же.
      const seqRows = await pool.query(
        `UPDATE organizations SET next_invoice_seq = next_invoice_seq + 1 WHERE id=$1 RETURNING next_invoice_seq - 1 AS seq`,
        [orgId]
      );
      finalNumber = String(seqRows.rows[0].seq);
    }

    const { rows } = await pool.query(`
      INSERT INTO invoices(org_id, counterparty_id, number, amount_kopecks, due_date, invoice_date, notes, status, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,'CREATED',$8) RETURNING *
    `, [orgId, counterparty_id || null, finalNumber, amount_kopecks, due_date || null, invoice_date || null, notes || null, req.user.id]);

    if (items?.length) await insertItems(pool, orgId, rows[0].id, items);

    await audit(orgId, req.user.id, 'invoice.created', 'invoice', rows[0].id, null, { amount_kopecks, status: 'CREATED', items_count: items?.length || 0 });
    return ok(res, { ...rows[0], amount_display: fmt(rows[0].amount_kopecks) }, 201);
  } catch (e) {
    return dbErr(res, e, '[invoice create]');
  }
});

// Пакетное создание счетов из проверенного пользователем черновика (реестр
// Excel/CSV, см. POST /documents/recognize-register). Частичный успех —
// нормальный сценарий: одна плохая строка не должна ронять весь пакет,
// поэтому каждый элемент обрабатывается и проваливается независимо
// (в отличие от одиночного создания, здесь нет общей транзакции на пакет).
router.post('/bulk', authMiddleware, async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length)
    return err(res, 400, 'Передайте непустой массив items', 'VALIDATION_ERROR');

  const orgId = req.user.org_id;
  const created = [];
  const failed = [];

  try {
    const orgRows = await pool.query('SELECT invoice_limit FROM organizations WHERE id=$1', [orgId]);
    const limit = orgRows.rows[0]?.invoice_limit;
    let currentCount = null;
    if (limit != null) {
      const cnt = await pool.query('SELECT COUNT(*) FROM invoices WHERE org_id=$1', [orgId]);
      currentCount = +cnt.rows[0].count;
    }

    // Кэш «ИНН -> counterparty_id» в пределах пакета, чтобы не создавать
    // одного и того же нового контрагента дважды из-за двух строк реестра.
    const cpCacheByInn = new Map();

    const client = await pool.connect();
    try {
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx] || {};
        const row = item.row ?? idx + 1;

        const amount_kopecks = item.amount_kopecks;
        if (!Number.isInteger(amount_kopecks) || amount_kopecks <= 0) {
          failed.push({ row, reason: 'Сумма должна быть целым числом больше нуля (в копейках)' });
          continue;
        }

        if (limit != null && currentCount >= limit) {
          failed.push({ row, reason: `Достигнут лимит счетов на вашем тарифе (${limit})` });
          continue;
        }

        // Определяем контрагента: явный id -> поиск по ИНН в организации ->
        // создание нового по имени/ИНН -> без контрагента.
        let counterpartyId = null;
        try {
          if (item.counterparty_id) {
            const cp = await client.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2',
              [item.counterparty_id, orgId]);
            if (!cp.rows.length) {
              failed.push({ row, reason: 'Контрагент не найден в вашей организации' });
              continue;
            }
            counterpartyId = cp.rows[0].id;
          } else if (item.counterparty_inn) {
            const inn = String(item.counterparty_inn).trim();
            if (cpCacheByInn.has(inn)) {
              counterpartyId = cpCacheByInn.get(inn);
            } else {
              const existing = await client.query(
                'SELECT id FROM counterparties WHERE org_id=$1 AND inn=$2 LIMIT 1', [orgId, inn]);
              if (existing.rows.length) {
                counterpartyId = existing.rows[0].id;
              } else {
                const innValid = isValidInn(inn) && !validateRequisites({ inn });
                const insertInn = innValid ? inn : null;
                const name = (item.counterparty_name && item.counterparty_name.trim()) || inn;
                const newCp = await client.query(
                  `INSERT INTO counterparties(org_id, name, inn, type) VALUES($1,$2,$3,'client') RETURNING id`,
                  [orgId, name, insertInn]);
                counterpartyId = newCp.rows[0].id;
              }
              cpCacheByInn.set(inn, counterpartyId);
            }
          }
        } catch (e) {
          failed.push({ row, reason: 'Ошибка при определении контрагента' });
          continue;
        }

        let finalNumber = item.number || null;
        try {
          await client.query('BEGIN');

          if (!finalNumber) {
            const seqRows = await client.query(
              `UPDATE organizations SET next_invoice_seq = next_invoice_seq + 1 WHERE id=$1 RETURNING next_invoice_seq - 1 AS seq`,
              [orgId]);
            finalNumber = String(seqRows.rows[0].seq);
          }

          const { rows } = await client.query(`
            INSERT INTO invoices(org_id, counterparty_id, number, amount_kopecks, due_date, invoice_date, notes, status, created_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,'CREATED',$8) RETURNING id, number
          `, [orgId, counterpartyId, finalNumber, amount_kopecks, item.due_date || null,
              item.invoice_date || null, item.notes || null, req.user.id]);

          await client.query('COMMIT');
          if (limit != null) currentCount += 1;
          created.push({ row, invoice_id: rows[0].id, number: rows[0].number });
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          failed.push({ row, reason: 'Ошибка сохранения счёта' });
        }
      }
    } finally {
      client.release();
    }

    await audit(orgId, req.user.id, 'invoice.bulk_created', 'invoice', null,
      null, { created_count: created.length, failed_count: failed.length, total: items.length });

    return ok(res, { created, failed });
  } catch (e) {
    return dbErr(res, e, '[invoice bulk create]');
  }
});

const TRANSITIONS = {
  mark_for_control: { from: ['CREATED'],                                  to: 'UNDER_CONTROL'   },
  set_pending:      { from: ['UNDER_CONTROL'],                             to: 'PAYMENT_PENDING' },
  open_dispute:     { from: ['PAYMENT_PENDING','OVERDUE','PARTIALLY_PAID'],to: 'DISPUTED'        },
  archive:          { from: ['PAID'],                                      to: 'ARCHIVED'        },
  write_off:        { from: ['OVERDUE'],                                   to: 'WRITTEN_OFF'     },
  mark_overdue:     { from: ['PAYMENT_PENDING','UNDER_CONTROL'],           to: 'OVERDUE'         },
  resolve_dispute:  { from: ['DISPUTED'],                                  to: 'UNDER_CONTROL'   },
};

router.patch('/:id/state', authMiddleware, async (req, res) => {
  const { transition, reason } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    const inv = rows[0];

    const t = TRANSITIONS[transition];
    if (!t) return err(res, 400, `Неизвестный переход статуса: ${transition}`, 'INVOICE_STATE_INVALID');
    if (!t.from.includes(inv.status))
      return err(res, 400, `Переход «${transition}» недопустим из статуса ${inv.status}`, 'INVOICE_STATE_INVALID');

    await pool.query('UPDATE invoices SET status=$1, updated_at=NOW(), version=version+1 WHERE id=$2', [t.to, req.params.id]);
    await audit(inv.org_id, req.user.id, 'invoice.state_changed', 'invoice', req.params.id,
      { status: inv.status }, { status: t.to, reason });

    return ok(res, { id: req.params.id, previous_state: inv.status, new_state: t.to, transitioned_at: new Date().toISOString() });
  } catch (e) {
    return dbErr(res, e, '[invoice state]');
  }
});

// Включение/отключение публичной ссылки на счёт. Отключённая ссылка
// возвращает контрагенту 404 — доступ можно отозвать в любой момент.
router.patch('/:id/public', authMiddleware, async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean')
    return err(res, 400, 'Укажите enabled: true|false', 'VALIDATION_ERROR');
  try {
    const { rows } = await pool.query(
      'UPDATE invoices SET public_enabled=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3 RETURNING id, public_enabled',
      [enabled, req.params.id, req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    await audit(req.user.org_id, req.user.id, 'invoice.public_toggled', 'invoice', req.params.id,
      null, { public_enabled: enabled });
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[invoice public toggle]');
  }
});

// Добавить позицию к уже созданному счёту — например, забыли внести товар
// при первичном вводе, или заполняют позиции постепенно.
router.post('/:id/items', authMiddleware, async (req, res) => {
  const { name, quantity, unit, unit_price_kopecks } = req.body || {};
  const itemsError = validateItems([{ name, quantity, unit, unit_price_kopecks }]);
  if (itemsError) return err(res, 400, itemsError, 'VALIDATION_ERROR');
  try {
    const inv = await pool.query('SELECT id FROM invoices WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!inv.rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');

    const amount = Math.round(Number(quantity) * unit_price_kopecks);
    const { rows } = await pool.query(
      `INSERT INTO invoice_items(org_id, invoice_id, name, quantity, unit, unit_price_kopecks, amount_kopecks)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.org_id, req.params.id, name.trim(), Number(quantity), unit || null, unit_price_kopecks, amount]
    );
    await audit(req.user.org_id, req.user.id, 'invoice_item.created', 'invoice_item', rows[0].id, null, { invoice_id: req.params.id, name });
    return ok(res, { ...rows[0], amount_display: fmt(rows[0].amount_kopecks), unit_price_display: fmt(rows[0].unit_price_kopecks) }, 201);
  } catch (e) {
    return dbErr(res, e, '[invoice item create]');
  }
});

router.delete('/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM invoice_items WHERE id=$1 AND invoice_id=$2 AND org_id=$3 RETURNING id`,
      [req.params.itemId, req.params.id, req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Позиция не найдена', 'NOT_FOUND');
    await audit(req.user.org_id, req.user.id, 'invoice_item.deleted', 'invoice_item', req.params.itemId, null, { invoice_id: req.params.id });
    return ok(res, { deleted: true });
  } catch (e) {
    return dbErr(res, e, '[invoice item delete]');
  }
});

module.exports = router;
