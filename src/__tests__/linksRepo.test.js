const mockQuery = jest.fn().mockResolvedValue(undefined);

jest.mock('../repos/db', () => ({
  pool: { query: mockQuery },
}));

const { insertLink } = require('../repos/linksRepo');

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
});
