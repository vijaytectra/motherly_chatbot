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

function getClientConfig({ admin = false } = {}) {
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

  const port = parseInt(process.env.DB_PORT, 10) || 5432;
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST || 'localhost',
    password: process.env.DB_PASSWORD,
    port,
    database: admin ? 'postgres' : (process.env.DB_NAME || 'mothrly').toLowerCase(),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  };
}

const usingNeon = Boolean(process.env.DATABASE_URL?.includes('neon.tech'));

async function ensureDatabase() {
  if (usingNeon || process.env.DATABASE_URL) {
    console.log('ℹ️  Using hosted Postgres (Neon/DATABASE_URL) — skipping CREATE DATABASE');
    return;
  }

  const DB_NAME = (process.env.DB_NAME || 'mothrly').toLowerCase();
  const client = new Client(getClientConfig({ admin: true }));
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
  const client = new Client(getClientConfig());
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
  const hasUrl = Boolean(process.env.DATABASE_URL?.trim());
  const hasLegacy = process.env.DB_USER && process.env.DB_PASSWORD !== undefined;
  if (!hasUrl && !hasLegacy) {
    console.error('❌ Set DATABASE_URL (Neon) or DB_USER + DB_PASSWORD in node-backend/.env');
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
