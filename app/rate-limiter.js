const TOKENS_PER_SECOND = 1;
const BUCKET_SIZE = 15;
const REQUEST_COST = 3;

const userBuckets = new Map();

function getClientIp(req) {
  return req.headers['x-forwarded-for'] ||
         req.socket.remoteAddress ||
         null;
}

function rateLimiter(req, res, next) {
  const ip = getClientIp(req);

  if (!ip) {
    return res.status(400).send({ error: 'Unable to identify client' });
  }

  const now = Date.now();

  if (!userBuckets.has(ip)) {
    userBuckets.set(ip, {
      lastRefill: now,
      tokens: BUCKET_SIZE - REQUEST_COST
    });
    return next();
  }

  const bucket = userBuckets.get(ip);
  const timeElapsed = (now - bucket.lastRefill) / 1000;
  const tokensToAdd = timeElapsed * TOKENS_PER_SECOND;
  const currentTokens = Math.min(bucket.tokens + tokensToAdd, BUCKET_SIZE);

  if (currentTokens >= REQUEST_COST) {
    userBuckets.set(ip, {
      lastRefill: now,
      tokens: currentTokens - REQUEST_COST
    });
    return next();
  } else {
    const tokensRecovered = Math.floor(tokensToAdd);
    if (tokensRecovered > 0) {
      userBuckets.set(ip, {
        lastRefill: now,
        tokens: currentTokens
      });
    }
    return res.status(429).send({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((REQUEST_COST - currentTokens) / TOKENS_PER_SECOND)
    });
  }
}

module.exports = {
  rateLimiter,
  getClientIp,
  TOKENS_PER_SECOND,
  BUCKET_SIZE,
  REQUEST_COST,
  userBuckets
};
