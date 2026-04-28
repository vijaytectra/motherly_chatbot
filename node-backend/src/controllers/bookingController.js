const pool = require('../config/db');
const { sendWhatsAppMessage } = require('../services/whatsappService');

function generateBookingId() {
  const num = Math.floor(10000 + Math.random() * 90000);
  return `BOOK-${num}`;
}

/**
 * Generate a booking ID that is guaranteed unique in the DB.
 * Retries up to 5 times to avoid the rare collision on the UNIQUE constraint.
 */
async function generateUniqueBookingId() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateBookingId();
    const { rowCount } = await pool.query(
      'SELECT 1 FROM bookings WHERE booking_id = $1',
      [id]
    );
    if (rowCount === 0) return id;
  }
  // Fallback: append timestamp segment to guarantee uniqueness
  return `BOOK-${Date.now().toString().slice(-8)}`;
}

function normalizeTime(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(str)) return str;
  if (/^\d{1,2}:\d{2}$/.test(str)) return `${str}:00`;

  const ampm = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2] || '0', 10);
    const period = ampm[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    if (period === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }

  return str;
}

/**
 * Normalize a phone number to digits with + prefix (e.g. "+919876543210").
 * Returns null if the number is clearly invalid.
 */
function normalizeInternationalPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const str = rawPhone.trim();
  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  // Preserve existing + prefix so downstream services receive a valid E.164-style number
  return str.startsWith('+') ? `+${digits}` : digits;
}

/** Validate a date string is parseable and not obviously invalid. */
function isValidDateString(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

const createBooking = async (req, res) => {
  const body = req.body || {};
  const serviceRaw = body.service_type || body.service || body.service_provider;
  const customerNameRaw = body.customer_name || body.name;
  const customerPhoneRaw = body.customer_phone || body.phone;
  const providerNameRaw = body.provider_name || body.service_provider || 'no preference';
  const appointmentDateRaw = body.appointment_date || body.date;
  const appointmentTimeRaw = body.appointment_time || body.time;

  // Log without PII phone number
  console.log('📥 [Booking] Incoming POST /api/book', {
    name: customerNameRaw,
    service: serviceRaw,
    date: appointmentDateRaw,
    time: appointmentTimeRaw,
    location: body.location,
  });

  const name     = typeof customerNameRaw === 'string' ? customerNameRaw.trim() : '';
  const service  = typeof serviceRaw === 'string' ? serviceRaw.trim() : '';
  const providerName = typeof providerNameRaw === 'string' ? providerNameRaw.trim() : 'no preference';
  const date     = appointmentDateRaw;
  const timeRaw  = appointmentTimeRaw;
  const location = typeof body.location === 'string' ? body.location.trim() : '';

  if (!name || !service || !date || !timeRaw || !location) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields.',
      required: ['name', 'service', 'date', 'time', 'location'],
      received: {
        name:     name     || undefined,
        service:  service  || undefined,
        date:     date     || undefined,
        time:     timeRaw  || undefined,
        location: location || undefined,
      },
    });
  }

  // Validate appointment date
  if (!isValidDateString(date)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid appointment date. Please use a valid date format (e.g. 2025-06-15).',
    });
  }

  const time = normalizeTime(timeRaw);
  if (!time) {
    return res.status(400).json({
      success: false,
      error: 'Invalid time format.',
    });
  }

  const customerPhoneRawSafe =
    typeof customerPhoneRaw === 'string' && customerPhoneRaw.trim()
      ? customerPhoneRaw.trim()
      : null;
  const customerPhone = customerPhoneRawSafe
    ? normalizeInternationalPhone(customerPhoneRawSafe)
    : null;
  if (customerPhoneRawSafe && !customerPhone) {
    console.warn('⚠️ [Booking] Invalid phone format, skipping WhatsApp');
  }

  const email = typeof body.email === 'string' && body.email.trim()
    ? body.email.trim()
    : null;
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null;
  const relationship = typeof body.relationship === 'string' && body.relationship.trim()
    ? body.relationship.trim()
    : 'patient';

  let booking_id;
  try {
    booking_id = await generateUniqueBookingId();
  } catch (err) {
    console.error('❌ [Booking] Failed to generate unique booking ID:', err.message);
    return res.status(503).json({
      success: false,
      error: 'Database error while generating booking ID. Check PostgreSQL.',
    });
  }

  const query = `
      INSERT INTO bookings (
        booking_id, name, customer_phone, phone, email, description,
        service_type, provider_name, service_provider, relationship, payment_status, date, time, location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      ) RETURNING *;
    `;

  const values = [
    booking_id,
    name,
    customerPhone,
    customerPhone,
    email,
    description,
    service,
    providerName.toLowerCase(),
    service,
    relationship,
    body.payment_status || 'pending',
    date,
    time,
    location,
  ];

  try {
    const result = await pool.query(query, values);
    const saved = result.rows[0];

    console.log(`✅ [Booking] DB insert OK — booking_id=${saved.booking_id} id=${saved.id}`);

    const booking = {
      booking_id:       saved.booking_id,
      customer_name:    saved.name,
      customer_phone:   saved.customer_phone || saved.phone,
      service_type:     service,
      provider_name:    saved.provider_name || providerName,
      appointment_date: saved.date,
      appointment_time: saved.time,
      location:         saved.location,
    };

    let whatsappStatus = 'skipped';
    if (!customerPhone) {
      console.log('⚠️ [Booking] Phone missing/invalid, skipping WhatsApp.');
    } else {
      try {
        const waResult = await sendWhatsAppMessage(booking);
        whatsappStatus = waResult.mock ? 'mock' : waResult.error ? 'failed' : 'sent';
        if (waResult.error) {
          console.warn('⚠️ [Booking] WhatsApp notification failed — booking is still saved.');
        }
      } catch (err) {
        whatsappStatus = 'failed';
        console.error('❌ WhatsApp failed (booking still saved):', err.message || err);
      }
    }

    return res.status(201).json({
      success:         true,
      booking_id:      saved.booking_id,
      bookingId:       saved.booking_id,
      message:         'Booking successfully created',
      whatsapp_status: whatsappStatus,
      booking:         saved,
    });
  } catch (err) {
    console.error('❌ [Booking] DB error:', err.message || err);
    return res.status(503).json({
      success: false,
      error: 'Database error while creating booking. Check PostgreSQL and run npm run setup:db.',
    });
  }
};

const getAllBookings = async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bookings ORDER BY created_at DESC;'
    );
    res.status(200).json({ count: result.rowCount, bookings: result.rows });
  } catch (err) {
    console.error('Error fetching all bookings:', err.message);
    res.status(500).json({ success: false, error: 'Server error while fetching all bookings.' });
  }
};

const getBookingById = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM bookings WHERE booking_id = $1;',
      [booking_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    res.status(200).json({
      count:   result.rowCount,
      booking: result.rows[0],
    });
  } catch (err) {
    console.error('Error fetching booking by ID:', err.message);
    res.status(500).json({ success: false, error: 'Server error while fetching booking.' });
  }
};

const rescheduleBooking = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const { date, time } = req.body;

    if (!date || !time) {
      return res.status(400).json({ success: false, error: 'New date and time are required.' });
    }

    if (!isValidDateString(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date. Please use a valid date format (e.g. 2025-06-15).',
      });
    }

    const normalizedTime = normalizeTime(time);
    if (!normalizedTime) {
      return res.status(400).json({ success: false, error: 'Invalid time format.' });
    }

    const query = `
      UPDATE bookings
      SET date = $1, time = $2
      WHERE booking_id = $3
      RETURNING *;
    `;
    const result = await pool.query(query, [date, normalizedTime, booking_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    res.status(200).json({
      message: 'Booking successfully rescheduled',
      booking: result.rows[0],
    });
  } catch (err) {
    console.error('Reschedule error:', err.message);
    res.status(500).json({ success: false, error: 'Server error while rescheduling.' });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const result = await pool.query(
      'DELETE FROM bookings WHERE booking_id = $1 RETURNING *;',
      [booking_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    res.status(200).json({
      message:   'Booking successfully cancelled.',
      bookingId: booking_id,
    });
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ success: false, error: 'Server error while cancelling.' });
  }
};

module.exports = {
  createBooking,
  getAllBookings,
  getBookingById,
  rescheduleBooking,
  cancelBooking,
};
