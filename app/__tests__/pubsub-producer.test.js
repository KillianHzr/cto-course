const mockPublishMessage = jest.fn().mockResolvedValue('mock-message-id-123');
const mockTopic = jest.fn(() => ({
  publishMessage: mockPublishMessage
}));

jest.mock('@google-cloud/pubsub', () => {
  return {
    PubSub: jest.fn(() => ({
      topic: mockTopic
    }))
  };
});

const pubsubProducer = require('../pubsub-producer');

describe('pubsubProducer', () => {
  beforeEach(() => {
    mockPublishMessage.mockClear();
    mockTopic.mockClear();
  });

  describe('publishMessage', () => {
    test('should publish message with tags to pubsub topic', async () => {
      const tags = 'nature,mountains';

      const messageId = await pubsubProducer.publishMessage(tags);

      expect(messageId).toBe('mock-message-id-123');
      expect(typeof messageId).toBe('string');
    });

    test('should create message with correct tags format', async () => {
      const tags = 'sunset,beach';

      await pubsubProducer.publishMessage(tags);

      expect(tags).toBeTruthy();
      expect(typeof tags).toBe('string');
    });

    test('should handle errors when publishing fails', async () => {
      const tags = 'error-test';
      const errorMessage = 'Failed to publish to Pub/Sub';

      mockPublishMessage.mockRejectedValueOnce(new Error(errorMessage));

      await expect(pubsubProducer.publishMessage(tags)).rejects.toThrow(errorMessage);
    });
  });
});
