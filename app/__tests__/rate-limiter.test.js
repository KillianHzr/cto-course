const { rateLimiter, getClientIp, userBuckets, BUCKET_SIZE, REQUEST_COST } = require('../rate-limiter');

describe('rate-limiter', () => {
  let req, res, next;

  beforeEach(() => {
    userBuckets.clear();
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
    test('should allow first request and initialize bucket', () => {
      rateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(userBuckets.has('127.0.0.1')).toBe(true);
      expect(userBuckets.get('127.0.0.1').tokens).toBe(BUCKET_SIZE - REQUEST_COST);
    });

    test('should allow multiple requests within token limit', () => {
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(3);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should block request when tokens exhausted', () => {
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Too many requests. Please try again later.'
        })
      );
    });

    test('should return 400 when client IP cannot be identified', () => {
      req.headers = {};
      req.socket = {};

      rateLimiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith({ error: 'Unable to identify client' });
      expect(next).not.toHaveBeenCalled();
    });

    test('should refill tokens over time', (done) => {
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);

      const nextMock = jest.fn();
      const resMock = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };

      setTimeout(() => {
        rateLimiter(req, resMock, nextMock);
        expect(nextMock).toHaveBeenCalled();
        done();
      }, 3100);
    }, 5000);

    test('should handle different IPs independently', () => {
      const req2 = {
        headers: {},
        socket: { remoteAddress: '192.168.1.2' }
      };

      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);

      const next2 = jest.fn();
      const res2 = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };

      rateLimiter(req2, res2, next2);

      expect(next2).toHaveBeenCalled();
      expect(res2.status).not.toHaveBeenCalled();
    });

    test('should update bucket when tokens recovered but request still blocked', (done) => {
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);
      rateLimiter(req, res, next);

      const resMock = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn()
      };
      const nextMock = jest.fn();

      setTimeout(() => {
        const bucketBefore = userBuckets.get('127.0.0.1').tokens;
        rateLimiter(req, resMock, nextMock);

        expect(resMock.status).toHaveBeenCalledWith(429);
        expect(nextMock).not.toHaveBeenCalled();

        const bucketAfter = userBuckets.get('127.0.0.1').tokens;
        expect(bucketAfter).toBeGreaterThan(bucketBefore);
        done();
      }, 1500);
    }, 3000);
  });
});
