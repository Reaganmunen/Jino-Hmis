/**
 * whatsappService.js
 *
 * Sends WhatsApp reminders for appointment status changes. Called directly
 * from appointmentController.js right after a status write succeeds — no
 * polling, because cancelled appointments get deleted_at set (soft delete),
 * which would make them invisible to a "deleted_at IS NULL" polling query.
 *
 * Fire-and-forget by design: callers should NOT await this before responding
 * to the client. A slow/failed WhatsApp send should never delay or fail the
 * API response for the status change itself.
 *
 * ASSUMPTION — adjust to match your real schema:
 *   "Patient" table: id, full_name, phone   (E.164-able, e.g. 07XX... or +254...)
 *   "Dentist" table: id, full_name
 * If your Patient/Dentist models use different column names, only the SQL
 * in fetchAppointmentContext() below needs to change.
 *
 * Env vars needed:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM         e.g. 'whatsapp:+14155238886' (sandbox) or approved number
 *   TWILIO_TEMPLATE_PENDING      ContentSid — booking acknowledgement (status defaults to 'pending')
 *   TWILIO_TEMPLATE_CONFIRMED    ContentSid
 *   TWILIO_TEMPLATE_CANCELLED    ContentSid
 *   TWILIO_TEMPLATE_RESCHEDULED  ContentSid
 */

const twilio = require('twilio');
const pool = require('../config/db');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const TEMPLATE_MAP = {
  pending: {
    contentSid: process.env.TWILIO_TEMPLATE_PENDING,
    buildVariables: (ctx) => ({
      1: ctx.patient_name,
      2: ctx.dentist_name,
      3: ctx.formatted_date,
      4: ctx.formatted_time,
    }),
  },
  confirmed: {
    contentSid: process.env.TWILIO_TEMPLATE_CONFIRMED,
    buildVariables: (ctx) => ({
      1: ctx.patient_name,
      2: ctx.dentist_name,
      3: ctx.formatted_date,
      4: ctx.formatted_time,
    }),
  },
  cancelled: {
    contentSid: process.env.TWILIO_TEMPLATE_CANCELLED,
    buildVariables: (ctx) => ({
      1: ctx.patient_name,
      2: ctx.formatted_date,
    }),
  },
  rescheduled: {
    contentSid: process.env.TWILIO_TEMPLATE_RESCHEDULED,
    buildVariables: (ctx) => ({
      1: ctx.patient_name,
      2: ctx.formatted_date,
      3: ctx.formatted_time,
    }),
  },
};

function formatDate(dateObj) {
  return new Date(dateObj).toLocaleDateString('en-KE', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function formatTime(dateObj) {
  return new Date(dateObj).toLocaleTimeString('en-KE', {
    hour: '2-digit', minute: '2-digit',
  });
}

/** Normalize a Kenyan local number (07... / 01...) to E.164 (+254...) */
function toE164Kenya(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254')) return `+${digits}`;
  if (digits.startsWith('0')) return `+254${digits.slice(1)}`;
  return `+${digits}`;
}

/**
 * Pull the patient/dentist details the templates need. Appointment rows
 * alone (SELECT * FROM "Appointment") don't carry names/phone, so this
 * does the join appointmentModel.js doesn't.
 *
 * There's no separate "Dentist" table — dentists are "User" rows with
 * role = 'dentist' (see userRoutes.js's GET /dentists), so dentist_id
 * on Appointment joins against "User".
 */
function fetchAppointmentContext(appointment, callback) {
  const query = `
    SELECT (p.first_name || ' ' || p.last_name) AS patient_name,
           p.phone AS patient_phone,
           (u.first_name || ' ' || u.last_name) AS dentist_name
    FROM "Patient" p, "User" u
    WHERE p.id = $1 AND u.id = $2
  `;
  pool.query(query, [appointment.patient_id, appointment.dentist_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
}

/**
 * Send a WhatsApp reminder for an appointment event.
 * @param {object} appointment - the row returned by the model functions (has patient_id, dentist_id, scheduled_start)
 * @param {'confirmed'|'cancelled'|'rescheduled'} event
 */
function sendAppointmentWhatsApp(appointment, event) {
  const template = TEMPLATE_MAP[event];
  if (!template) return; // no template configured for this event, skip silently

  fetchAppointmentContext(appointment, (ctxErr, ctx) => {
    if (ctxErr || !ctx) {
      console.error(`whatsappService: could not load context for appointment ${appointment.id}`, ctxErr?.message);
      return;
    }
    if (!ctx.patient_phone) {
      console.error(`whatsappService: no phone on file for appointment ${appointment.id}`);
      return;
    }

    const variables = template.buildVariables({
      patient_name: ctx.patient_name,
      dentist_name: ctx.dentist_name,
      formatted_date: formatDate(appointment.scheduled_start),
      formatted_time: formatTime(appointment.scheduled_start),
    });

    client.messages
      .create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:${toE164Kenya(ctx.patient_phone)}`,
        contentSid: template.contentSid,
        contentVariables: JSON.stringify(variables),
      })
      .then(() => console.log(`whatsappService: sent '${event}' for appointment ${appointment.id}`))
      .catch((err) => console.error(`whatsappService: send failed for appointment ${appointment.id}`, err.message));
  });
}

module.exports = { sendAppointmentWhatsApp };