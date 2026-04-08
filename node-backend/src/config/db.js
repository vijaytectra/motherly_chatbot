require('dotenv').config();
const { Pool } = require('pg');

const port = parseInt(process.env.DB_PORT, 10) || 5432;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'mothrly',
  password: process.env.DB_PASSWORD,
  port,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle PostgreSQL client', err.message);
});

async function verifyConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL');
  } catch (error) {
    console.error('❌ DB connection failed', error.message || error);
  }
}

verifyConnection();

module.exports = pool;
module.exports.verifyConnection = verifyConnection;
