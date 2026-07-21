const express = require('express');
const { pool } = require('../lib/db');
const { ok, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { normalizeItemName, priceChangePct, peakMonth } = require('../lib/itemAnalytics');

const router = express.Router();

// Учёт купленных товаров/услуг: сводка по наименованиям — количество,
// сумма закупок, средняя цена за штуку. Группировка по нормализованному
// названию (без учёта регистра/пробелов), т.к. поставщики и пользователи
// пишут одно и то же название по-разному.
router.get('/items', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT lower(trim(ii.name)) AS key,
        MIN(ii.name) AS name,
        SUM(ii.quantity) AS total_quantity,
        SUM(ii.amount_kopecks) AS total_kopecks,
        (SUM(ii.amount_kopecks) / NULLIF(SUM(ii.quantity), 0))::bigint AS avg_price_kopecks,
        COUNT(DISTINCT date_trunc('month', COALESCE(i.invoice_date, i.created_at::date))) AS active_months,
        MAX(COALESCE(i.invoice_date, i.created_at::date)) AS last_purchase_date
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.org_id = $1
      GROUP BY lower(trim(ii.name))
      ORDER BY total_kopecks DESC
    `, [orgId]);

    return ok(res, {
      items: rows.map(r => ({
        name: r.name,
        total_quantity: Number(r.total_quantity),
        total_kopecks: Number(r.total_kopecks),
        total_display: fmt(Number(r.total_kopecks)),
        avg_price_kopecks: r.avg_price_kopecks == null ? null : Number(r.avg_price_kopecks),
        avg_price_display: r.avg_price_kopecks == null ? null : fmt(Number(r.avg_price_kopecks)),
        active_months: Number(r.active_months),
        last_purchase_date: r.last_purchase_date,
      })),
    });
  } catch (e) {
    return dbErr(res, e, '[analytics items]');
  }
});

// Динамика по конкретному товару/услуге за N месяцев: количество, сумма,
// средняя цена за штуку помесячно + изменение цены и «пиковый» месяц
// (прокси сезонности при отсутствии складского учёта).
router.get('/items/:name/history', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  const key = normalizeItemName(req.params.name);
  const months = Math.min(24, Math.max(1, parseInt(req.query.months) || 12));
  if (!key) return ok(res, { months: [], price_change_pct: null, peak_month: null });

  try {
    const { rows } = await pool.query(`
      SELECT to_char(date_trunc('month', COALESCE(i.invoice_date, i.created_at::date)), 'YYYY-MM') AS month,
        SUM(ii.quantity) AS total_quantity,
        SUM(ii.amount_kopecks) AS total_kopecks,
        (SUM(ii.amount_kopecks) / NULLIF(SUM(ii.quantity), 0))::bigint AS avg_price_kopecks
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.org_id = $1 AND lower(trim(ii.name)) = $2
        AND COALESCE(i.invoice_date, i.created_at::date) >= (CURRENT_DATE - ($3 || ' months')::interval)
      GROUP BY date_trunc('month', COALESCE(i.invoice_date, i.created_at::date))
      ORDER BY date_trunc('month', COALESCE(i.invoice_date, i.created_at::date))
    `, [orgId, key, months]);

    const series = rows.map(r => ({
      month: r.month,
      total_quantity: Number(r.total_quantity),
      total_kopecks: Number(r.total_kopecks),
      total_display: fmt(Number(r.total_kopecks)),
      avg_price_kopecks: r.avg_price_kopecks == null ? null : Number(r.avg_price_kopecks),
      avg_price_display: r.avg_price_kopecks == null ? null : fmt(Number(r.avg_price_kopecks)),
    }));

    return ok(res, {
      months: series,
      price_change_pct: priceChangePct(series),
      peak_month: peakMonth(series),
    });
  } catch (e) {
    return dbErr(res, e, '[analytics item history]');
  }
});

module.exports = router;
