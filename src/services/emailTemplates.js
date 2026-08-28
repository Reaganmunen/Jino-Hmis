const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const wrapper = (clinicName, bodyHtml) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
    <h2 style="color:#0A1730; margin-top:0;">${clinicName}</h2>
    ${bodyHtml}
    <p style="color:#64748b; font-size: 12px; margin-top: 24px;">This is an automated message from ${clinicName}. Please do not reply to this email.</p>
  </div>
`;

// Keyed by appointment status/action. setStatus() can pass through statuses
// with no entry here (e.g. checked_in, completed) — those are silently
// skipped by getAppointmentEmail(), not treated as an error.
const templates = {
  booked: (a, clinicName) => ({
    subject: `Appointment Received - ${clinicName}`,
    html: wrapper(clinicName, `
      <p>Hi ${a.patient_first_name},</p>
      <p>We've received your appointment request with Dr. ${a.dentist_first_name} ${a.dentist_last_name} on <strong>${formatDateTime(a.scheduled_start)}</strong>.</p>
      <p>We'll confirm shortly — you'll get another email once it's confirmed.</p>
    `),
  }),
  confirmed: (a, clinicName) => ({
    subject: `Appointment Confirmed - ${clinicName}`,
    html: wrapper(clinicName, `
      <p>Hi ${a.patient_first_name},</p>
      <p>Your appointment with Dr. ${a.dentist_first_name} ${a.dentist_last_name} is <strong>confirmed</strong> for <strong>${formatDateTime(a.scheduled_start)}</strong>.</p>
      ${a.room ? `<p>Room: ${a.room}</p>` : ''}
      <p>Please arrive 10 minutes early.</p>
    `),
  }),
  cancelled: (a, clinicName) => ({
    subject: `Appointment Cancelled - ${clinicName}`,
    html: wrapper(clinicName, `
      <p>Hi ${a.patient_first_name},</p>
      <p>Your appointment scheduled for <strong>${formatDateTime(a.scheduled_start)}</strong> has been <strong>cancelled</strong>.</p>
      <p>If this wasn't you, or you'd like to rebook, please contact us.</p>
    `),
  }),
  rescheduled: (a, clinicName) => ({
    subject: `Appointment Rescheduled - ${clinicName}`,
    html: wrapper(clinicName, `
      <p>Hi ${a.patient_first_name},</p>
      <p>Your appointment with Dr. ${a.dentist_first_name} ${a.dentist_last_name} has been moved to <strong>${formatDateTime(a.scheduled_start)}</strong>.</p>
      ${a.room ? `<p>Room: ${a.room}</p>` : ''}
    `),
  }),
};

const getAppointmentEmail = (action, appointment, clinicName = process.env.CLINIC_NAME) => {
  const build = templates[action];
  return build ? build(appointment, clinicName) : null;
};

module.exports = { getAppointmentEmail };