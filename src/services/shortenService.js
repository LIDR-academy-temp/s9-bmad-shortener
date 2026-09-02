const crypto = require('crypto');
const linksRepo = require('../repos/linksRepo');

const BASE62_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 7;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  }
  return code;
}

function isValidHttpUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

async function shortenUrl(url) {
  if (!isValidHttpUrl(url)) {
    const error = new Error('url must be a valid http(s) URL');
    error.statusCode = 400;
    throw error;
  }

  const code = generateCode();
  await linksRepo.insertLink({ code, longUrl: url });
  return { code };
}

module.exports = { generateCode, isValidHttpUrl, shortenUrl };
