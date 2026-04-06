const pool = require('../config/db');
const { sendWhatsAppMessage } = require('../services/whatsappService');

// ── Utility: Generate unique booking ID like BOOK-38291 ───────────────
function generateBookingId() {
  const num = Math.floor(10000 + Math.random() * 90000);
  return `BOOK-${num}`;
}

// ── Utility: Normalize time to HH:MM:SS for PostgreSQL TIME column ────
// Handles: "10:00", "10:00:00", "10:30 AM", "3:30 PM", "15:30"
function normalizeTime(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  // Already in HH:MM:SS
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(str)) return str;

  // HH:MM — just append seconds
  if (/^\d{1,2}:\d{2}$/.test(str)) return `${str}:00`;

  // 12h with AM/PM — e.g. "3:30 PM" or "10 AM"
  const ampm = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2] || '0', 10);
    const period = ampm[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }

  // Fallback — return as-is and let Postgres decide
  return str;
}

// ── @route  POST /api/book ────────────────────────────────────────────
// ── @desc   Store a new booking ──────────────────────────────────────
const createBooking = async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      description,
      service_provider,
      relationship,
      date,
      time,
      location,
      payment_status,
    } = req.body;

    // Required field validation
    if (!name || !phone || !service_provider || !date || !time) {
      return res.status(400).json({
        error: 'Missing required fields.',
        required: ['name', 'phone', 'service_provider', 'date', 'time'],
        received: { name, phone, service_provider, date, time },
      });
    }

    // Auto-generate unique booking_id
    const booking_id = "BOOK-" + Math.floor(Math.random() * 100000);

    const query = `
      INSERT INTO bookings (
        booking_id, name, phone, email, description,
        service_provider, relationship, payment_status, date, time, location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) RETURNING *;
    `;

    const values = [
      booking_id,
      name.trim(),
      phone.trim(),
      email?.trim() || null,
      description?.trim() || null,
      service_provider.trim().toLowerCase(),
      relationship?.trim() || 'patient',
      payment_status || 'pending',
      date,
      normalizeTime(time),   // ← converts any format to HH:MM:SS
      location?.trim() || null,
    ];

    const result = await pool.query(query, values);
    const saved = result.rows[0];

    console.log(`✅ [DB] Booking ${saved.booking_id} saved successfully. Triggering notifications...`);
    
    // ── WhatsApp Confirmation Logic ──────────────────────────────────
    const whatsappMsg = `Hi ${saved.name} 👋, your booking for ${saved.service_provider} is confirmed ✅`;
    sendWhatsAppMessage(saved.phone, whatsappMsg).catch(err => console.error("❌ [WhatsApp Trigger Error]", err));

    // Return in a unified shape for the frontend
    res.status(201).json({
      message:   'Booking successfully created',
      bookingId: saved.booking_id,
      booking:   saved,
    });

  } catch (err) {
    console.error('FULL ERROR:', err); // 👈 shows exact Postgres error in terminal
    res.status(500).json({ error: 'Server error while creating booking.' });
  }
};

// ── @route  GET /api/bookings ────────────────────────────────────────
// ── @desc   Retrieve ALL filtered bookings (admin/debug) ─────────────
const getAllBookings = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings ORDER BY created_at DESC;');
    res.status(200).json({ count: result.rowCount, bookings: result.rows });
  } catch (err) {
    console.error('Error fetching all bookings:', err.message);
    res.status(500).json({ error: 'Server error while fetching all bookings.' });
  }
};

// ── @route  GET /api/bookings/:phone ─────────────────────────────────
// ── @desc   Retrieve all bookings for a specific phone number ────────
const getBookingsByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const result = await pool.query(
      `SELECT * FROM bookings WHERE phone = $1 ORDER BY date DESC, time DESC;`,
      [phone]
    );
    res.status(200).json({
      count:    result.rowCount,
      bookings: result.rows,
    });
  } catch (err) {
    console.error('Error fetching history:', err.message);
    res.status(500).json({ error: 'Server error while fetching history.' });
  }
};

// ── @route  PATCH /api/reschedule/:booking_id ──────────────────────────
// ── @desc   Update date/time of an existing booking ──────────────────
const rescheduleBooking = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const { date, time } = req.body;

    if (!date || !time) {
      return res.status(400).json({ error: 'New date and time are required.' });
    }

    const query = `
      UPDATE bookings 
      SET date = $1, time = $2 
      WHERE booking_id = $3 
      RETURNING *;
    `;
    const result = await pool.query(query, [date, normalizeTime(time), booking_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.status(200).json({
      message: 'Booking successfully rescheduled',
      booking: result.rows[0],
    });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    res.status(500).json({ error: 'Server error while rescheduling.' });
  }
};

// ── @route  DELETE /api/cancel/:booking_id ───────────────────────────
// ── @desc   Cancel (delete) an existing booking ──────────────────────
const cancelBooking = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const result = await pool.query(
      `DELETE FROM bookings WHERE booking_id = $1 RETURNING *;`,
      [booking_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.status(200).json({
      message: 'Booking successfully cancelled.',
      bookingId: booking_id
    });
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ error: 'Server error while cancelling.' });
  }
};

module.exports = { 
  createBooking, 
  getAllBookings, 
  getBookingsByPhone, 
  rescheduleBooking, 
  cancelBooking 
};
