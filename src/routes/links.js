const express = require('express');
const shortenService = require('../services/shortenService');
const redirectService = require('../services/redirectService');
const statsService = require('../services/statsService');

const router = express.Router();

router.post('/shorten', async (req, res, next) => {
  try {
    const { url } = req.body || {};
    const { code } = await shortenService.shortenUrl(url);
    res.status(201).json({ shortUrl: `${process.env.BASE_URL}${code}`, code });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const { found, longUrl } = await redirectService.resolveCode(
      req.params.code
    );
    if (!found) {
      return res.status(404).json({ error: 'short code not found' });
    }
    res.status(302).location(longUrl).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:code/clicks', async (req, res, next) => {
  try {
    const { found, clicks } = await statsService.getClickCount(
      req.params.code
    );
    if (!found) {
      return res.status(404).json({ error: 'short code not found' });
    }
    res.status(200).json({ code: req.params.code, clicks });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
