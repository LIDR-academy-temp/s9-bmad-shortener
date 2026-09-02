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

module.exports = { insertLink, findByCode };
