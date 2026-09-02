const linksRepo = require('../repos/linksRepo');

const CODE_FORMAT = /^[A-Za-z0-9]{7}$/;

async function getClickCount(code) {
  if (!CODE_FORMAT.test(code)) {
    return { found: false };
  }

  const clicks = await linksRepo.findClickCount(code);
  if (clicks === undefined) {
    return { found: false };
  }

  return { found: true, clicks };
}

module.exports = { getClickCount };
