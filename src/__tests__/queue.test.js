const mockSendToQueue = jest.fn();
const mockAssertQueue = jest.fn().mockResolvedValue(undefined);
const mockConsume = jest.fn().mockResolvedValue(undefined);
const mockChannel = {
  assertQueue: mockAssertQueue,
  sendToQueue: mockSendToQueue,
  consume: mockConsume,
  on: jest.fn(),
};
const mockCreateChannel = jest.fn().mockResolvedValue(mockChannel);
const mockConnection = { createChannel: mockCreateChannel, on: jest.fn() };
const mockConnect = jest.fn().mockResolvedValue(mockConnection);

jest.mock('amqplib', () => ({ connect: mockConnect }));
jest.mock('pino', () => jest.fn(() => ({ error: jest.fn() })));

describe('repos/queue', () => {
  beforeEach(() => {
    jest.resetModules();
    mockConnect.mockClear();
    mockCreateChannel.mockClear();
    mockAssertQueue.mockClear();
    mockSendToQueue.mockClear();
    mockConsume.mockClear();
    mockConnect.mockResolvedValue(mockConnection);
    mockCreateChannel.mockResolvedValue(mockChannel);
    mockAssertQueue.mockResolvedValue(undefined);
    mockConsume.mockResolvedValue(undefined);
  });

  it('does not connect to amqplib at require time', () => {
    require('../repos/queue');

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('publishToQueue lazily connects, opens a channel, asserts the durable queue, and sends a persistent message', async () => {
    const { publishToQueue } = require('../repos/queue');

    await publishToQueue({ code: 'abc1234', timestamp: '2026-09-02T00:00:00.000Z' });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockCreateChannel).toHaveBeenCalledTimes(1);
    expect(mockAssertQueue).toHaveBeenCalledWith('click-events', {
      durable: true,
    });
    expect(mockSendToQueue).toHaveBeenCalledTimes(1);

    const [queueName, payload, options] = mockSendToQueue.mock.calls[0];
    expect(queueName).toBe('click-events');
    expect(Buffer.isBuffer(payload)).toBe(true);
    expect(JSON.parse(payload.toString())).toEqual({
      code: 'abc1234',
      timestamp: '2026-09-02T00:00:00.000Z',
    });
    expect(options).toEqual({ persistent: true });
  });

  it('propagates a rejection from publishToQueue when amqp.connect fails', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'));
    const { publishToQueue } = require('../repos/queue');

    await expect(publishToQueue({ code: 'abc1234', timestamp: 'x' })).rejects.toThrow(
      'connection refused'
    );
  });

  it('propagates a rejection from publishToQueue when assertQueue fails', async () => {
    mockAssertQueue.mockRejectedValue(new Error('assert failed'));
    const { publishToQueue } = require('../repos/queue');

    await expect(publishToQueue({ code: 'abc1234', timestamp: 'x' })).rejects.toThrow(
      'assert failed'
    );
  });

  it('reuses the cached connection and channel across consecutive successful calls', async () => {
    const { publishToQueue } = require('../repos/queue');

    await publishToQueue({ code: 'abc1234', timestamp: 'x' });
    await publishToQueue({ code: 'def5678', timestamp: 'y' });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockCreateChannel).toHaveBeenCalledTimes(1);
    expect(mockSendToQueue).toHaveBeenCalledTimes(2);
  });

  it('retries connecting on the next call after a prior failure', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection refused'));
    const { publishToQueue } = require('../repos/queue');

    await expect(
      publishToQueue({ code: 'abc1234', timestamp: 'x' })
    ).rejects.toThrow('connection refused');

    await publishToQueue({ code: 'abc1234', timestamp: 'x' });

    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(mockSendToQueue).toHaveBeenCalledTimes(1);
  });

  describe('consumeQueue', () => {
    it('lazily connects, opens a channel, asserts the durable queue, and consumes with noAck: true', async () => {
      const { consumeQueue } = require('../repos/queue');
      const onMessage = jest.fn();

      await consumeQueue(onMessage);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockCreateChannel).toHaveBeenCalledTimes(1);
      expect(mockAssertQueue).toHaveBeenCalledWith('click-events', {
        durable: true,
      });
      expect(mockConsume).toHaveBeenCalledTimes(1);

      const [queueName, , options] = mockConsume.mock.calls[0];
      expect(queueName).toBe('click-events');
      expect(options).toEqual({ noAck: true });
    });

    it('invokes onMessage with msg.content when a message arrives', async () => {
      const { consumeQueue } = require('../repos/queue');
      const onMessage = jest.fn();

      await consumeQueue(onMessage);

      const [, handler] = mockConsume.mock.calls[0];
      const content = Buffer.from(JSON.stringify({ code: 'abc1234' }));
      handler({ content });

      expect(onMessage).toHaveBeenCalledWith(content);
    });

    it('does not invoke onMessage when msg is null', async () => {
      const { consumeQueue } = require('../repos/queue');
      const onMessage = jest.fn();

      await consumeQueue(onMessage);

      const [, handler] = mockConsume.mock.calls[0];
      handler(null);

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('reuses the shared connection with publishToQueue', async () => {
      const { publishToQueue, consumeQueue } = require('../repos/queue');

      await publishToQueue({ code: 'abc1234', timestamp: 'x' });
      await consumeQueue(jest.fn());

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockCreateChannel).toHaveBeenCalledTimes(2);
    });

    it('propagates a rejection from consumeQueue when amqp.connect fails', async () => {
      mockConnect.mockRejectedValue(new Error('connection refused'));
      const { consumeQueue } = require('../repos/queue');

      await expect(consumeQueue(jest.fn())).rejects.toThrow(
        'connection refused'
      );
    });
  });
});
