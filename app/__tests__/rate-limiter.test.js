const mockRedisStore = new Map();

const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn((key) => Promise.resolve(mockRedisStore.get(key))),
  set: jest.fn((key, value) => {
    mockRedisStore.set(key, value);
    return Promise.resolve();
  }),
  flushDb: jest.fn(() => {
    mockRedisStore.clear();
    return Promise.resolve();
  }),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn()
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

const { rateLimiter, getClientIp, initRedis, getRedisClient, BUCKET_SIZE, REQUEST_COST } = require('../rate-limiter');

describe('rate-limiter', () => {
  let req, res, next;

  beforeAll(async () => {
    await initRedis();
  });

  beforeEach(async () => {
    const redisClient = getRedisClient();
    if (redisClient) {
      await redisClient.flushDb();
    }
    req = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
    next = jest.fn();
  });

  afterAll(async () => {
    const redisClient = getRedisClient();
    if (redisClient) {
      await redisClient.quit();
    }
  });

  describe('getClientIp', () => {
    test('should get IP from x-forwarded-for header', () => {
      req.headers['x-forwarded-for'] = '192.168.1.1';
      expect(getClientIp(req)).toBe('192.168.1.1');
    });

    test('should get IP from socket.remoteAddress when no header', () => {
      expect(getClientIp(req)).toBe('127.0.0.1');
    });

    test('should return null when no IP available', () => {
      req.headers = {};
      req.socket = {};
      expect(getClientIp(req)).toBe(null);
    });
  });

  describe('rateLimiter', () => {
    test('should allow first request and initialize bucket', async () => {
      await rateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      const redisClient = getRedisClient();
      const bucketData = await redisClient.get('rate_limit:127.0.0.1');
      const bucket = JSON.parse(bucketData);
      expect(bucket.tokens).toBe(BUCKET_SIZE - REQUEST_COST);
    });

    test('should allow multiple requests within token limit', async () => {
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(3);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should block request when tokens exhausted', async () => {
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too many requests. Please try again later.'
        })
      );
    });

    test('should return 400 when client IP cannot be identified', async () => {
      req.headers = {};
      req.socket = {};

      await rateLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith({ error: 'Unable to identify client' });
      expect(next).not.toHaveBeenCalled();
    });

    test('should refill tokens over time', async () => {
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);

      const nextMock = jest.fn();
      const resMock = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };

      await new Promise(resolve => setTimeout(resolve, 3100));
      await rateLimiter(req, resMock, nextMock);
      expect(nextMock).toHaveBeenCalled();
    }, 10000);

    test('should handle different IPs independently', async () => {
      const req2 = {
        headers: {},
        socket: { remoteAddress: '192.168.1.2' }
      };

      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);

      const next2 = jest.fn();
      const res2 = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };

      await rateLimiter(req2, res2, next2);

      expect(next2).toHaveBeenCalled();
      expect(res2.status).not.toHaveBeenCalled();
    });

    test('should update bucket when tokens recovered but request still blocked', async () => {
      const redisClient = getRedisClient();

      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);
      await rateLimiter(req, res, next);

      const resMock = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };
      const nextMock = jest.fn();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const bucketDataBefore = await redisClient.get('rate_limit:127.0.0.1');
      const bucketBefore = JSON.parse(bucketDataBefore);

      await rateLimiter(req, resMock, nextMock);

      expect(resMock.status).toHaveBeenCalledWith(429);
      expect(nextMock).not.toHaveBeenCalled();

      const bucketDataAfter = await redisClient.get('rate_limit:127.0.0.1');
      const bucketAfter = JSON.parse(bucketDataAfter);
      expect(bucketAfter.tokens).toBeGreaterThan(bucketBefore.tokens);
    }, 10000);
  });
});
