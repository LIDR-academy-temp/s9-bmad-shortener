jest.mock('../repos/queue');
jest.mock('../repos/linksRepo');
jest.mock('pino', () => {
  const mockLogger = { error: jest.fn() };
  return jest.fn(() => mockLogger);
});

const queue = require('../repos/queue');
const linksRepo = require('../repos/linksRepo');
const pino = require('pino');

describe('services/clickConsumer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleMessage', () => {
    it('parses a well-formed message and calls linksRepo.incrementClickCount with the code', async () => {
      linksRepo.incrementClickCount.mockResolvedValue(undefined);
      const { handleMessage } = require('../services/clickConsumer');
      const content = Buffer.from(
        JSON.stringify({ code: 'abc1234', timestamp: '2026-09-02T00:00:00.000Z' })
      );

      await handleMessage(content);

      expect(linksRepo.incrementClickCount).toHaveBeenCalledTimes(1);
      expect(linksRepo.incrementClickCount).toHaveBeenCalledWith('abc1234');
    });

    it('drops a malformed JSON message, logs via pino, and does not call incrementClickCount', async () => {
      const { handleMessage } = require('../services/clickConsumer');
      const logger = pino();
      const content = Buffer.from('not-json{{{');

      await expect(handleMessage(content)).resolves.toBeUndefined();

      expect(linksRepo.incrementClickCount).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.any(String)
      );
    });

    it('drops a message with a missing code field without calling incrementClickCount', async () => {
      const { handleMessage } = require('../services/clickConsumer');
      const logger = pino();
      const content = Buffer.from(JSON.stringify({ timestamp: 'x' }));

      await handleMessage(content);

      expect(linksRepo.incrementClickCount).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('drops a message with a non-string code without calling incrementClickCount', async () => {
      const { handleMessage } = require('../services/clickConsumer');
      const logger = pino();
      const content = Buffer.from(JSON.stringify({ code: 123 }));

      await handleMessage(content);

      expect(linksRepo.incrementClickCount).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('logs and does not throw when incrementClickCount rejects', async () => {
      linksRepo.incrementClickCount.mockRejectedValue(new Error('pool error'));
      const { handleMessage } = require('../services/clickConsumer');
      const logger = pino();
      const content = Buffer.from(JSON.stringify({ code: 'abc1234' }));

      await expect(handleMessage(content)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.any(String)
      );
    });
  });

  describe('start', () => {
    it('wires handleMessage into queue.consumeQueue', async () => {
      queue.consumeQueue.mockResolvedValue(undefined);
      const clickConsumer = require('../services/clickConsumer');

      await clickConsumer.start();

      expect(queue.consumeQueue).toHaveBeenCalledTimes(1);
      expect(queue.consumeQueue).toHaveBeenCalledWith(clickConsumer.handleMessage);
    });

    it('catches and logs a rejection from queue.consumeQueue without throwing', async () => {
      queue.consumeQueue.mockRejectedValue(new Error('connection refused'));
      const clickConsumer = require('../services/clickConsumer');
      const logger = pino();

      await expect(clickConsumer.start()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.any(String)
      );
    });
  });
});
