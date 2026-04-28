const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'mothrly',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10) || 5432,
});

async function upgradeDb() {
  try {
    console.log('--- DB UPGRADE START ---');
    
    // Add service_type column
    console.log('Adding column: service_type to bookings table...');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_type VARCHAR(100);');
    
    // Add provider_name column (to distinguish from service)
    console.log('Adding column: provider_name to bookings table...');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_name VARCHAR(100) DEFAULT \'no preference\';');
    
    console.log('✅ DB Upgrade successful.');
    console.log('--- DB UPGRADE DONE ---');
  } catch (err) {
    console.error('❌ DB UPGRADE FAILED:', err.message);
  } finally {
    await pool.end();
  }
}

upgradeDb();
