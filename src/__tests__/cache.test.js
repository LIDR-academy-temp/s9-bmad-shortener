const mockGet = jest.fn();
const mockSet = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);

const mockClient = {
  isOpen: false,
  connect: mockConnect,
  get: mockGet,
  set: mockSet,
};

const mockCreateClient = jest.fn().mockImplementation(() => mockClient);

jest.mock('redis', () => ({ createClient: mockCreateClient }));

describe('repos/cache', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateClient.mockClear();
    mockConnect.mockClear();
    mockGet.mockClear();
    mockSet.mockClear();
    mockClient.isOpen = false;
  });

  it('constructs the Redis client at require time without connecting', () => {
    require('../repos/cache');

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: process.env.REDIS_URL,
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('getCachedUrl connects lazily and issues GET for the namespaced key', async () => {
    mockGet.mockResolvedValue('https://example.com/long');
    const { getCachedUrl } = require('../repos/cache');

    const result = await getCachedUrl('abc1234');

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('shorturl:abc1234');
    expect(result).toBe('https://example.com/long');
  });

  it('getCachedUrl does not reconnect once the client is already open', async () => {
    mockClient.isOpen = true;
    mockGet.mockResolvedValue(null);
    const { getCachedUrl } = require('../repos/cache');

    await getCachedUrl('abc1234');

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('setCachedUrl connects lazily and issues SET for the namespaced key', async () => {
    const { setCachedUrl } = require('../repos/cache');

    await setCachedUrl('abc1234', 'https://example.com/long');

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      'shorturl:abc1234',
      'https://example.com/long'
    );
  });

  it('dedupes concurrent connect attempts on a cold client to a single connect() call', async () => {
    mockGet.mockResolvedValue('https://example.com/long');
    const { getCachedUrl, setCachedUrl } = require('../repos/cache');

    await Promise.all([
      getCachedUrl('abc1234'),
      getCachedUrl('def5678'),
      setCachedUrl('ghi9012', 'https://example.com/other'),
    ]);

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
