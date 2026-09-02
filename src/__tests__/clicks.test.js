jest.mock('../services/statsService');
jest.mock('../repos/db', () => ({
  pool: { query: jest.fn() },
  bootstrapSchema: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const statsService = require('../services/statsService');

describe('GET /:code/clicks', () => {
  beforeEach(() => {
    statsService.getClickCount.mockReset();
  });

  it('returns 200 with the current count on an existing code', async () => {
    statsService.getClickCount.mockResolvedValue({ found: true, clicks: 42 });

    const res = await request(app).get('/abc1234/clicks');

    expect(statsService.getClickCount).toHaveBeenCalledWith('abc1234');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 'abc1234', clicks: 42 });
  });

  it('returns 200 with zero clicks on an existing code with no recorded clicks', async () => {
    statsService.getClickCount.mockResolvedValue({ found: true, clicks: 0 });

    const res = await request(app).get('/def5678/clicks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 'def5678', clicks: 0 });
  });

  it('returns 404 on an unknown code', async () => {
    statsService.getClickCount.mockResolvedValue({ found: false });

    const res = await request(app).get('/nowhere1/clicks');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'short code not found' });
  });

  it('returns 404 on a malformed code', async () => {
    statsService.getClickCount.mockResolvedValue({ found: false });

    const res = await request(app).get('/short/clicks');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'short code not found' });
  });
});
