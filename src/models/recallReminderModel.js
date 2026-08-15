const pool = require('../config/db');

const createRecallReminder = (data, callback) => {
  const { patient_id, due_date, reminder_type, channel, notes } = data;
  const query = `
    INSERT INTO "RecallReminder" (patient_id, due_date, reminder_type, channel, notes)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  pool.query(query, [patient_id, due_date, reminder_type, channel, notes], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Used by a scheduled job (cron) to find what needs sending today/soon
const findDueReminders = (byDate, callback) => {
  const query = `
    SELECT r.*, p.first_name, p.last_name, p.phone, p.email
    FROM "RecallReminder" r
    JOIN "Patient" p ON p.id = r.patient_id
    WHERE r.status = 'pending' AND r.due_date <= $1
    ORDER BY r.due_date
  `;
  pool.query(query, [byDate], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findRemindersByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "RecallReminder" WHERE patient_id = $1 ORDER BY due_date DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const markReminderSent = (id, callback) => {
  const query = `
    UPDATE "RecallReminder" SET status = 'sent', sent_at = now() WHERE id = $1
    RETURNING *
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

module.exports = {
  createRecallReminder,
  findDueReminders,
  findRemindersByPatient,
  markReminderSent,
};