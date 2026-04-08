/**
 * Creates database "mothrly" (if missing) and applies src/db/schema.sql.
 * Requires PostgreSQL running and valid node-backend/.env (DB_* vars).
 *
 * Usage: npm run setup:db
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_NAME_RAW = process.env.DB_NAME || 'mothrly';
if (!/^[a-zA-Z0-9_]+$/.test(DB_NAME_RAW)) {
  console.error('❌ DB_NAME must contain only letters, numbers, and underscores');
  process.exit(1);
}
const DB_NAME = DB_NAME_RAW;
const port = parseInt(process.env.DB_PORT, 10) || 5432;

const adminConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  password: process.env.DB_PASSWORD,
  port,
  database: 'postgres',
};

async function ensureDatabase() {
  const client = new Client(adminConfig);
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [DB_NAME]
    );
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`✅ Created database "${DB_NAME}"`);
    } else {
      console.log(`ℹ️  Database "${DB_NAME}" already exists`);
    }
  } finally {
    await client.end();
  }
}

async function applySchema() {
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST || 'localhost',
    password: process.env.DB_PASSWORD,
    port,
    database: DB_NAME,
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log('✅ Applied schema from src/db/schema.sql');
    try {
      await client.query('ALTER TABLE bookings ALTER COLUMN phone DROP NOT NULL');
      console.log('✅ Ensured phone column allows NULL (legacy DB migration)');
    } catch (_) {
      /* table missing or already nullable */
    }
  } finally {
    await client.end();
  }
}

async function main() {
  if (!process.env.DB_USER || process.env.DB_PASSWORD === undefined) {
    console.error('❌ DB_USER and DB_PASSWORD must be set in node-backend/.env');
    process.exit(1);
  }
  try {
    await ensureDatabase();
    await applySchema();
    console.log('✅ Database setup complete.');
  } catch (err) {
    console.error('❌ setup-database failed:', err.message);
    process.exit(1);
  }
}

main();
