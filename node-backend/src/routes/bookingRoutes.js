const express = require('express');
const router = express.Router();
const { 
  createBooking, 
  getAllBookings, 
  getBookingById,
  rescheduleBooking, 
  cancelBooking 
} = require('../controllers/bookingController');

// POST /api/book - Store new booking data
router.post('/book', createBooking);

// GET /api/bookings - Retrieve all bookings (admin)
router.get('/bookings', getAllBookings);

// GET /api/booking/:booking_id - Search by ID
router.get('/booking/:booking_id', getBookingById);

// PATCH /api/reschedule/:booking_id - Change date/time
router.patch('/reschedule/:booking_id', rescheduleBooking);

// DELETE /api/cancel/:booking_id - Remove booking
router.delete('/cancel/:booking_id', cancelBooking);

module.exports = router;
