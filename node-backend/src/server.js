const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');
const bookingRoutes = require('./routes/bookingRoutes');

const app = express();

// NOTE: Restrict origin to specific domains before going to production.
app.use(
  cors({
    origin: [
      'https://chatbot.mothrly.com',
      'https://www.motherly.com',
      'https://motherly.com',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Limit request body to 1 MB to prevent memory exhaustion from large payloads
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    const emoji = res.statusCode >= 400 ? '❌' : '🌐';
    console.log(
      `${emoji} [${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`
    );
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.use('/api', bookingRoutes);

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — closing DB pool and shutting down.`);
  db.end ? db.end() : null;
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Global error guards ──────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('❌ [Server] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ [Server] Uncaught Exception:', err);
  process.exit(1);
});

// ── Startup ──────────────────────────────────────────────────────────
async function startServer() {
  try {
    await db.verifyConnection();

    app.listen(PORT, HOST, () => {
      console.log(`Node backend running at http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message || err);
    process.exit(1);
  }
}

startServer();
