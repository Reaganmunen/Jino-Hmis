const axios = require('axios');

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

let cachedToken = null;
let tokenExpiresAt = 0;

// OAuth token is valid ~1hr; cache it in memory and refetch only once it's near expiry.
const getAccessToken = (callback) => {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return callback(null, cachedToken);
  }

  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');

  axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  })
    .then((response) => {
      cachedToken = response.data.access_token;
      // Refresh 60s before actual expiry as a safety margin
      tokenExpiresAt = Date.now() + (Number(response.data.expires_in) - 60) * 1000;
      callback(null, cachedToken);
    })
    .catch((err) => callback(err));
};

const getTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
};

// Normalizes 07XXXXXXXX / +254XXXXXXXXX / 254XXXXXXXXX to 254XXXXXXXXX
const normalizePhone = (phone) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
};

// Initiates an STK push (Lipa Na M-Pesa Online) prompt on the patient's phone.
const initiateStkPush = ({ phone, amount, accountReference, transactionDesc }, callback) => {
  getAccessToken((tokenErr, accessToken) => {
    if (tokenErr) return callback(tokenErr);

    const timestamp = getTimestamp();
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');
    const normalizedPhone = normalizePhone(phone);

    axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: normalizedPhone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: normalizedPhone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc || 'Dental clinic payment',
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then((response) => callback(null, response.data))
      .catch((err) => callback(err.response ? err.response.data : err));
  });
};

module.exports = { getAccessToken, initiateStkPush, normalizePhone };