const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function bootstrapSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id SERIAL PRIMARY KEY,
      code VARCHAR UNIQUE NOT NULL,
      long_url TEXT NOT NULL,
      click_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}

module.exports = { pool, bootstrapSchema };
