const pool = require('../config/db');

const createAppointment = (data, callback) => {
  const { patient_id, dentist_id, booked_by, scheduled_start, scheduled_end, reason, room } = data;
  const query = `
    INSERT INTO "Appointment"
      (patient_id, dentist_id, booked_by, scheduled_start, scheduled_end, reason, room)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const values = [patient_id, dentist_id, booked_by, scheduled_start, scheduled_end, reason, room];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findAppointmentById = (id, callback) => {
  const query = `SELECT * FROM "Appointment" WHERE id = $1 AND deleted_at IS NULL`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findAppointmentsByPatient = (patient_id, callback) => {
  const query = `
    SELECT * FROM "Appointment"
    WHERE patient_id = $1 AND deleted_at IS NULL
    ORDER BY scheduled_start DESC
  `;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findAppointmentsByDentist = (dentist_id, from, to, callback) => {
  const query = `
    SELECT * FROM "Appointment"
    WHERE dentist_id = $1 AND deleted_at IS NULL
      AND scheduled_start >= $2 AND scheduled_start < $3
    ORDER BY scheduled_start
  `;
  pool.query(query, [dentist_id, from, to], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findAppointmentsByStatus = (status, callback) => {
  const query = `
    SELECT * FROM "Appointment"
    WHERE status = $1 AND deleted_at IS NULL
    ORDER BY scheduled_start
  `;
  pool.query(query, [status], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const updateAppointmentStatus = (id, status, callback) => {
  const query = `
    UPDATE "Appointment" SET status = $1 WHERE id = $2 AND deleted_at IS NULL
    RETURNING *
  `;
  pool.query(query, [status, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const rescheduleAppointment = (id, scheduled_start, scheduled_end, callback) => {
  const query = `
    UPDATE "Appointment"
    SET scheduled_start = $1, scheduled_end = $2, status = 'confirmed'
    WHERE id = $3 AND deleted_at IS NULL
    RETURNING *
  `;
  pool.query(query, [scheduled_start, scheduled_end, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const softDeleteAppointment = (id, callback) => {
  const query = `UPDATE "Appointment" SET deleted_at = now(), status = 'cancelled' WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = {
  createAppointment,
  findAppointmentById,
  findAppointmentsByPatient,
  findAppointmentsByDentist,
  findAppointmentsByStatus,
  updateAppointmentStatus,
  rescheduleAppointment,
  softDeleteAppointment,
};