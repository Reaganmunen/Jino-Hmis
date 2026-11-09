const axios = require('axios');

const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// Fail loudly at startup instead of silently sending Paybill defaults for a Till.
const REQUIRED_ENV = [
  'MPESA_ENV', 'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_PASSKEY',
  'MPESA_SHORTCODE', 'MPESA_CALLBACK_URL', 'MPESA_CALLBACK_SECRET',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) console.error(`[mpesa] Missing env vars: ${missing.join(', ')}`);
if (process.env.MPESA_ENV === 'production') {
  if (process.env.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' && !process.env.MPESA_PARTY_B) {
    console.error('[mpesa] Till setup needs MPESA_PARTY_B (the till number); PartyB would fall back to the store number');
  }
  if (!process.env.MPESA_TRANSACTION_TYPE) {
    console.warn('[mpesa] MPESA_TRANSACTION_TYPE not set; defaulting to CustomerPayBillOnline (wrong for a Till)');
  }
  if (process.env.MPESA_CALLBACK_URL && /mpesa/i.test(process.env.MPESA_CALLBACK_URL)) {
    console.warn('[mpesa] MPESA_CALLBACK_URL contains "mpesa"; Daraja rejects such URLs');
  }
  if (process.env.MPESA_CALLBACK_URL && process.env.MPESA_CALLBACK_SECRET
    && !process.env.MPESA_CALLBACK_URL.endsWith(process.env.MPESA_CALLBACK_SECRET)) {
    console.warn('[mpesa] MPESA_CALLBACK_URL does not end with MPESA_CALLBACK_SECRET; callbacks will be rejected (404)');
  }
}

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

// Daraja expects Nairobi time (EAT). Render/Vercel servers run in UTC, so don't use local time.
const getTimestamp = () =>
  new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' }).replace(/\D/g, '');

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
        TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: normalizedPhone,
        PartyB: process.env.MPESA_PARTY_B || process.env.MPESA_SHORTCODE,
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

// Asks Safaricom what happened to an STK push. Used to settle payments whose callback never arrived.
const queryStkStatus = (checkoutRequestId, callback) => {
  getAccessToken((tokenErr, accessToken) => {
    if (tokenErr) return callback(tokenErr);

    const timestamp = getTimestamp();
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    axios.post(
      `${BASE_URL}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
      .then((response) => callback(null, response.data))
      .catch((err) => callback(err.response ? err.response.data : err));
  });
};

module.exports = { getAccessToken, initiateStkPush, queryStkStatus, normalizePhone };