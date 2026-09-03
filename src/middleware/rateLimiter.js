const { AppError } = require('../utils/AppError');

const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_WINDOW_MS = 60 * 1000;

function createRateLimiter({
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
  keyGenerator = defaultKeyGenerator
} = {}) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (now - entry.windowStart > windowMs) {
        hits.delete(key);
      }
    }
  }, windowMs).unref();

  return function rateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { windowStart: now, count: 0 };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      return next(new AppError('Too many requests. Please slow down.', 429));
    }

    return next();
  };
}

function defaultKeyGenerator(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

module.exports = { createRateLimiter };
