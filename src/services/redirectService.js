const cache = require('../repos/cache');
const linksRepo = require('../repos/linksRepo');

const CODE_FORMAT = /^[A-Za-z0-9]{7}$/;

async function resolveCode(code) {
  if (!CODE_FORMAT.test(code)) {
    return { found: false };
  }

  let cachedUrl = null;
  try {
    cachedUrl = await cache.getCachedUrl(code);
  } catch (err) {
    cachedUrl = null;
  }
  if (cachedUrl) {
    return { found: true, longUrl: cachedUrl };
  }

  const longUrl = await linksRepo.findByCode(code);
  if (longUrl) {
    try {
      await cache.setCachedUrl(code, longUrl);
    } catch (err) {
      // Cache write failure must never fail an already-known-good response.
    }
    return { found: true, longUrl };
  }

  return { found: false };
}

module.exports = { resolveCode };
