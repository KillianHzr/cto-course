const { createClient } = require('redis');

const TOKENS_PER_SECOND = 1;
const BUCKET_SIZE = 15;
const REQUEST_COST = 3;

let redisClient = null;

async function initRedis() {
  redisClient = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT)
    }
  });

  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  await redisClient.connect();
  console.log('Redis connected');
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] ||
         req.socket.remoteAddress ||
         null;
}

async function rateLimiter(req, res, next) {
  const ip = getClientIp(req);

  if (!ip) {
    return res.status(400).send({ error: 'Unable to identify client' });
  }

  const now = Date.now();
  const key = `rate_limit:${ip}`;

  try {
    const bucketData = await redisClient.get(key);

    if (!bucketData) {
      await redisClient.set(key, JSON.stringify({
        lastRefill: now,
        tokens: BUCKET_SIZE - REQUEST_COST
      }));
      return next();
    }

    const bucket = JSON.parse(bucketData);
    const timeElapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = timeElapsed * TOKENS_PER_SECOND;
    const currentTokens = Math.min(bucket.tokens + tokensToAdd, BUCKET_SIZE);

    if (currentTokens >= REQUEST_COST) {
      await redisClient.set(key, JSON.stringify({
        lastRefill: now,
        tokens: currentTokens - REQUEST_COST
      }));
      return next();
    } else {
      const tokensRecovered = Math.floor(tokensToAdd);
      if (tokensRecovered > 0) {
        await redisClient.set(key, JSON.stringify({
          lastRefill: now,
          tokens: currentTokens
        }));
      }
      return res.status(429).send({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((REQUEST_COST - currentTokens) / TOKENS_PER_SECOND)
      });
    }
  } catch (error) {
    console.error('Redis error:', error);
    return res.status(500).send({ error: 'Internal server error' });
  }
}

module.exports = {
  rateLimiter,
  getClientIp,
  initRedis,
  TOKENS_PER_SECOND,
  BUCKET_SIZE,
  REQUEST_COST,
  getRedisClient: () => redisClient
};
