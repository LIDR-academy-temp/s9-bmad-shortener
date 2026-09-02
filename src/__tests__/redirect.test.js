jest.mock('../repos/cache');
jest.mock('../repos/linksRepo');
jest.mock('../repos/db', () => ({
  pool: { query: jest.fn() },
  bootstrapSchema: jest.fn(),
}));
jest.mock('../services/clickPublisher');

const request = require('supertest');
const app = require('../app');
const cache = require('../repos/cache');
const linksRepo = require('../repos/linksRepo');
const clickPublisher = require('../services/clickPublisher');

describe('GET /:code', () => {
  beforeEach(() => {
    cache.getCachedUrl.mockReset();
    cache.setCachedUrl.mockReset().mockResolvedValue(undefined);
    linksRepo.findByCode.mockReset();
    clickPublisher.publishClickEvent.mockReset().mockResolvedValue(undefined);
  });

  it('redirects 302 from Redis on a cache hit without querying Postgres', async () => {
    cache.getCachedUrl.mockResolvedValue('https://example.com/cached');

    const res = await request(app).get('/abc1234');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/cached');
    expect(linksRepo.findByCode).not.toHaveBeenCalled();
    expect(clickPublisher.publishClickEvent).toHaveBeenCalledWith('abc1234');
  });

  it('redirects 302 from Postgres on cache miss and populates Redis before responding', async () => {
    cache.getCachedUrl.mockResolvedValue(null);
    linksRepo.findByCode.mockResolvedValue('https://example.com/from-db');

    const res = await request(app).get('/def5678');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/from-db');
    expect(cache.setCachedUrl).toHaveBeenCalledWith(
      'def5678',
      'https://example.com/from-db'
    );
    expect(clickPublisher.publishClickEvent).toHaveBeenCalledWith('def5678');
  });

  it('falls through to Postgres and still redirects 302 when the cache read rejects', async () => {
    cache.getCachedUrl.mockRejectedValue(new Error('redis unreachable'));
    linksRepo.findByCode.mockResolvedValue('https://example.com/from-db');

    const res = await request(app).get('/ghi9012');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/from-db');
    expect(clickPublisher.publishClickEvent).toHaveBeenCalledWith('ghi9012');
  });

  it('still redirects 302 after a Postgres hit when the cache write rejects', async () => {
    cache.getCachedUrl.mockResolvedValue(null);
    linksRepo.findByCode.mockResolvedValue('https://example.com/from-db');
    cache.setCachedUrl.mockReset().mockRejectedValue(new Error('redis unreachable'));

    const res = await request(app).get('/jkl3456');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/from-db');
  });

  it('returns 404 when the code is absent from both Redis and Postgres', async () => {
    cache.getCachedUrl.mockResolvedValue(null);
    linksRepo.findByCode.mockResolvedValue(undefined);

    const res = await request(app).get('/nowhere1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'short code not found' });
    expect(cache.setCachedUrl).not.toHaveBeenCalled();
    expect(clickPublisher.publishClickEvent).not.toHaveBeenCalled();
  });

  it('returns 404 immediately for a malformed code without touching Redis or Postgres', async () => {
    const res = await request(app).get('/short');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'short code not found' });
    expect(cache.getCachedUrl).not.toHaveBeenCalled();
    expect(linksRepo.findByCode).not.toHaveBeenCalled();
  });

  it('returns 404 for a code containing non-base62 characters', async () => {
    const res = await request(app).get('/abc-123');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'short code not found' });
    expect(cache.getCachedUrl).not.toHaveBeenCalled();
  });

  it('still redirects 302 promptly when clickPublisher.publishClickEvent rejects', async () => {
    cache.getCachedUrl.mockResolvedValue('https://example.com/cached');
    clickPublisher.publishClickEvent.mockRejectedValue(new Error('publish failed'));

    const res = await request(app).get('/abc1234');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/cached');
  });

  it('still redirects 302 promptly when clickPublisher.publishClickEvent hangs', async () => {
    cache.getCachedUrl.mockResolvedValue('https://example.com/cached');
    clickPublisher.publishClickEvent.mockReturnValue(new Promise(() => {}));

    const res = await request(app).get('/abc1234');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/cached');
  });
});
