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

// Joined so callers (e.g. the receptionist dashboard) get display-ready names
// without a second round-trip per row. Mirrors the column naming already used
// by the admin /admin/schedule endpoint (patient_first_name, dentist_last_name, ...).
const findAppointmentsByStatus = (status, callback) => {
  const query = `
    SELECT a.*,
           p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.phone AS patient_phone,
           d.first_name AS dentist_first_name, d.last_name AS dentist_last_name
    FROM "Appointment" a
    JOIN "Patient" p ON p.id = a.patient_id
    JOIN "User" d ON d.id = a.dentist_id
    WHERE a.status = $1 AND a.deleted_at IS NULL
    ORDER BY a.scheduled_start
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

// Full edit — used by staff (receptionist) to reassign dentist and/or
// reschedule + adjust room/reason in one go. Kept separate from
// rescheduleAppointment above (which only touches time and is also called
// from the patient-facing reschedule flow) so patient behavior is untouched.
// Deliberately does not touch `status` — editing a checked_in appointment's
// room shouldn't silently revert it to 'confirmed'. Any overlapping-slot
// violation for the new dentist_id/time is caught by the same DB exclusion
// constraint that protects createAppointment (23P01, handled centrally by
// errorMiddleware).
const updateAppointment = (id, data, callback) => {
  const { dentist_id, scheduled_start, scheduled_end, room, reason } = data;
  const query = `
    UPDATE "Appointment"
    SET dentist_id = $1, scheduled_start = $2, scheduled_end = $3, room = $4, reason = $5
    WHERE id = $6 AND deleted_at IS NULL
    RETURNING *
  `;
  const values = [dentist_id, scheduled_start, scheduled_end, room, reason, id];
  pool.query(query, values, (err, result) => {
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
  updateAppointment,
  softDeleteAppointment,
};