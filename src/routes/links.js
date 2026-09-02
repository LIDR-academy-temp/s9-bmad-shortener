const express = require('express');
const shortenService = require('../services/shortenService');

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

module.exports = router;
