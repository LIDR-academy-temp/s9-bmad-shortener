jest.mock('../repos/queue');
jest.mock('pino', () => {
  const mockLogger = { error: jest.fn() };
  return jest.fn(() => mockLogger);
});

const queue = require('../repos/queue');
const pino = require('pino');

describe('services/clickPublisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishClickEvent calls queue.publishToQueue with { code, timestamp }', async () => {
    queue.publishToQueue.mockResolvedValue(undefined);
    const { publishClickEvent } = require('../services/clickPublisher');

    await publishClickEvent('abc1234');

    expect(queue.publishToQueue).toHaveBeenCalledTimes(1);
    const [message] = queue.publishToQueue.mock.calls[0];
    expect(message.code).toBe('abc1234');
    expect(typeof message.timestamp).toBe('string');
    expect(new Date(message.timestamp).toISOString()).toBe(message.timestamp);
  });

  it('never rejects and logs via pino when queue.publishToQueue rejects', async () => {
    queue.publishToQueue.mockRejectedValue(new Error('publish failed'));
    const { publishClickEvent } = require('../services/clickPublisher');
    const logger = pino();

    await expect(publishClickEvent('abc1234')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'abc1234' }),
      expect.any(String)
    );
  });
});
