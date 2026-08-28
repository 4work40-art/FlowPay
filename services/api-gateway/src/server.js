const express = require('express');
const cors    = require('cors');
const { pool } = require('./lib/db');
const { startOverdueJob } = require('./lib/overdueJob');
const { startSubscriptionExpiryJob } = require('./lib/subscriptionExpiryJob');
const { startOverdueDigestJob } = require('./lib/overdueDigestJob');
const { startDueSoonDigestJob } = require('./lib/dueSoonDigestJob');

const app  = express();
const port = process.env.PORT || 3001;

// req.ip (ключ всех rate-limit'ов) по умолчанию — адрес прямого TCP-пира.
// Пока сервис отвечает напрямую, это верный клиентский IP, и доверять
// X-Forwarded-For НЕЛЬЗЯ (иначе его можно подделать и обнулять лимиты).
// Когда сервис ставят за reverse-proxy (TLS-терминатор), нужно, наоборот,
// доверять ровно известному числу прокси-хопов, чтобы req.ip снова стал
// реальным клиентским. Управляется явно через TRUST_PROXY, по умолчанию
// выключено (текущее безопасное поведение). Значение: число хопов (напр. 1)
// или подсеть; 'true'/'false' — вкл/выкл.
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  const num = Number(tp);
  app.set('trust proxy', tp === 'true' ? 1 : tp === 'false' ? false : (Number.isInteger(num) ? num : tp));
}

// Без CORS_ORIGIN не откатываемся в '*': по умолчанию — локальный фронтенд.
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json());

app.get('/health', async (req, res) => {
  let db = 'ok';
  try { await pool.query('SELECT 1'); } catch { db = 'error'; }
  res.json({ status: db === 'ok' ? 'ok' : 'degraded', db, ts: new Date().toISOString() });
});

app.use('/api/v1/auth',           require('./routes/auth'));
app.use('/api/v1/dashboard',      require('./routes/dashboard'));
app.use('/api/v1/invoices',       require('./routes/invoices'));
app.use('/api/v1/outgoing-invoices', require('./routes/outgoingInvoices'));
app.use('/api/v1/payments',       require('./routes/payments'));
app.use('/api/v1/payments',       require('./routes/bankImport'));
app.use('/api/v1/counterparties', require('./routes/counterparties'));
app.use('/api/v1/users',          require('./routes/users'));
app.use('/api/v1/audit',          require('./routes/audit'));
// Контур администратора платформы: свой вход (/platform/login) и свои
// роуты управления (/admin/*), защищённые platformAdminAuthMiddleware.
// Клиентский JWT сюда не проходит, платформенный не проходит в клиентские роуты.
app.use('/api/v1/platform',       require('./routes/platformAuth'));
app.use('/api/v1/admin',          require('./routes/admin'));
app.use('/api/v1/billing',        require('./routes/billing'));
app.use('/api/v1/organizations',  require('./routes/organizations'));
app.use('/api/v1/analytics',      require('./routes/analytics'));
app.use('/api/v1',                require('./routes/documents'));
app.use('/api/v1/public',         require('./routes/public'));

// БУДУЩЕЕ (не активно): точка расширения под опциональный платный модуль
// интеграции с ЭДО-провайдером (СБИС/Диадок) — не меняет текущее
// позиционирование продукта («не является системой ЭДО»). Заготовка
// клиента — services/api-gateway/src/lib/edoProvider.js. Реального роута
// пока нет и намеренно не подключается:
// app.use('/api/v1/edo', require('./routes/edo'));

app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.path} не найден` } });
});

async function start() {
  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] Connected to PostgreSQL');
      break;
    } catch (e) {
      retries--;
      console.log(`[DB] Waiting for PostgreSQL... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  startOverdueJob();
  startSubscriptionExpiryJob();
  startOverdueDigestJob();
  startDueSoonDigestJob();

  app.listen(port, () => {
    console.log('\n========================================');
    console.log(`  API Gateway: http://localhost:${port}`);
    console.log(`  Health:      http://localhost:${port}/health`);
    console.log(`  Dashboard:   http://localhost:${port}/api/v1/dashboard`);
    console.log('========================================\n');
  });
}

start().catch(console.error);
