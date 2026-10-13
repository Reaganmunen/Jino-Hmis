const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const { normalizePhone } = require('./mpesaService');

// Equity paybill STK push, via Equity's Jenga API (Finserve):
// "M-Pesa STK push — account based settlement". The patient gets an M-Pesa prompt and the
// money settles straight into the clinic's Equity account. Runs alongside mpesaService.js
// (Daraja) and kcbBuniService.js — nothing here touches those files.
//
// Environment:
//   EQUITY_ENV               'production' for live; anything else uses the UAT sandbox
//   EQUITY_BASE_URL          optional override of the API host (testing)
//   EQUITY_API_KEY           } Jenga HQ -> Settings -> API Keys
//   EQUITY_MERCHANT_CODE     }
//   EQUITY_CONSUMER_SECRET   }
//   EQUITY_PRIVATE_KEY       PEM private key (use \n for line breaks), or...
//   EQUITY_PRIVATE_KEY_PATH  ...path to the PEM file. Its public key is what you upload to Jenga HQ.
//   EQUITY_ACCOUNT_NUMBER    the clinic's Equity account that gets credited
//   EQUITY_MERCHANT_NAME     clinic name shown on the payment
//   EQUITY_CALLBACK_URL      public https URL of POST /api/equity/callback
//   EQUITY_CALLBACK_SECRET   required — Jenga callbacks are unsigned, so this rides along as ?token=
//   EQUITY_PUSH_TYPE         optional, 'STK' (default) or 'USSD'

const BASE_URL = (process.env.EQUITY_BASE_URL
  || (process.env.EQUITY_ENV === 'production' ? 'https://api.finserve.africa' : 'https://uat.finserve.africa')
).replace(/\/+$/, '');
const AUTH_PATH = '/authentication/api/v3/authenticate/merchant';
const STK_PATH = '/v3-apis/payment-api/v3.0/stkussdpush/initiate';

const COUNTRY_CODE = 'KE';
const CURRENCY = 'KES';
const TELCO = 'Safaricom'; // the paybill prompt goes to M-Pesa customers
const MAX_REF_ATTEMPTS = 3;

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedPrivateKey = null;

// true when everything needed to send a push is present in the environment
const isConfigured = () => Boolean(
  process.env.EQUITY_API_KEY
  && process.env.EQUITY_MERCHANT_CODE
  && process.env.EQUITY_CONSUMER_SECRET
  && (process.env.EQUITY_PRIVATE_KEY || process.env.EQUITY_PRIVATE_KEY_PATH)
  && process.env.EQUITY_ACCOUNT_NUMBER
  && process.env.EQUITY_MERCHANT_NAME
  && process.env.EQUITY_CALLBACK_URL
  && process.env.EQUITY_CALLBACK_SECRET
);

// Axios errors carry the request config (Authorization, Api-Key, consumerSecret). Anything that
// gets logged or returned to a client goes through here so none of that can leak.
const toError = (err) => {
  if (err && err.response) return err.response.data || { message: `Equity responded with HTTP ${err.response.status}` };
  return { message: (err && err.message) || 'Request to Equity failed', code: err && err.code };
};

const getPrivateKey = () => {
  if (cachedPrivateKey) return cachedPrivateKey;
  if (process.env.EQUITY_PRIVATE_KEY) {
    cachedPrivateKey = process.env.EQUITY_PRIVATE_KEY.replace(/\\n/g, '\n');
  } else if (process.env.EQUITY_PRIVATE_KEY_PATH) {
    cachedPrivateKey = fs.readFileSync(process.env.EQUITY_PRIVATE_KEY_PATH, 'utf8');
  }
  return cachedPrivateKey;
};

// Jenga wants SHA-256 with RSA over a concatenated string, Base64 encoded.
const sign = (text) => crypto.createSign('RSA-SHA256').update(text).sign(getPrivateKey(), 'base64');

// Jenga bearer tokens are short-lived (~15 min). Cached in memory — use Redis if you run multiple instances.
const getAccessToken = (callback) => {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return callback(null, cachedToken);
  }

  axios.post(
    `${BASE_URL}${AUTH_PATH}`,
    { merchantCode: process.env.EQUITY_MERCHANT_CODE, consumerSecret: process.env.EQUITY_CONSUMER_SECRET },
    { headers: { 'Api-Key': process.env.EQUITY_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
  )
    .then((response) => {
      const data = response.data || {};
      if (!data.accessToken) return callback({ message: 'Equity authentication returned no token', raw: data });
      cachedToken = data.accessToken;
      // expiresIn is an ISO timestamp, not a number of seconds
      const expiry = Date.parse(data.expiresIn);
      tokenExpiresAt = (Number.isNaN(expiry) ? Date.now() + 10 * 60 * 1000 : expiry) - 60 * 1000; // refresh 1 min early
      callback(null, cachedToken);
    })
    .catch((err) => callback(toError(err)));
};

// Equity's account-based flow takes a short (6 char) alphanumeric reference that must be unique.
// This is the id we reconcile on: Jenga echoes it back as transactionReference in the callback.
const REF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generateReference = () => Array.from({ length: 6 }, () => REF_CHARS[crypto.randomInt(REF_CHARS.length)]).join('');

// Jenga posts the result here. The secret rides along as ?token=..., and
// equityController.handleCallback rejects callbacks without it.
const buildCallbackUrl = () => {
  const url = new URL(process.env.EQUITY_CALLBACK_URL);
  url.searchParams.set('token', process.env.EQUITY_CALLBACK_SECRET);
  return url.toString();
};

const nairobiDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }); // YYYY-MM-DD

// amount is rounded to whole KES here (Jenga rounds up anyway), so what we ask for is what gets charged.
const initiateStkPush = ({ phone, amount }, callback) => {
  const amountStr = Math.round(amount).toFixed(2);
  const mobileNumber = normalizePhone(phone);
  const accountNumber = process.env.EQUITY_ACCOUNT_NUMBER;

  const send = (attempt, tokenRetried) => {
    const ref = generateReference();

    getAccessToken((tokenErr, accessToken) => {
      if (tokenErr) return callback(tokenErr);

      let signature;
      try {
        // accountNumber + ref + mobileNumber + telco + amount + currency, no separators
        signature = sign(`${accountNumber}${ref}${mobileNumber}${TELCO}${amountStr}${CURRENCY}`);
      } catch (signErr) {
        return callback({ message: 'Could not sign the Equity request — check EQUITY_PRIVATE_KEY / EQUITY_PRIVATE_KEY_PATH' });
      }

      const payload = {
        merchant: {
          countryCode: COUNTRY_CODE,
          accountNumber,
          name: process.env.EQUITY_MERCHANT_NAME,
        },
        payment: {
          ref,
          amount: amountStr,
          currency: CURRENCY,
          telco: TELCO,
          mobileNumber,
          date: nairobiDate(),
          callBackUrl: buildCallbackUrl(),
          pushType: process.env.EQUITY_PUSH_TYPE === 'USSD' ? 'USSD' : 'STK',
        },
      };

      axios.post(`${BASE_URL}${STK_PATH}`, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Signature: signature,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      })
        .then((response) => {
          const data = response.data || {};
          // Accepted = status true, code -1; the final result arrives on the callback.
          if (data.status === true && String(data.code) === '-1') {
            return callback(null, { reference: data.reference || ref, raw: data });
          }
          // 400101: that reference was already used — draw a new one.
          if (String(data.code) === '400101' && attempt < MAX_REF_ATTEMPTS) return send(attempt + 1, tokenRetried);
          callback({ message: data.message || 'Equity rejected the request', raw: data });
        })
        .catch((err) => {
          const body = (err.response && err.response.data) || {};
          if (String(body.code) === '400101' && attempt < MAX_REF_ATTEMPTS) return send(attempt + 1, tokenRetried);
          // Expired/revoked token: drop the cache and retry once. (106401 = this account isn't
          // enabled for the telco, which a new token won't fix.)
          if (err.response && err.response.status === 401 && String(body.code) !== '106401' && !tokenRetried) {
            cachedToken = null;
            return send(attempt, true);
          }
          callback(toError(err));
        });
    });
  };

  send(1, false);
};

module.exports = { isConfigured, getAccessToken, initiateStkPush };
