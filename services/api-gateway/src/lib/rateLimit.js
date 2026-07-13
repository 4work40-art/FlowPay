const { redis } = require('./db');
const { err } = require('./http');

// In-memory fallback на случай недоступности Redis: лимиты на auth-эндпоинтах
// не должны молча исчезать (иначе падение Redis открывает перебор паролей).
// Один процесс — одна Map; при нескольких инстансах лимит станет мягче,
// но не нулевым.
const memory = new Map(); // key -> { count, resetAt }

function memoryHit(key, windowSeconds) {
  const now = Date.now();
  const rec = memory.get(key);
  if (!rec || rec.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { count: 1, ttl: windowSeconds };
  }
  rec.count += 1;
  return { count: rec.count, ttl: Math.ceil((rec.resetAt - now) / 1000) };
}

// Периодическая уборка истёкших записей, чтобы Map не росла бесконечно.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
}, 60 * 1000).unref();

// Простой fixed-window лимитер: Redis как основное хранилище,
// in-memory — как деградация при его недоступности.
function rateLimit({ keyFn, max, windowSeconds, message }) {
  return async function rateLimitMiddleware(req, res, next) {
    const key = `rl:${keyFn(req)}`;
    let count, ttl;
    try {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      ttl = count > max ? await redis.ttl(key) : 0;
    } catch (e) {
      console.warn('[rateLimit] Redis недоступен, лимит в памяти процесса:', e.message);
      ({ count, ttl } = memoryHit(key, windowSeconds));
    }
    if (count > max) {
      res.set('Retry-After', String(ttl > 0 ? ttl : windowSeconds));
      return err(res, 429, message || 'Слишком много попыток, попробуйте позже', 'RATE_LIMITED');
    }
    next();
  };
}

module.exports = { rateLimit };
