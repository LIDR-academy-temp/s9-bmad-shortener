const { pool } = require('./db');

async function insertLink({ code, longUrl }) {
  await pool.query(
    'INSERT INTO links (code, long_url) VALUES ($1, $2)',
    [code, longUrl]
  );
}

async function findByCode(code) {
  const result = await pool.query(
    'SELECT long_url FROM links WHERE code = $1',
    [code]
  );
  return result.rows[0] ? result.rows[0].long_url : undefined;
}

async function incrementClickCount(code) {
  await pool.query(
    'UPDATE links SET click_count = click_count + 1 WHERE code = $1',
    [code]
  );
}

async function findClickCount(code) {
  const result = await pool.query(
    'SELECT click_count FROM links WHERE code = $1',
    [code]
  );
  return result.rows[0] ? result.rows[0].click_count : undefined;
}

module.exports = { insertLink, findByCode, incrementClickCount, findClickCount };
