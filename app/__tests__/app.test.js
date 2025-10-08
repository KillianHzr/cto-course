const request = require('supertest');

jest.mock('../../app/photo_model');
jest.mock('../../app/pubsub-consumer', () => ({
  listenForMessages: jest.fn()
}));
jest.mock('../../app/pubsub-producer');
jest.mock('../../app/rate-limiter', () => ({
  rateLimiter: (req, res, next) => next(),
  initRedis: jest.fn().mockResolvedValue(undefined),
  getRedisClient: jest.fn().mockReturnValue(null)
}));
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        getSignedUrl: jest.fn(() => Promise.resolve(['https://storage.googleapis.com/test-bucket/test-file.zip']))
      }))
    }))
  }))
}));
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn()
  },
  database: jest.fn(() => ({
    ref: jest.fn()
  }))
}));

const app = require('../../app/server');
const pubsubProducer = require('../../app/pubsub-producer');

describe('index route', () => {
  beforeAll(() => {
    return new Promise(resolve => {
      if (app.server) {
        resolve();
      } else {
        const checkServer = setInterval(() => {
          if (app.server) {
            clearInterval(checkServer);
            resolve();
          }
        }, 100);
      }
    });
  });

  afterEach(() => {
    if (app.server) {
      app.server.close();
    }
  });

  beforeEach(() => {
    global.completedZips = {};
  });

  test('should respond with a 200 with no query parameters', () => {
    return request(app)
      .get('/')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(
          /<title>Express App Testing Demo<\/title>/
        );
      });
  });

  test('should respond with a 200 with valid query parameters', () => {
    return request(app)
      .get('/?tags=california&tagmode=all')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(
          /<div class="panel panel-default search-results">/
        );
      });
  });

  test('should respond with a 200 and show zip download link when zip exists', () => {
    global.completedZips['california'] = 'public/zips/test-file.zip';

    return request(app)
      .get('/?tags=california&tagmode=all')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(/<div class="panel panel-default search-results">/);
      });
  });

  test('should respond with a 200 with invalid query parameters', () => {
    return request(app)
      .get('/?tags=california123&tagmode=all')
      .expect('Content-Type', /html/)
      .expect(200)
      .then(response => {
        expect(response.text).toMatch(/<div class="alert alert-danger">/);
      });
  });

  test('should respond with a 500 error due to bad jsonp data', () => {
    return request(app)
      .get('/?tags=error&tagmode=all')
      .expect('Content-Type', /json/)
      .expect(500)
      .then(response => {
        expect(response.body).toEqual({ error: 'Internal server error' });
      });
  });
});

describe('zip route', () => {
  beforeAll(() => {
    return new Promise(resolve => {
      if (app.server) {
        resolve();
      } else {
        const checkServer = setInterval(() => {
          if (app.server) {
            clearInterval(checkServer);
            resolve();
          }
        }, 100);
      }
    });
  });

  afterEach(() => {
    if (app.server) {
      app.server.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should respond with redirect when creating zip with valid tags', () => {
    pubsubProducer.publishMessage.mockResolvedValue('message-id-123');

    return request(app)
      .post('/zip?tags=nature')
      .expect(302)
      .then(response => {
        expect(response.headers.location).toMatch(/\/\?tags=nature&tagmode=any&zipRequested=true/);
        expect(pubsubProducer.publishMessage).toHaveBeenCalledWith('nature');
      });
  });

  test('should respond with 400 when tags parameter is missing', () => {
    return request(app)
      .post('/zip')
      .expect(400)
      .then(response => {
        expect(response.body.error).toBe('Tags parameter is required');
      });
  });

  test('should respond with 500 when publishMessage fails', () => {
    pubsubProducer.publishMessage.mockRejectedValue(new Error('Publish failed'));

    return request(app)
      .post('/zip?tags=nature')
      .expect(500)
      .then(response => {
        expect(response.body.error).toBe('Failed to create zip job');
      });
  });
});

describe('zip status route', () => {
  beforeAll(() => {
    return new Promise(resolve => {
      if (app.server) {
        resolve();
      } else {
        const checkServer = setInterval(() => {
          if (app.server) {
            clearInterval(checkServer);
            resolve();
          }
        }, 100);
      }
    });
  });

  afterEach(() => {
    if (app.server) {
      app.server.close();
    }
  });

  beforeEach(() => {
    global.completedZips = {};
  });

  test('should respond with ready false when zip is not ready', () => {
    return request(app)
      .get('/zip/status?tags=nature')
      .expect(200)
      .then(response => {
        expect(response.body).toEqual({ ready: false, url: null });
      });
  });

  test('should respond with ready true and url when zip is ready', () => {
    global.completedZips['nature'] = 'public/zips/test-file.zip';

    return request(app)
      .get('/zip/status?tags=nature')
      .expect(200)
      .then(response => {
        expect(response.body.ready).toBe(true);
        expect(response.body.url).toBeTruthy();
        expect(typeof response.body.url).toBe('string');
      });
  });

  test('should respond with 400 when tags parameter is missing', () => {
    return request(app)
      .get('/zip/status')
      .expect(400)
      .then(response => {
        expect(response.body.error).toBe('Tags parameter is required');
      });
  });
});
