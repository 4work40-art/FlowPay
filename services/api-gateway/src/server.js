const express = require('express');
const cors    = require('cors');
const { pool } = require('./lib/db');

const app  = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/health', async (req, res) => {
  let db = 'ok';
  try { await pool.query('SELECT 1'); } catch { db = 'error'; }
  res.json({ status: db === 'ok' ? 'ok' : 'degraded', db, ts: new Date().toISOString() });
});

app.use('/api/v1/auth',           require('./routes/auth'));
app.use('/api/v1/dashboard',      require('./routes/dashboard'));
app.use('/api/v1/invoices',       require('./routes/invoices'));
app.use('/api/v1/payments',       require('./routes/payments'));
app.use('/api/v1/counterparties', require('./routes/counterparties'));
app.use('/api/v1/users',          require('./routes/users'));
app.use('/api/v1/audit',          require('./routes/audit'));
app.use('/api/v1/admin',          require('./routes/admin'));

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

  app.listen(port, () => {
    console.log('\n========================================');
    console.log(`  API Gateway: http://localhost:${port}`);
    console.log(`  Health:      http://localhost:${port}/health`);
    console.log(`  Dashboard:   http://localhost:${port}/api/v1/dashboard`);
    console.log('========================================\n');
  });
}

start().catch(console.error);
