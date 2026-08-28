const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.CLINIC_GMAIL_USER,
    pass: process.env.CLINIC_GMAIL_APP_PASSWORD,
  },
});

const sendEmail = ({ to, subject, html }) => {
  if (!to) {
    console.warn('sendEmail: appointment has no patient email on file, skipping');
    return;
  }
  transporter.sendMail({
    from: `"${process.env.CLINIC_NAME}" <${process.env.CLINIC_GMAIL_USER}>`,
    to,
    subject,
    html,
  }).catch((err) => {
    // Email failures must never break the appointment flow itself —
    // the appointment action has already succeeded and already responded.
    console.error('Email send failed:', err.message);
  });
};

module.exports = { sendEmail };