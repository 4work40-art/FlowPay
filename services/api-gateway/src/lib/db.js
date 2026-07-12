const { Pool } = require('pg');
const Redis    = require('ioredis');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://sk_user:sk_secret_local@localhost:5432/schyot_kontrol',
});
pool.on('error', (e) => console.warn('[PG error]', e.message));

const redis = new Redis(
  process.env.REDIS_URL || 'redis://:sk_redis_local@localhost:6379',
  { lazyConnect: true, maxRetriesPerRequest: 2 }
);
redis.on('error', (e) => console.warn('[Redis error]', e.message));
redis.connect().catch((e) => console.warn('[Redis connect]', e.message));

module.exports = { pool, redis };
