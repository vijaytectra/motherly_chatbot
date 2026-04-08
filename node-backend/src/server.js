const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');

const bookingRoutes = require('./routes/bookingRoutes');

const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());
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

async function startServer() {
  try {
    if (typeof db.verifyConnection === 'function') {
      await db.verifyConnection();
    } else if (typeof db.query === 'function') {
      await db.query('SELECT 1');
      console.log('✅ Connected to PostgreSQL');
    }

    app.listen(PORT, HOST, () => {
      console.log(`Node backend running at http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
