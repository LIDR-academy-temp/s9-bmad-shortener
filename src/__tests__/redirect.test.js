jest.mock('../repos/cache');
jest.mock('../repos/linksRepo');
jest.mock('../repos/db', () => ({
  pool: { query: jest.fn() },
  bootstrapSchema: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const cache = require('../repos/cache');
const linksRepo = require('../repos/linksRepo');

describe('GET /:code', () => {
  beforeEach(() => {
    cache.getCachedUrl.mockReset();
    cache.setCachedUrl.mockReset().mockResolvedValue(undefined);
    linksRepo.findByCode.mockReset();
  });

  it('redirects 302 from Redis on a cache hit without querying Postgres', async () => {
    cache.getCachedUrl.mockResolvedValue('https://example.com/cached');

    const res = await request(app).get('/abc1234');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/cached');
    expect(linksRepo.findByCode).not.toHaveBeenCalled();
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
  });

  it('falls through to Postgres and still redirects 302 when the cache read rejects', async () => {
    cache.getCachedUrl.mockRejectedValue(new Error('redis unreachable'));
    linksRepo.findByCode.mockResolvedValue('https://example.com/from-db');

    const res = await request(app).get('/ghi9012');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/from-db');
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
});
