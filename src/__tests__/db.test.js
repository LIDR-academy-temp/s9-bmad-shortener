const mockQuery = jest.fn().mockResolvedValue(undefined);
const mockPool = jest.fn().mockImplementation(() => ({ query: mockQuery }));

jest.mock('pg', () => ({ Pool: mockPool }));

describe('repos/db', () => {
  beforeEach(() => {
    jest.resetModules();
    mockPool.mockClear();
    mockQuery.mockClear();
  });

  it('constructs the pool at require time without issuing any query', () => {
    require('../repos/db');

    expect(mockPool).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('bootstrapSchema runs CREATE TABLE IF NOT EXISTS links exactly once', async () => {
    const { bootstrapSchema } = require('../repos/db');

    await bootstrapSchema();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(
      /CREATE TABLE IF NOT EXISTS links/
    );
    expect(mockQuery.mock.calls[0][0]).toMatch(
      /click_count\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i
    );
  });
});
