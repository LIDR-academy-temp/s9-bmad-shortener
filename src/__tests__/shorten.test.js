process.env.BASE_URL = 'http://short.local/';

jest.mock('../repos/linksRepo');
jest.mock('../repos/db', () => ({
  pool: { query: jest.fn() },
  bootstrapSchema: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const linksRepo = require('../repos/linksRepo');

const BASE_URL = process.env.BASE_URL;

describe('POST /shorten', () => {
  beforeEach(() => {
    linksRepo.insertLink.mockReset();
    linksRepo.insertLink.mockResolvedValue(undefined);
  });

  it('returns 201 with shortUrl and code for a valid https URL', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'https://example.com/very/long/path' });

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(res.body.shortUrl).toBe(`${BASE_URL}${res.body.code}`);
    expect(linksRepo.insertLink).toHaveBeenCalledWith({
      code: res.body.code,
      longUrl: 'https://example.com/very/long/path',
    });
  });

  it('returns 201 for a valid http URL', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'http://example.com' });

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(res.body.shortUrl).toBe(`${BASE_URL}${res.body.code}`);
  });

  it('returns 400 when url is missing', async () => {
    const res = await request(app).post('/shorten').send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'url must be a valid http(s) URL' });
    expect(linksRepo.insertLink).not.toHaveBeenCalled();
  });

  it('returns 400 when url is an empty string', async () => {
    const res = await request(app).post('/shorten').send({ url: '' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'url must be a valid http(s) URL' });
    expect(linksRepo.insertLink).not.toHaveBeenCalled();
  });

  it('returns 400 when url is not a string', async () => {
    const res = await request(app).post('/shorten').send({ url: 123 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'url must be a valid http(s) URL' });
    expect(linksRepo.insertLink).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed url', async () => {
    const res = await request(app).post('/shorten').send({ url: 'not a url' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'url must be a valid http(s) URL' });
    expect(linksRepo.insertLink).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-http(s) scheme', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'ftp://example.com/file' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'url must be a valid http(s) URL' });
    expect(linksRepo.insertLink).not.toHaveBeenCalled();
  });

  it('ignores a supplied code/alias and always auto-generates one', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'https://example.com', code: 'custom1' });

    expect(res.status).toBe(201);
    expect(res.body.code).not.toBe('custom1');
    expect(res.body.code).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(linksRepo.insertLink).toHaveBeenCalledWith({
      code: res.body.code,
      longUrl: 'https://example.com',
    });
  });
});
