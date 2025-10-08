jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn()
  },
  database: jest.fn(() => ({
    ref: jest.fn()
  }))
}));

const { initFirebase, getDatabase } = require('../firebase-admin');
const admin = require('firebase-admin');

describe('firebase-admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initFirebase', () => {
    test('should initialize Firebase and return database instance', () => {
      const mockDb = { ref: jest.fn() };
      admin.database.mockReturnValue(mockDb);

      const result = initFirebase();

      expect(admin.initializeApp).toHaveBeenCalled();
      expect(admin.database).toHaveBeenCalled();
      expect(result).toBe(mockDb);
    });
  });

  describe('getDatabase', () => {
    test('should return the database instance', () => {
      initFirebase();
      const result = getDatabase();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('ref');
    });
  });
});
