const axios = require('axios');

const ACCESS_TOKEN =
  process.env.ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID =
  process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '';

const isConfigured = Boolean(
  String(ACCESS_TOKEN).trim() && String(PHONE_NUMBER_ID).trim()
);

function normalizePhone(number) {
  if (!number) return null;
  let n = number.toString().trim().replace(/\s+/g, '');
  if (!n.startsWith('+')) n = '+' + n;
  return n;
}

async function postWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  return axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function sendWhatsAppMessage(booking) {
  const customerPhone = normalizePhone(booking?.customer_phone);

  const customerMessage = `👶 Mothrly – Booking Confirmed!

Hi ${booking.customer_name}, your booking is confirmed. Here are your details:

📋 Booking ID   : ${booking.booking_id}
🩺 Service       : ${booking.service_type}
👩‍⚕️ Provider      : ${booking.provider_name}
📅 Date & Time  : ${booking.appointment_date}, ${booking.appointment_time}
📍 Location      : ${booking.location}

Thank you for choosing Mothrly. We look forward to caring for you. 💛
Need to reschedule or cancel? Reply to this message or call us.`;

  if (!isConfigured) {
    console.log('[WhatsApp] ⚠️ Mock mode — credentials missing');
    console.log('[WhatsApp] Mock message to:', customerPhone);
    return { mock: true };
  }

  if (customerPhone) {
    try {
      console.log('[WhatsApp] Sending to customer:', customerPhone);
      const result = await postWhatsAppText(customerPhone, customerMessage);
      console.log('[WhatsApp] ✅ Customer message sent successfully');
      return { customer: result?.data || true };
    } catch (err) {
      console.error(
        '[WhatsApp] ❌ Failed to send to customer:',
        err.response?.data || err.message
      );
      return { error: true, data: err.response?.data || err.message };
    }
  } else {
    console.warn('⚠️ WhatsApp skipped: missing customer_phone');
    return { skipped: true };
  }
}

module.exports = { sendWhatsAppMessage };
