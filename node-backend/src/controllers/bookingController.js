const pool = require('../config/db');
const { sendWhatsAppMessage } = require('../services/whatsappService');

function generateBookingId() {
  const num = Math.floor(10000 + Math.random() * 90000);
  return `BOOK-${num}`;
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

function normalizeInternationalPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const digits = rawPhone.replace(/[^0-9]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

const createBooking = async (req, res) => {
  const body = req.body || {};
  const serviceRaw = body.service_type || body.service || body.service_provider;
  const customerNameRaw = body.customer_name || body.name;
  const customerPhoneRaw = body.customer_phone || body.phone;
  const providerNameRaw = body.provider_name || body.service_provider || 'no preference';
  const appointmentDateRaw = body.appointment_date || body.date;
  const appointmentTimeRaw = body.appointment_time || body.time;

  console.log('📥 [Booking] Incoming POST /api/book', {
    name: customerNameRaw,
    phone: customerPhoneRaw,
    service: serviceRaw,
    date: appointmentDateRaw,
    time: appointmentTimeRaw,
    location: body.location,
  });

  const name =
    typeof customerNameRaw === 'string' ? customerNameRaw.trim() : '';
  const service = typeof serviceRaw === 'string' ? serviceRaw.trim() : '';
  const providerName =
    typeof providerNameRaw === 'string' ? providerNameRaw.trim() : 'no preference';
  const date = appointmentDateRaw;
  const timeRaw = appointmentTimeRaw;
  const location =
    typeof body.location === 'string' ? body.location.trim() : '';

  if (!name || !service || !date || !timeRaw || !location) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields.',
      required: ['name', 'service', 'date', 'time', 'location'],
      received: {
        name: name || undefined,
        service: service || undefined,
        date: date || undefined,
        time: timeRaw || undefined,
        location: location || undefined,
      },
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
    console.warn(
      `⚠️ [Booking] Invalid phone format, skipping WhatsApp: ${customerPhoneRawSafe}`
    );
  }
  const email =
    typeof body.email === 'string' && body.email.trim()
      ? body.email.trim()
      : null;
  const description =
    typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;
  const relationship =
    typeof body.relationship === 'string' && body.relationship.trim()
      ? body.relationship.trim()
      : 'patient';

  let booking_id = generateBookingId();

  const query = `
      INSERT INTO bookings (
        booking_id, name, customer_phone, phone, email, description,
        service_provider, relationship, payment_status, date, time, location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      ) RETURNING *;
    `;

  const values = [
    booking_id,
    name,
    customerPhone,
    customerPhone,
    email,
    description,
    providerName.toLowerCase(),
    relationship,
    body.payment_status || 'pending',
    date,
    time,
    location,
  ];

  try {
    const result = await pool.query(query, values);
    const saved = result.rows[0];

    console.log(
      `✅ [Booking] DB insert OK — booking_id=${saved.booking_id} id=${saved.id}`
    );

    const booking = {
      booking_id: saved.booking_id,
      customer_name: saved.name,
      customer_phone: saved.customer_phone || saved.phone,
      service_type: service,
      provider_name: saved.service_provider || providerName,
      appointment_date: saved.date,
      appointment_time: saved.time,
      location: saved.location,
    };
    console.log('[Booking] ✅ Saved to DB. Booking ID:', saved.booking_id);
    console.log('[Booking] Triggering WhatsApp for:', booking.customer_phone);

    if (!customerPhone) {
      console.log('⚠️ [Booking] Phone missing/invalid, skipping WhatsApp.');
    } else {
      try {
        await sendWhatsAppMessage(booking);
      } catch (err) {
        console.error('❌ WhatsApp failed', err.message || err);
      }
    }

    return res.status(201).json({
      success: true,
      booking_id: saved.booking_id,
      bookingId: saved.booking_id,
      message: 'Booking successfully created',
      booking: saved,
    });
  } catch (err) {
    console.error('❌ [Booking] DB error:', err.message || err);
    return res.status(503).json({
      success: false,
      error: 'Database error while creating booking. Check PostgreSQL and run npm run setup:db.',
    });
  }
};

const getAllBookings = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bookings ORDER BY created_at DESC;'
    );
    res.status(200).json({ count: result.rowCount, bookings: result.rows });
  } catch (err) {
    console.error('Error fetching all bookings:', err.message);
    res.status(500).json({ error: 'Server error while fetching all bookings.' });
  }
};

const getBookingById = async (req, res) => {
  try {
    const { booking_id } = req.params;
    const result = await pool.query(
      `SELECT * FROM bookings WHERE booking_id = $1;`,
      [booking_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.status(200).json({
      count: result.rowCount,
      booking: result.rows[0],
    });
  } catch (err) {
    console.error('Error fetching booking by ID:', err.message);
    res.status(500).json({ error: 'Server error while fetching booking.' });
  }
};

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
    const result = await pool.query(query, [
      date,
      normalizeTime(time),
      booking_id,
    ]);

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
      bookingId: booking_id,
    });
  } catch (err) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ error: 'Server error while cancelling.' });
  }
};

module.exports = {
  createBooking,
  getAllBookings,
  getBookingById,
  rescheduleBooking,
  cancelBooking,
};
