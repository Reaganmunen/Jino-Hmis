/**
 * smsTemplates.js
 *
 * One short message per appointment event. Keep each under 160 characters so it
 * bills as a single SMS: you pay per segment, so a 170-character message costs double.
 * smsService.toGsm() also swaps curly quotes and dashes for plain ones, so a pasted
 * "smart" character can't silently push a message into the 70-character Unicode limit.
 *
 * Events with no entry here (checked_in, completed, no_show ...) send no SMS.
 * To stop texting for an event, delete its line. To add one, add a line.
 */

// Africa/Nairobi is UTC+3 with no daylight saving, so formatting with an explicit
// timeZone is exact no matter where the server runs (Render runs in UTC).
const formatWhen = (iso) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  // e.g. "Fri 14 Nov, 10:30AM"
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}${get('dayPeriod').toUpperCase()}`;
};

const templates = {
  // Receptionist (or patient) booked it. Status starts as 'pending', so say it is not final yet.
  booked: (a, clinic) =>
    `${clinic}: Hi ${a.patient_first_name}, we received your appointment request with Dr ${a.dentist_last_name} for ${formatWhen(a.scheduled_start)}. We will confirm shortly.`,

  // Dentist/staff confirmed it
  confirmed: (a, clinic) =>
    `${clinic}: Hi ${a.patient_first_name}, your appointment with Dr ${a.dentist_last_name} is CONFIRMED for ${formatWhen(a.scheduled_start)}. Please arrive 10 min early.`,

  // New date/time (dentist or reception moved it)
  rescheduled: (a, clinic) =>
    `${clinic}: Hi ${a.patient_first_name}, your appointment with Dr ${a.dentist_last_name} has been moved to ${formatWhen(a.scheduled_start)}. Call us if this time does not work.`,

  // Cancelled, whether by status change or delete
  cancelled: (a, clinic) =>
    `${clinic}: Hi ${a.patient_first_name}, your appointment on ${formatWhen(a.scheduled_start)} has been CANCELLED. Call us to book a new time.`,

  // Same time, different dentist
  reassigned: (a, clinic) =>
    `${clinic}: Hi ${a.patient_first_name}, your appointment on ${formatWhen(a.scheduled_start)} is now with Dr ${a.dentist_last_name}. The time has not changed.`,
};

const buildAppointmentSms = (event, appointment, clinicName = process.env.SMS_CLINIC_NAME || process.env.CLINIC_NAME || 'Dental Clinic') => {
  const build = templates[event];
  return build ? build(appointment, clinicName) : null;
};

module.exports = { buildAppointmentSms, formatWhen };
