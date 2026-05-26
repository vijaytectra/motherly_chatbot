require('dotenv').config();
const { Pool } = require('pg');

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    const useSsl =
      process.env.DB_SSL === 'true' ||
      /neon\.tech|sslmode=require/i.test(connectionString);
    return {
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: true } : undefined,
    };
  }

  if (!process.env.DB_USER) {
    console.warn('⚠️ [DB] DB_USER is not set. Set DATABASE_URL (Neon) or DB_* in node-backend/.env');
  }
  if (!process.env.DB_PASSWORD) {
    console.warn('⚠️ [DB] DB_PASSWORD is not set. Set DATABASE_URL (Neon) or DB_* in node-backend/.env');
  }

  const port = parseInt(process.env.DB_PORT, 10) || 5432;
  const useSsl = process.env.DB_SSL === 'true';

  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST || 'localhost',
    database: (process.env.DB_NAME || 'mothrly').toLowerCase(),
    password: process.env.DB_PASSWORD,
    port,
    ssl: useSsl ? { rejectUnauthorized: true } : undefined,
  };
}

const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle PostgreSQL client', err.message);
});

async function verifyConnection() {
  await pool.query('SELECT 1'); // Throws on failure — caller decides how to handle
  console.log('✅ Connected to PostgreSQL');
}

module.exports = pool;
module.exports.verifyConnection = verifyConnection;
