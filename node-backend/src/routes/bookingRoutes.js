const express = require('express');
const router = express.Router();
const { createBooking, getAllBookings } = require('../controllers/bookingController');

// POST /api/book
// Store new booking data
router.post('/book', createBooking);

// GET /api/bookings
// Retrieve all bookings
router.get('/bookings', getAllBookings);

module.exports = router;
