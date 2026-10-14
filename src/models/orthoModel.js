const pool = require('../config/db');

const FROM_JOIN = `
  FROM "OrthoCase" c
  JOIN "User" d ON d.id = c.dentist_id
`;

// Plain strings for date columns avoid JS Date timezone shifts.
const CASE_COLUMNS = `
  c.id, c.patient_id, c.dentist_id, c.treatment_type,
  c.angle_class_right, c.angle_class_left, c.skeletal_pattern,
  c.overjet_mm, c.overbite_mm, c.crowding_upper_mm, c.crowding_lower_mm, c.midline_deviation_mm,
  c.crossbite, c.open_bite, c.problem_list, c.treatment_objectives, c.extractions, c.appliance_notes,
  c.planned_months, c.total_fee, c.baseline_status, c.baseline_finalised_at,
  c.status, c.retainer_type, c.retention_notes, c.discontinue_reason,
  to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(c.debond_date, 'YYYY-MM-DD') AS debond_date,
  c.created_at, c.updated_at,
  d.first_name AS dentist_first_name, d.last_name AS dentist_last_name,
  (SELECT count(*)::int FROM "OrthoVisit" v WHERE v.case_id = c.id) AS visit_count,
  (SELECT to_char(max(v.visit_date), 'YYYY-MM-DD') FROM "OrthoVisit" v WHERE v.case_id = c.id) AS last_visit_date
`;

const VISIT_COLUMNS = `
  v.id, v.case_id, v.patient_id, v.dentist_id, v.appointment_id,
  to_char(v.visit_date, 'YYYY-MM-DD') AS visit_date,
  v.visit_type, v.upper_wire, v.lower_wire, v.elastics, v.aligner_tray, v.ipr_done,
  v.procedures, v.oral_hygiene, v.compliance, v.progress, v.notes, v.next_visit_weeks,
  v.created_at, v.updated_at,
  u.first_name AS dentist_first_name, u.last_name AS dentist_last_name
`;

const rows = (callback) => (err, result) => {
  if (err) return callback(err);
  callback(null, result.rows);
};

/* ---------------- cases ---------------- */

const findCasesByPatient = (patient_id, callback) => {
  pool.query(
    `SELECT ${CASE_COLUMNS} ${FROM_JOIN} WHERE c.patient_id = $1 ORDER BY c.created_at DESC LIMIT 50`,
    [patient_id],
    rows(callback),
  );
};

const findCaseById = (id, callback) => {
  pool.query(`SELECT ${CASE_COLUMNS} ${FROM_JOIN} WHERE c.id = $1`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

const BASELINE_FIELDS = [
  'treatment_type', 'angle_class_right', 'angle_class_left', 'skeletal_pattern',
  'overjet_mm', 'overbite_mm', 'crowding_upper_mm', 'crowding_lower_mm', 'midline_deviation_mm',
  'crossbite', 'open_bite', 'problem_list', 'treatment_objectives', 'extractions', 'appliance_notes',
  'planned_months', 'total_fee',
];

// `data` must already be validated/sanitised by the controller.
const createCase = (data, callback) => {
  const cols = ['patient_id', 'dentist_id', ...BASELINE_FIELDS, 'baseline_status', 'baseline_finalised_at'];
  const values = [
    data.patient_id, data.dentist_id, ...BASELINE_FIELDS.map((f) => data[f]),
    data.baseline_status, data.baseline_status === 'final' ? new Date().toISOString() : null,
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  pool.query(
    `INSERT INTO "OrthoCase" (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
    (err, result) => {
      if (err) return callback(err);
      findCaseById(result.rows[0].id, callback);
    },
  );
};

// Only drafts can change their baseline (the DB trigger enforces this as well).
const updateBaselineDraft = (id, data, callback) => {
  const sets = BASELINE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
  pool.query(
    `UPDATE "OrthoCase" SET ${sets}, updated_at = now()
     WHERE id = $1 AND baseline_status = 'draft' RETURNING id`,
    [id, ...BASELINE_FIELDS.map((f) => data[f])],
    (err, result) => {
      if (err) return callback(err);
      if (!result.rows[0]) return callback(null, null);
      findCaseById(id, callback);
    },
  );
};

const finaliseBaseline = (id, callback) => {
  pool.query(
    `UPDATE "OrthoCase" SET baseline_status = 'final', baseline_finalised_at = now(), updated_at = now()
     WHERE id = $1 AND baseline_status = 'draft' RETURNING id`,
    [id],
    (err, result) => {
      if (err) return callback(err);
      if (!result.rows[0]) return callback(null, null);
      findCaseById(id, callback);
    },
  );
};

// Status, dates and retention details: editable at any time.
const updateProgress = (id, data, callback) => {
  pool.query(
    `UPDATE "OrthoCase"
     SET status = $2, start_date = $3, debond_date = $4, retainer_type = $5,
         retention_notes = $6, discontinue_reason = $7, updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, data.status, data.start_date, data.debond_date, data.retainer_type, data.retention_notes, data.discontinue_reason],
    (err, result) => {
      if (err) return callback(err);
      if (!result.rows[0]) return callback(null, null);
      findCaseById(id, callback);
    },
  );
};

const deleteDraftCase = (id, callback) => {
  pool.query(
    `DELETE FROM "OrthoCase" c
     WHERE c.id = $1 AND c.baseline_status = 'draft'
       AND NOT EXISTS (SELECT 1 FROM "OrthoVisit" v WHERE v.case_id = c.id)
     RETURNING c.id`,
    [id],
    (err, result) => {
      if (err) return callback(err);
      callback(null, result.rows[0] || null);
    },
  );
};

/* ---------------- visits ---------------- */

const VISIT_FROM = `FROM "OrthoVisit" v JOIN "User" u ON u.id = v.dentist_id`;

const findVisitsByCase = (case_id, callback) => {
  pool.query(
    `SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE v.case_id = $1 ORDER BY v.visit_date DESC, v.created_at DESC`,
    [case_id],
    rows(callback),
  );
};

const findVisitById = (id, callback) => {
  pool.query(`SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE v.id = $1`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

const VISIT_FIELDS = [
  'appointment_id', 'visit_date', 'visit_type', 'upper_wire', 'lower_wire', 'elastics',
  'aligner_tray', 'ipr_done', 'procedures', 'oral_hygiene', 'compliance', 'progress',
  'notes', 'next_visit_weeks',
];

const createVisit = (data, callback) => {
  const cols = ['case_id', 'patient_id', 'dentist_id', ...VISIT_FIELDS];
  const values = [data.case_id, data.patient_id, data.dentist_id, ...VISIT_FIELDS.map((f) => data[f])];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  pool.query(
    `INSERT INTO "OrthoVisit" (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
    (err, result) => {
      if (err) return callback(err);
      findVisitById(result.rows[0].id, callback);
    },
  );
};

const updateVisit = (id, data, callback) => {
  const sets = VISIT_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
  pool.query(
    `UPDATE "OrthoVisit" SET ${sets}, updated_at = now() WHERE id = $1 RETURNING id`,
    [id, ...VISIT_FIELDS.map((f) => data[f])],
    (err, result) => {
      if (err) return callback(err);
      if (!result.rows[0]) return callback(null, null);
      findVisitById(id, callback);
    },
  );
};

const deleteVisit = (id, callback) => {
  pool.query(`DELETE FROM "OrthoVisit" WHERE id = $1 RETURNING id`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

// Patient-portal view: only the fields a patient should see (no internal clinical notes).
const findPortalSummary = (patient_id, callback) => {
  pool.query(
    `SELECT c.id, c.treatment_type, c.status, c.planned_months,
            to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(c.debond_date, 'YYYY-MM-DD') AS debond_date,
            c.retainer_type,
            d.first_name AS dentist_first_name, d.last_name AS dentist_last_name,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'visit_date', to_char(v.visit_date, 'YYYY-MM-DD'),
                       'visit_type', v.visit_type,
                       'aligner_tray', v.aligner_tray,
                       'next_visit_weeks', v.next_visit_weeks
                     ) ORDER BY v.visit_date DESC)
              FROM "OrthoVisit" v WHERE v.case_id = c.id
            ), '[]'::json) AS visits
     ${FROM_JOIN}
     WHERE c.patient_id = $1 AND c.baseline_status = 'final'
     ORDER BY c.created_at DESC`,
    [patient_id],
    rows(callback),
  );
};

module.exports = {
  findCasesByPatient, findCaseById, createCase, updateBaselineDraft, finaliseBaseline,
  updateProgress, deleteDraftCase,
  findVisitsByCase, findVisitById, createVisit, updateVisit, deleteVisit,
  findPortalSummary,
};