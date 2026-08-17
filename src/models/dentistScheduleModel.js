const pool = require('../config/db');

const createScheduleSlot = (data, callback) => {
  const { dentist_id, day_of_week, start_time, end_time } = data;
  const query = `
    INSERT INTO "DentistSchedule" (dentist_id, day_of_week, start_time, end_time)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  pool.query(query, [dentist_id, day_of_week, start_time, end_time], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findScheduleByDentist = (dentist_id, callback) => {
  const query = `
    SELECT * FROM "DentistSchedule"
    WHERE dentist_id = $1 AND is_active = TRUE
    ORDER BY day_of_week, start_time
  `;
  pool.query(query, [dentist_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Needed so edit/delete can confirm the requesting dentist owns this slot
// before an admin-or-dentist role check is allowed to modify it.
const findScheduleSlotById = (id, callback) => {
  const query = `SELECT * FROM "DentistSchedule" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const updateScheduleSlot = (id, data, callback) => {
  const { start_time, end_time, is_active } = data;
  const query = `
    UPDATE "DentistSchedule"
    SET start_time = $1, end_time = $2, is_active = $3
    WHERE id = $4
    RETURNING *
  `;
  pool.query(query, [start_time, end_time, is_active, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const deleteScheduleSlot = (id, callback) => {
  const query = `DELETE FROM "DentistSchedule" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rowCount);
  });
};

module.exports = {
  createScheduleSlot,
  findScheduleByDentist,
  findScheduleSlotById,
  updateScheduleSlot,
  deleteScheduleSlot,
};