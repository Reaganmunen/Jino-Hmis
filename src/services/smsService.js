/**
 * smsService.js
 *
 * Sends appointment SMS to patients through HashSMS (HashBack Solutions, api.hashback.co.ke)
 * and records every attempt in the "SmsLog" table (which event, who triggered it, how many
 * billable units, what it cost). Used by appointmentController.notifyPatient(), the same
 * place that already sends the email, so SMS and email can never drift apart.
 *
 * Why HashSMS: every account can send from day one on the shared sender "HASHBACKSMS", with no
 * sender ID application, at a flat KES 0.35 per unit (168 characters) on all Kenyan networks.
 * You top up the SMS wallet by M-Pesa and send. A message the network rejects is refunded.
 *
 * Fire-and-forget by design: callers must NOT await sendAppointmentSms() before
 * responding. It never throws; any failure is logged and the appointment action
 * (which has already succeeded) is unaffected.
 *
 * Uses Node's built-in https module, so there is no new npm dependency to install.
 *
 * Off by default. A clinic that has not set SMS_ENABLED=true (or SMS_DRY_RUN=true) gets
 * an immediate return from sendAppointmentSms(): no database query, no network call, no
 * console output, so deployments that don't use SMS behave exactly as before.
 *
 * Env vars:
 *   SMS_ENABLED              'true' to really send. Unset = completely off
 *   SMS_DRY_RUN              'true' (with SMS_ENABLED not true) prints each message to the console
 *                            instead of sending; handy for checking wording before going live
 *   HASHSMS_API_KEY          your HashBack API key (dashboard > Settings)
 *   HASHSMS_SENDER_ID        optional. Leave empty to use your account default (the shared
 *                            HASHBACKSMS sender, or your own sender ID once one is assigned)
 *   HASHSMS_BASE_URL         optional, default https://api.hashback.co.ke/sms
 *   SMS_CLINIC_NAME          optional short name for the SMS prefix (falls back to CLINIC_NAME)
 *   SMS_NOTIFY_SELF_ACTIONS  'true' to also text a patient about things they did themselves
 *                            (default false: they just saw it on screen, so it would be paid-for noise)
 */

const https = require('https');
const { URLSearchParams } = require('url');
const pool = require('../config/db');
const { buildAppointmentSms } = require('./smsTemplates');

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

// Accepts 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, 254XXXXXXXXX, +254XXXXXXXXX (spaces/dashes ok).
// Returns '+2547XXXXXXXX' or null if it is not a Kenyan mobile number. Returning null
// (instead of guessing) means a typo'd number is reported, not silently texted to a stranger.
const normalizeKenyanPhone = (phone) => {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('254')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  // What is left must be the 9-digit national number starting 7 or 1 (Safaricom/Airtel/Telkom)
  if (!/^[17]\d{8}$/.test(digits)) return null;
  return `+254${digits}`;
};

// ---------------------------------------------------------------------------
// Billing: how many SMS does this text count as?
//
// Networks bill per SEGMENT, not per message. A text made only of GSM-7 characters
// fits 160 chars in one segment (153 each once it needs 2+). The moment ONE character
// falls outside GSM-7 (a curly apostrophe, an em dash, an emoji) the whole message
// switches to Unicode: 70 chars per segment (67 once multipart). So a single "’" can
// turn a 1-SMS message into a 3-SMS message. toGsm() below prevents the common ones.
// ---------------------------------------------------------------------------

const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(''),
);
const GSM7_EXTENDED = new Set('^{}\\[~]|€'.split('')); // each costs 2 characters

// Swap the typographic characters that word processors and editors love for plain ASCII
const toGsm = (text) =>
  String(text)
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u202F\u2009]/g, ' ');

const countSegments = (text) => {
  let isGsm = true;
  let length = 0;
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) length += 1;
    else if (GSM7_EXTENDED.has(ch)) length += 2;
    else { isGsm = false; break; }
  }
  if (!isGsm) {
    length = [...text].length; // roughly; emoji can be 2 UTF-16 units, close enough for a cost estimate
    return { encoding: 'UCS-2', length, segments: length <= 70 ? 1 : Math.ceil(length / 67) };
  }
  return { encoding: 'GSM-7', length, segments: length <= 160 ? 1 : Math.ceil(length / 153) };
};

// ---------------------------------------------------------------------------
// HashSMS
// ---------------------------------------------------------------------------

const getSendUrl = () => {
  const raw = process.env.HASHSMS_BASE_URL || 'https://api.hashback.co.ke/sms';
  return new URL(raw.replace(/\/+$/, '') + '/send');
};

const postToHashSms = ({ to, message }) =>
  new Promise((resolve, reject) => {
    const url = getSendUrl();
    const payload = { to, message }; // HashSMS accepts 07..., 2547... and +2547...
    // sender_id omitted = the account default (shared HASHBACKSMS, or your own ID once assigned)
    if (process.env.HASHSMS_SENDER_ID) payload.sender_id = process.env.HASHSMS_SENDER_ID;
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.HASHSMS_API_KEY}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* handled below */ }
          if (!json) {
            return reject(new Error(`HashSMS HTTP ${res.statusCode}: unreadable response ${raw.slice(0, 200)}`));
          }
          resolve({ httpStatus: res.statusCode, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('HashSMS request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

// Success is 201 with { success: true, id, to, sender_id, status, units, cost, balance }.
// Failures carry a stable `code` (INSUFFICIENT_FUNDS, SENDER_NOT_FOUND, RATE_LIMITED, ...).
const readHashSmsReply = ({ httpStatus, json }) => {
  const ok = httpStatus >= 200 && httpStatus < 300 && json.success !== false;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return {
    ok,
    messageId: json.id || null,
    units: num(json.units),
    costKes: num(json.cost),
    balance: num(json.balance),
    senderId: json.sender_id || null,
    error: ok ? null : `${json.code ? json.code + ': ' : ''}${json.message || `HTTP ${httpStatus}`}`.slice(0, 300),
  };
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const writeLog = (row) =>
  pool
    .query(
      `INSERT INTO "SmsLog"
         (appointment_id, patient_id, event, phone, message, encoding, segments,
          status, provider_message_id, cost_kes, error, triggered_by, triggered_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.appointment_id, row.patient_id, row.event, row.phone, row.message, row.encoding, row.segments,
        row.status, row.provider_message_id || null, row.cost_kes ?? null, row.error || null,
        row.triggered_by || null, row.triggered_role || null,
      ],
    )
    .catch((err) => console.error('smsService: could not write SmsLog row:', err.message));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {string} event   'booked' | 'confirmed' | 'cancelled' | 'rescheduled' | 'reassigned'
 * @param {object} details row from findAppointmentWithDetails (needs patient_phone, names, scheduled_start)
 * @param {object} actor   req.user of whoever did the action ({ id, role }); null for system actions
 */
const sendAppointmentSms = async (event, details, actor) => {
  // Feature switch: clinics not using SMS stop here, before anything else runs.
  if (process.env.SMS_ENABLED !== 'true' && process.env.SMS_DRY_RUN !== 'true') return;

  try {
    console.log(`smsService: '${event}' for appointment ${details.id}, triggered by ${actor ? actor.role : 'system'}`);
    const text = buildAppointmentSms(event, details);
    if (!text) {
      console.log(`smsService: no SMS template for '${event}', nothing sent`); // statuses like checked_in, completed, no_show
      return;
    }

    // The patient did this themselves and is looking at the confirmation screen. Texting them
    // costs money and tells them nothing new. Flip SMS_NOTIFY_SELF_ACTIONS=true to override.
    const isSelfAction = actor && actor.role === 'patient';
    if (isSelfAction && process.env.SMS_NOTIFY_SELF_ACTIONS !== 'true') {
      console.log(`smsService: skipped '${event}', the patient did this themselves (set SMS_NOTIFY_SELF_ACTIONS=true to text them anyway)`);
      return;
    }

    const message = toGsm(text);
    const { encoding, segments, length } = countSegments(message);
    if (encoding !== 'GSM-7') {
      console.warn(`smsService: '${event}' message is ${encoding} (${length} chars, ${segments} segments). A non-GSM character crept in.`);
    }

    const base = {
      appointment_id: details.id,
      patient_id: details.patient_id,
      event,
      message,
      encoding,
      segments,
      triggered_by: actor ? actor.id : null,
      triggered_role: actor ? actor.role : null,
    };

    const phone = normalizeKenyanPhone(details.patient_phone);
    if (!phone) {
      console.error(`smsService: '${event}' for appointment ${details.id} not sent, bad or missing phone: ${details.patient_phone}`);
      if (process.env.SMS_ENABLED !== 'true') return; // dry run: console only, no DB
      return writeLog({ ...base, phone: String(details.patient_phone || ''), status: 'failed', error: 'Missing or invalid Kenyan phone number' });
    }

    if (process.env.SMS_ENABLED !== 'true') { // only reachable with SMS_DRY_RUN=true
      console.log(`smsService [dry run] -> ${phone} (${segments} seg): ${message}`);
      return;
    }
    if (!process.env.HASHSMS_API_KEY) {
      console.error('smsService: SMS_ENABLED is true but HASHSMS_API_KEY is not set');
      return;
    }

    try {
      const reply = readHashSmsReply(await postToHashSms({ to: phone, message }));
      if (reply.ok) {
        const units = reply.units ?? segments;
        console.log(`smsService: sent '${event}' for appointment ${details.id} (${units} unit(s), KES ${reply.costKes ?? '?'}, sender ${reply.senderId || 'default'}, wallet ${reply.balance ?? '?'})`);
        return writeLog({
          ...base, phone, segments: units, status: 'sent', provider_message_id: reply.messageId, cost_kes: reply.costKes,
        });
      }
      console.error(`smsService: provider rejected '${event}' for appointment ${details.id}: ${reply.error}`);
      return writeLog({ ...base, phone, status: 'failed', error: reply.error });
    } catch (sendErr) {
      console.error(`smsService: send failed for appointment ${details.id}:`, sendErr.message);
      return writeLog({ ...base, phone, status: 'failed', error: sendErr.message.slice(0, 300) });
    }
  } catch (err) {
    console.error('smsService: unexpected error:', err.message);
  }
};

// Startup banner, only for clinics that enabled SMS (or dry run): shows what THIS running process
// picked up from its environment, so "did my env vars load / did it restart?" is answered in the logs.
if (process.env.SMS_ENABLED === 'true' || process.env.SMS_DRY_RUN === 'true') {
  console.log(
    `smsService: ${process.env.SMS_ENABLED === 'true' ? 'LIVE' : 'DRY RUN'} | provider=HashSMS`
    + ` | apiKey=${process.env.HASHSMS_API_KEY ? 'set' : '(MISSING)'}`
    + ` | senderId=${process.env.HASHSMS_SENDER_ID || '(account default)'} | selfActions=${process.env.SMS_NOTIFY_SELF_ACTIONS === 'true'}`,
  );
}

module.exports = { sendAppointmentSms, normalizeKenyanPhone, countSegments, toGsm };
