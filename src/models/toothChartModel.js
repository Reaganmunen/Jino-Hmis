const pool = require('../config/db');

const addToothChartEntry = (data, callback) => {
  const { patient_id, appointment_id, tooth_number, condition, notes, recorded_by } = data;
  const query = `
    INSERT INTO "ToothChart" (patient_id, appointment_id, tooth_number, condition, notes, recorded_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const values = [patient_id, appointment_id, tooth_number, condition, notes, recorded_by];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Full history for a patient, newest first
const findToothChartByPatient = (patient_id, callback) => {
  const query = `
    SELECT * FROM "ToothChart"
    WHERE patient_id = $1
    ORDER BY tooth_number, recorded_at DESC
  `;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Latest condition per tooth — what the chart UI renders by default
const findCurrentToothChart = (patient_id, callback) => {
  const query = `
    SELECT DISTINCT ON (tooth_number) *
    FROM "ToothChart"
    WHERE patient_id = $1
    ORDER BY tooth_number, recorded_at DESC
  `;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findToothHistory = (patient_id, tooth_number, callback) => {
  const query = `
    SELECT * FROM "ToothChart"
    WHERE patient_id = $1 AND tooth_number = $2
    ORDER BY recorded_at DESC
  `;
  pool.query(query, [patient_id, tooth_number], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

module.exports = {
  addToothChartEntry,
  findToothChartByPatient,
  findCurrentToothChart,
  findToothHistory,
};