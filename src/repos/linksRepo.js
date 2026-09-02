const { pool } = require('./db');

async function insertLink({ code, longUrl }) {
  await pool.query(
    'INSERT INTO links (code, long_url) VALUES ($1, $2)',
    [code, longUrl]
  );
}

module.exports = { insertLink };
