const mockSendToQueue = jest.fn();
const mockAssertQueue = jest.fn().mockResolvedValue(undefined);
const mockChannel = {
  assertQueue: mockAssertQueue,
  sendToQueue: mockSendToQueue,
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
    mockConnect.mockResolvedValue(mockConnection);
    mockCreateChannel.mockResolvedValue(mockChannel);
    mockAssertQueue.mockResolvedValue(undefined);
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
});
