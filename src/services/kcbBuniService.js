const axios = require('axios');
const { normalizePhone } = require('./mpesaService');

// KCB Buni (Lipa na KCB) STK push. Runs alongside the Safaricom Daraja service
// in mpesaService.js — nothing here touches that file's behaviour.

const TOKEN_URL = process.env.KCB_TOKEN_URL || 'https://accounts.buni.kcbgroup.com/oauth2/token';
const BASE_URL = (process.env.KCB_BASE_URL || 'https://uat.buni.kcbgroup.com').replace(/\/+$/, '');
const STK_PATH = '/mm/api/request/1.0.0/stkpush';

let cachedToken = null;
let tokenExpiresAt = 0;

// true when everything needed to send a push is present in the environment
const isConfigured = () => Boolean(
  process.env.KCB_CONSUMER_KEY
  && process.env.KCB_CONSUMER_SECRET
  && process.env.KCB_CALLBACK_URL
  && (process.env.KCB_INVOICE_NUMBER || process.env.KCB_SHARED_SHORTCODE === 'false')
);

// OAuth2 client-credentials token (valid ~1hr). Buni throttles apps that request
// a token per call, so it's cached in memory — use Redis if you run multiple instances.
const getAccessToken = (callback) => {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return callback(null, cachedToken);
  }

  const basic = Buffer.from(`${process.env.KCB_CONSUMER_KEY}:${process.env.KCB_CONSUMER_SECRET}`).toString('base64');

  axios.post(TOKEN_URL, new URLSearchParams({ grant_type: 'client_credentials' }).toString(), {
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 15000,
  })
    .then((response) => {
      cachedToken = response.data.access_token;
      const ttl = Number(response.data.expires_in) || 3600;
      tokenExpiresAt = Date.now() + (ttl - 120) * 1000; // refresh 2 min early
      callback(null, cachedToken);
    })
    .catch((err) => callback(err.response ? err.response.data : err));
};

// KCB posts the result to this URL. If KCB_CALLBACK_SECRET is set it rides along as
// ?token=..., and kcbController.handleCallback rejects callbacks without it.
const buildCallbackUrl = () => {
  const url = new URL(process.env.KCB_CALLBACK_URL);
  if (process.env.KCB_CALLBACK_SECRET) {
    url.searchParams.set('token', process.env.KCB_CALLBACK_SECRET);
  }
  return url.toString();
};

// invoiceNumber: your KCB account number (shared short code 522522) or a bill reference.
const initiateStkPush = ({ phone, amount, invoiceNumber, transactionDescription }, callback, isRetry = false) => {
  getAccessToken((tokenErr, accessToken) => {
    if (tokenErr) return callback(tokenErr);

    const shared = process.env.KCB_SHARED_SHORTCODE !== 'false';
    const payload = {
      phoneNumber: normalizePhone(phone),
      amount: String(Math.round(amount)), // string, whole KES
      invoiceNumber,
      sharedShortCode: shared,
      orgShortCode: process.env.KCB_ORG_SHORT_CODE || '522522',
      orgPassKey: shared ? '' : (process.env.KCB_ORG_PASSKEY || ''),
      callbackUrl: buildCallbackUrl(),
      transactionDescription: String(transactionDescription || 'Clinic bill').slice(0, 13), // M-Pesa screen limit
    };

    axios.post(`${BASE_URL}${STK_PATH}`, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    })
      .then((response) => {
        const data = response.data || {};
        const header = data.header || {};
        const body = data.response || {};
        const accepted = String(header.statusCode) === '0' && body.CheckoutRequestID;
        if (!accepted) return callback({ message: header.statusDescription || body.ResponseDescription || 'KCB rejected the request', raw: data });
        callback(null, {
          CheckoutRequestID: body.CheckoutRequestID,
          MerchantRequestID: body.MerchantRequestID,
          raw: data,
        });
      })
      .catch((err) => {
        // Token expired early / revoked: drop the cache and retry once.
        if (err.response && err.response.status === 401 && !isRetry) {
          cachedToken = null;
          return initiateStkPush({ phone, amount, invoiceNumber, transactionDescription }, callback, true);
        }
        callback(err.response ? err.response.data : err);
      });
  });
};

module.exports = { isConfigured, getAccessToken, initiateStkPush };