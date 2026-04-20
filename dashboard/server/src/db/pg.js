// PostgreSQL pool
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/helpdesk',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
  statement_timeout: 10000,
});

pool.on('error', (err) => {
  console.error('[PG] Unexpected error on idle client:', err.message);
});

module.exports = pool;
