const cache = require('../repos/cache');
const linksRepo = require('../repos/linksRepo');
const clickPublisher = require('./clickPublisher');

const CODE_FORMAT = /^[A-Za-z0-9]{7}$/;

// intentionally not awaited; publishClickEvent never rejects, but a
// defensive no-op catch guards against any unexpected rejection
// (e.g. in tests that mock it) turning into an unhandled rejection.
function trackClick(code) {
  clickPublisher.publishClickEvent(code).catch(() => {});
}

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
    trackClick(code);
    return { found: true, longUrl: cachedUrl };
  }

  const longUrl = await linksRepo.findByCode(code);
  if (longUrl) {
    try {
      await cache.setCachedUrl(code, longUrl);
    } catch (err) {
      // Cache write failure must never fail an already-known-good response.
    }
    trackClick(code);
    return { found: true, longUrl };
  }

  return { found: false };
}

module.exports = { resolveCode };
