const pool = require('../config/db');

// List view: everything except the (large) per-tooth measurements.
const LIST_COLUMNS = `
  c.id, c.patient_id, c.dentist_id,
  to_char(c.exam_date, 'YYYY-MM-DD') AS exam_date,
  c.summary, c.diagnosis, c.stage, c.grade, c.extent,
  c.recall_interval_months, c.treatment_notes,
  c.status, c.finalised_at, c.created_at, c.updated_at,
  d.first_name AS dentist_first_name, d.last_name AS dentist_last_name
`;

const FROM_JOIN = `FROM "PerioChart" c JOIN "User" d ON d.id = c.dentist_id`;

const findChartsByPatient = (patient_id, callback) => {
  const query = `SELECT ${LIST_COLUMNS} ${FROM_JOIN}
    WHERE c.patient_id = $1
    ORDER BY c.exam_date DESC, c.created_at DESC
    LIMIT 100`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Full chart including the teeth measurements.
const findChartById = (id, callback) => {
  const query = `SELECT ${LIST_COLUMNS}, c.teeth ${FROM_JOIN} WHERE c.id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

// `data` must already be validated/sanitised by the controller.
const createChart = (data, callback) => {
  const query = `
    INSERT INTO "PerioChart"
      (patient_id, dentist_id, exam_date, teeth, summary, diagnosis, stage, grade, extent,
       recall_interval_months, treatment_notes, status, finalised_at)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
  `;
  const values = [
    data.patient_id, data.dentist_id, data.exam_date,
    JSON.stringify(data.teeth), JSON.stringify(data.summary),
    data.diagnosis, data.stage, data.grade, data.extent,
    data.recall_interval_months, data.treatment_notes,
    data.status, data.status === 'final' ? new Date().toISOString() : null,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    findChartById(result.rows[0].id, callback);
  });
};

// Only drafts can be updated (the DB trigger also enforces this).
const updateDraft = (id, data, callback) => {
  const query = `
    UPDATE "PerioChart"
    SET exam_date = $2, teeth = $3::jsonb, summary = $4::jsonb,
        diagnosis = $5, stage = $6, grade = $7, extent = $8,
        recall_interval_months = $9, treatment_notes = $10
    WHERE id = $1 AND status = 'draft'
    RETURNING id
  `;
  const values = [
    id, data.exam_date, JSON.stringify(data.teeth), JSON.stringify(data.summary),
    data.diagnosis, data.stage, data.grade, data.extent,
    data.recall_interval_months, data.treatment_notes,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    if (!result.rows[0]) return callback(null, null);
    findChartById(id, callback);
  });
};

const finaliseChart = (id, callback) => {
  const query = `
    UPDATE "PerioChart" SET status = 'final', finalised_at = now()
    WHERE id = $1 AND status = 'draft'
    RETURNING id
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    if (!result.rows[0]) return callback(null, null);
    findChartById(id, callback);
  });
};

const deleteDraft = (id, callback) => {
  pool.query(`DELETE FROM "PerioChart" WHERE id = $1 AND status = 'draft' RETURNING id`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

module.exports = {
  findChartsByPatient, findChartById, createChart, updateDraft, finaliseChart, deleteDraft,
};