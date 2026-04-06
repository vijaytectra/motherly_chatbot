/**
 * services/whatsappService.js
 * Professional WhatsApp Cloud API Service Module.
 * Responsible for sending outbound messages via Meta Graph API.
 */
const axios = require('axios');

// ── Environment Configuration ─────────────────────────────────────────
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const isConfigured = ACCESS_TOKEN && PHONE_NUMBER_ID;

/**
 * sendWhatsAppMessage(to, message)
 * @param {string} to - Recipient phone number in international format (+91XXXXXXXXXX)
 * @param {string} message - The text body to send
 * @returns {Promise<Object>} - API response data or error
 */
async function sendWhatsAppMessage(to, message) {
  // Validate recipient
  if (!to) {
    console.error('❌ [WhatsApp] Error: No recipient phone number provided.');
    return;
  }

  // Ensure format is E.164 (removing any non-digit characters except possibly +)
  const formattedTo = to.replace(/[^0-9]/g, '');

  console.log(`\n🟢 [WhatsApp Service] Attempting to send message to: ${formattedTo}`);

  if (isConfigured) {
    try {
      // Endpoint: v19.0 as per senior engineer specification
      const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedTo,
        type: 'text',
        text: {
          body: message
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ [WhatsApp] Message sent successfully to ${formattedTo}. ID: ${response.data.messages[0].id}`);
      return response.data;

    } catch (err) {
      const errorData = err.response ? err.response.data : err.message;
      console.error('❌ [WhatsApp] API Error:', JSON.stringify(errorData, null, 2));
      
      // We do not throw the error to ensure the calling process (booking) continues
      return { error: true, data: errorData };
    }
  } else {
    // MOCK MODE: Professional fallback for local development
    console.warn('⚠️ [WhatsApp] Configuration missing (ACCESS_TOKEN / PHONE_NUMBER_ID).');
    console.log('--------------------------------------------------');
    console.log(`📡 MOCK WHATSAPP MESSAGE`);
    console.log(`To: ${formattedTo}`);
    console.log(`Body: ${message}`);
    console.log('--------------------------------------------------');
    return { mock: true, sent: true };
  }
}

module.exports = { sendWhatsAppMessage };
