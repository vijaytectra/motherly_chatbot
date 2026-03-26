const pool = require('../config/db');

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

// ── @route  GET /api/bookings ─────────────────────────────────────────
// ── @desc   Retrieve all bookings (latest first) ─────────────────────
const getAllBookings = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM bookings ORDER BY created_at DESC;`
    );
    res.status(200).json({
      count:    result.rowCount,
      bookings: result.rows,
    });
  } catch (err) {
    console.error('Error fetching bookings:', err.message);
    res.status(500).json({ error: 'Server error while fetching bookings.' });
  }
};

module.exports = { createBooking, getAllBookings };
