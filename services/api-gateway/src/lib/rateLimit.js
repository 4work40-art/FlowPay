const { redis } = require('./db');
const { err } = require('./http');

// Простой fixed-window лимитер на Redis. Не блокирует запрос, если Redis
// недоступен — деградация в "без лимита" безопаснее, чем полный отказ auth.
function rateLimit({ keyFn, max, windowSeconds, message }) {
  return async function rateLimitMiddleware(req, res, next) {
    const key = `rl:${keyFn(req)}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      if (count > max) {
        const ttl = await redis.ttl(key);
        res.set('Retry-After', String(ttl > 0 ? ttl : windowSeconds));
        return err(res, 429, message || 'Слишком много попыток, попробуйте позже', 'RATE_LIMITED');
      }
    } catch (e) {
      console.warn('[rateLimit] skipped:', e.message);
    }
    next();
  };
}

module.exports = { rateLimit };
