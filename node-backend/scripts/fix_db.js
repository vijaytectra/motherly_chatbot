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

async function fixDb() {
  try {
    console.log('--- DB FIX START ---');
    console.log(`Connecting to: ${process.env.DB_NAME} as ${process.env.DB_USER}...`);
    
    // Check if column exists
    const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='bookings' AND column_name='customer_phone';
    `);

    if (res.rowCount === 0) {
      console.log('Adding missing column: customer_phone...');
      await pool.query('ALTER TABLE bookings ADD COLUMN customer_phone VARCHAR(255);');
      console.log('✅ Column added successfully.');
    } else {
      console.log('Column "customer_phone" already exists.');
    }

    console.log('--- DB FIX DONE ---');
  } catch (err) {
    console.error('❌ DB FIX FAILED:', err.message);
  } finally {
    await pool.end();
  }
}

fixDb();
