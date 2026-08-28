const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS — upgrades to encrypted after connecting, unlike port 465's implicit SSL
  auth: {
    user: process.env.CLINIC_GMAIL_USER,
    pass: process.env.CLINIC_GMAIL_APP_PASSWORD,
  },
  family: 4, // force IPv4 — avoids ENETUNREACH on Render
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
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