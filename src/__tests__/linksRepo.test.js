const mockQuery = jest.fn().mockResolvedValue(undefined);

jest.mock('../repos/db', () => ({
  pool: { query: mockQuery },
}));

const { insertLink, findByCode } = require('../repos/linksRepo');

describe('repos/linksRepo', () => {
  beforeEach(() => {
    mockQuery.mockClear();
  });

  it('inserts code and long_url in the correct order via the shared pool', async () => {
    await insertLink({ code: 'abc1234', longUrl: 'https://example.com' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      'INSERT INTO links (code, long_url) VALUES ($1, $2)',
      ['abc1234', 'https://example.com']
    );
  });

  it('findByCode selects long_url by code with the correct SQL and binding', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ long_url: 'https://example.com' }],
    });

    const result = await findByCode('abc1234');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT long_url FROM links WHERE code = $1',
      ['abc1234']
    );
    expect(result).toBe('https://example.com');
  });

  it('findByCode returns undefined when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await findByCode('zzzzzzz');

    expect(result).toBeUndefined();
  });
});
