jest.mock('../repos/linksRepo');

const linksRepo = require('../repos/linksRepo');
const { getClickCount } = require('../services/statsService');

describe('services/statsService', () => {
  beforeEach(() => {
    linksRepo.findClickCount.mockReset();
  });

  it('short-circuits to { found: false } for a malformed code without calling linksRepo', async () => {
    const result = await getClickCount('short');

    expect(result).toEqual({ found: false });
    expect(linksRepo.findClickCount).not.toHaveBeenCalled();
  });

  it('returns { found: true, clicks } for a well-formed code with a matching row', async () => {
    linksRepo.findClickCount.mockResolvedValue(42);

    const result = await getClickCount('abc1234');

    expect(linksRepo.findClickCount).toHaveBeenCalledWith('abc1234');
    expect(result).toEqual({ found: true, clicks: 42 });
  });

  it('returns { found: false } for a well-formed code with no matching row', async () => {
    linksRepo.findClickCount.mockResolvedValue(undefined);

    const result = await getClickCount('nowhere1');

    expect(result).toEqual({ found: false });
  });

  it('returns { found: true, clicks: 0 } for a well-formed code with zero clicks', async () => {
    linksRepo.findClickCount.mockResolvedValue(0);

    const result = await getClickCount('def5678');

    expect(result).toEqual({ found: true, clicks: 0 });
  });
});
