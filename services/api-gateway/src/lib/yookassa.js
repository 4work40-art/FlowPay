// Тонкий клиент ЮKassa REST API (https://yookassa.ru/developers/api).
// Все настройки — из env, чтобы не хранить секреты в коде.
const API_BASE  = process.env.YOOKASSA_API_BASE || 'https://api.yookassa.ru/v3';
const SHOP_ID   = process.env.YOOKASSA_SHOP_ID;
const SECRET    = process.env.YOOKASSA_SECRET_KEY;

function authHeader() {
  const token = Buffer.from(`${SHOP_ID}:${SECRET}`).toString('base64');
  return `Basic ${token}`;
}

function isConfigured() {
  return !!(SHOP_ID && SECRET);
}

async function createPayment({ idempotenceKey, amountKopecks, description, returnUrl, metadata }) {
  const res = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': idempotenceKey,
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      amount: { value: (amountKopecks / 100).toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description,
      metadata,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.description || `YooKassa error ${res.status}`;
    throw new Error(message);
  }
  return data;
}

// Мы не доверяем телу webhook-уведомления напрямую (ЮKassa не подписывает
// вебхуки по умолчанию) — после получения события всегда перезапрашиваем
// статус платежа по его ID напрямую через API.
async function getPayment(paymentId) {
  const res = await fetch(`${API_BASE}/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
  });
  const data = await res.json();
  if (!res.ok) {
    const message = data?.description || `YooKassa error ${res.status}`;
    throw new Error(message);
  }
  return data;
}

module.exports = { isConfigured, createPayment, getPayment };
