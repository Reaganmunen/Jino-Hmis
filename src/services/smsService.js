/**
 * smsService.js
 *
 * Sends appointment SMS to patients through Africa's Talking and records every
 * attempt in the "SmsLog" table (which event, who triggered it, how many billable
 * segments, what it cost). Used by appointmentController.notifyPatient(), the same
 * place that already sends the email, so SMS and email can never drift apart.
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
 *   AT_USERNAME              your Africa's Talking app username ('sandbox' while testing)
 *   AT_API_KEY               API key from the AT dashboard
 *   AT_SENDER_ID             optional, approved alphanumeric sender ID (max 11 chars)
 *   AT_ENV                   'sandbox' or 'production' (default: production when NODE_ENV=production)
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
// Africa's Talking
// ---------------------------------------------------------------------------

const isSandbox = () => {
  const env = (process.env.AT_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox')).toLowerCase();
  return env === 'sandbox';
};

const postToAfricasTalking = ({ to, message }) =>
  new Promise((resolve, reject) => {
    const form = { username: process.env.AT_USERNAME, to, message };
    if (process.env.AT_SENDER_ID && !isSandbox()) form.from = process.env.AT_SENDER_ID;
    const body = new URLSearchParams(form).toString();

    const req = https.request(
      {
        hostname: isSandbox() ? 'api.sandbox.africastalking.com' : 'api.africastalking.com',
        path: '/version1/messaging',
        method: 'POST',
        headers: {
          apiKey: process.env.AT_API_KEY,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Africa's Talking HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`Unreadable response: ${raw.slice(0, 200)}`)); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Africa\'s Talking request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

// AT statusCodes: 100 Processed, 101 Sent, 102 Queued are all "accepted"; others are rejections
const AT_ACCEPTED = new Set([100, 101, 102]);

// "KES 0.8000" -> 0.8
const parseCost = (cost) => {
  const n = parseFloat(String(cost || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
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
    const text = buildAppointmentSms(event, details);
    if (!text) return; // statuses with no SMS (checked_in, completed, no_show ...)

    // The patient did this themselves and is looking at the confirmation screen. Texting them
    // costs money and tells them nothing new. Flip SMS_NOTIFY_SELF_ACTIONS=true to override.
    const isSelfAction = actor && actor.role === 'patient';
    if (isSelfAction && process.env.SMS_NOTIFY_SELF_ACTIONS !== 'true') return;

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
    if (!process.env.AT_USERNAME || !process.env.AT_API_KEY) {
      console.error('smsService: SMS_ENABLED is true but AT_USERNAME / AT_API_KEY are not set');
      return;
    }

    try {
      const data = await postToAfricasTalking({ to: phone, message });
      const recipient = data && data.SMSMessageData && data.SMSMessageData.Recipients && data.SMSMessageData.Recipients[0];
      if (recipient && AT_ACCEPTED.has(Number(recipient.statusCode))) {
        console.log(`smsService: sent '${event}' for appointment ${details.id} (${segments} seg, ${recipient.cost})`);
        return writeLog({
          ...base, phone, status: 'sent', provider_message_id: recipient.messageId, cost_kes: parseCost(recipient.cost),
        });
      }
      const reason = recipient ? `${recipient.status} (code ${recipient.statusCode})` : 'No recipient in provider response';
      console.error(`smsService: provider rejected '${event}' for appointment ${details.id}: ${reason}`);
      return writeLog({ ...base, phone, status: 'failed', error: reason });
    } catch (sendErr) {
      console.error(`smsService: send failed for appointment ${details.id}:`, sendErr.message);
      return writeLog({ ...base, phone, status: 'failed', error: sendErr.message.slice(0, 300) });
    }
  } catch (err) {
    console.error('smsService: unexpected error:', err.message);
  }
};

module.exports = { sendAppointmentSms, normalizeKenyanPhone, countSegments, toGsm, parseCost };
