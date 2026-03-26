const express = require('express');
const cors = require('cors');
require('dotenv').config();

const bookingRoutes = require('./routes/bookingRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Main Routes
app.use('/api', bookingRoutes);

// Health Check Route to test if server is running
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Mothrly Assistant Backend is up and running.' });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
