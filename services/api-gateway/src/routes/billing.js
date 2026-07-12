const express = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { PLANS, PURCHASABLE_PLANS } = require('../lib/plans');
const yookassa = require('../lib/yookassa');

const router = express.Router();

router.get('/plans', (req, res) => {
  return ok(res, { plans: PLANS, purchasable: PURCHASABLE_PLANS });
});

router.get('/subscription', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, o.invoice_limit FROM subscriptions s
       JOIN organizations o ON o.id = s.org_id
       WHERE s.org_id = $1`,
      [req.user.org_id]
    );
    if (!rows.length) {
      return ok(res, { org_id: req.user.org_id, plan: 'free', status: 'active', invoice_limit: PLANS.free.invoice_limit });
    }
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[billing subscription]');
  }
});

router.post('/checkout', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Оформить подписку может только владелец организации', 'FORBIDDEN');

  const { plan } = req.body || {};
  if (!PURCHASABLE_PLANS.includes(plan))
    return err(res, 400, `Тариф недоступен для самостоятельного оформления: ${plan}`, 'VALIDATION_ERROR');

  if (!yookassa.isConfigured())
    return err(res, 503, 'Приём платежей временно недоступен — оплата не настроена', 'BILLING_NOT_CONFIGURED');

  const planInfo = PLANS[plan];
  const txId = randomUUID();

  try {
    await pool.query(`
      INSERT INTO billing_transactions(id, org_id, plan, amount_kopecks, status, created_by)
      VALUES($1,$2,$3,$4,'pending',$5)
    `, [txId, req.user.org_id, plan, planInfo.price_kopecks, req.user.id]);

    const returnUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/billing/return`;
    const payment = await yookassa.createPayment({
      idempotenceKey: txId,
      amountKopecks: planInfo.price_kopecks,
      description: `Подписка «${planInfo.label}» — Счёт&Контроль`,
      returnUrl,
      metadata: { org_id: req.user.org_id, transaction_id: txId, plan },
    });

    await pool.query(
      `UPDATE billing_transactions SET provider_payment_id = $1 WHERE id = $2`,
      [payment.id, txId]
    );

    return ok(res, {
      transaction_id: txId,
      confirmation_url: payment.confirmation?.confirmation_url,
      payment_id: payment.id,
    }, 201);
  } catch (e) {
    await pool.query(`UPDATE billing_transactions SET status='canceled' WHERE id=$1`, [txId]).catch(() => {});
    console.error('[billing checkout]', e.message);
    return err(res, 502, 'Не удалось создать платёж в ЮKassa', 'PAYMENT_PROVIDER_ERROR');
  }
});

// Платежи ЮKassa у нас разовые (не автосписание), поэтому "отмена подписки"
// технически — это немедленный даунгрейд на free, а не отказ от будущего
// списания. Ближайший оплаченный период не возвращается (без интеграции
// с реальным recurring-биллингом это было бы ложной гарантией).
router.post('/cancel', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Изменить тариф может только владелец организации', 'FORBIDDEN');

  try {
    const orgRows = await pool.query('SELECT plan FROM organizations WHERE id=$1', [req.user.org_id]);
    if (!orgRows.rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');
    if (orgRows.rows[0].plan === 'free')
      return err(res, 400, 'Вы уже на бесплатном тарифе', 'VALIDATION_ERROR');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE organizations SET plan='free', invoice_limit=$1, updated_at=NOW() WHERE id=$2`,
        [PLANS.free.invoice_limit, req.user.org_id]
      );
      await client.query(
        `UPDATE subscriptions SET plan='free', status='canceled', current_period_end=NULL, updated_at=NOW() WHERE org_id=$1`,
        [req.user.org_id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await audit(req.user.org_id, req.user.id, 'billing.subscription_canceled', 'organization', req.user.org_id,
      { plan: orgRows.rows[0].plan }, { plan: 'free' });
    return ok(res, { plan: 'free', invoice_limit: PLANS.free.invoice_limit });
  } catch (e) {
    return dbErr(res, e, '[billing cancel]');
  }
});

// ЮKassa шлёт уведомление на публичный webhook без подписи запроса —
// поэтому тело уведомления используется только как триггер: реальный
// статус всегда перепроверяется через GET /payments/:id по API.
router.post('/webhook', async (req, res) => {
  const paymentId = req.body?.object?.id;
  if (!paymentId) return res.status(200).json({ ok: true }); // не наш формат — молча подтверждаем, чтобы ЮKassa не ретраила бесконечно

  try {
    const payment = await yookassa.getPayment(paymentId);
    const txId = payment.metadata?.transaction_id;
    if (!txId) return res.status(200).json({ ok: true });

    const { rows } = await pool.query('SELECT * FROM billing_transactions WHERE id = $1', [txId]);
    if (!rows.length) return res.status(200).json({ ok: true });
    const tx = rows[0];

    if (tx.status === 'succeeded') return res.status(200).json({ ok: true }); // уже обработан — идемпотентность

    if (payment.status === 'succeeded') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE billing_transactions SET status='succeeded', confirmed_at=NOW() WHERE id=$1`,
          [txId]
        );

        const planInfo = PLANS[tx.plan];
        await client.query(
          `UPDATE organizations SET plan=$1, invoice_limit=$2, updated_at=NOW() WHERE id=$3`,
          [tx.plan, planInfo.invoice_limit, tx.org_id]
        );

        await client.query(`
          INSERT INTO subscriptions(org_id, plan, status, current_period_end)
          VALUES($1,$2,'active', NOW() + INTERVAL '30 days')
          ON CONFLICT (org_id) DO UPDATE SET
            plan = EXCLUDED.plan, status = 'active',
            current_period_end = NOW() + INTERVAL '30 days', updated_at = NOW()
        `, [tx.org_id, tx.plan]);

        await client.query('COMMIT');
        await audit(tx.org_id, tx.created_by, 'billing.subscription_upgraded', 'organization', tx.org_id,
          { plan: 'free' }, { plan: tx.plan });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } else if (payment.status === 'canceled') {
      await pool.query(`UPDATE billing_transactions SET status='canceled' WHERE id=$1`, [txId]);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[billing webhook]', e.message);
    // 200 всё равно — иначе ЮKassa будет ретраить событие, которое мы не смогли обработать по своей вине
    return res.status(200).json({ ok: false });
  }
});

module.exports = router;
