require('dotenv').config();
const { Pool } = require('pg');

// Warn early if required env vars are missing — avoids silent auth failures
if (!process.env.DB_USER)     console.warn('⚠️ [DB] DB_USER is not set in environment. Check node-backend/.env');
if (!process.env.DB_PASSWORD) console.warn('⚠️ [DB] DB_PASSWORD is not set in environment. Check node-backend/.env');

const port = parseInt(process.env.DB_PORT, 10) || 5432;

const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'mothrly',
  password: process.env.DB_PASSWORD,
  port,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle PostgreSQL client', err.message);
});

async function verifyConnection() {
  await pool.query('SELECT 1'); // Throws on failure — caller decides how to handle
  console.log('✅ Connected to PostgreSQL');
}

module.exports = pool;
module.exports.verifyConnection = verifyConnection;
