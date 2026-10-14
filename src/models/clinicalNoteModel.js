const pool = require('../config/db');

const NOTE_SELECT = `
  SELECT n.*,
         to_char(n.visit_date, 'YYYY-MM-DD') AS visit_date,
         d.first_name AS dentist_first_name, d.last_name AS dentist_last_name,
         a.scheduled_start AS appointment_start, a.reason AS appointment_reason
  FROM "ClinicalNote" n
  JOIN "User" d ON d.id = n.dentist_id
  LEFT JOIN "Appointment" a ON a.id = n.appointment_id
`;

const findNotesByPatient = (patient_id, callback) => {
  const query = `${NOTE_SELECT}
    WHERE n.patient_id = $1
    ORDER BY n.visit_date DESC, n.created_at DESC
    LIMIT 200`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

const findNoteById = (id, callback) => {
  pool.query(`${NOTE_SELECT} WHERE n.id = $1`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

// Addenda for a set of notes in one query (avoids one query per note).
const findAddendaByNoteIds = (noteIds, callback) => {
  if (!noteIds.length) return callback(null, []);
  const query = `
    SELECT ad.*, u.first_name AS author_first_name, u.last_name AS author_last_name
    FROM "ClinicalNoteAddendum" ad
    JOIN "User" u ON u.id = ad.created_by
    WHERE ad.note_id = ANY($1::uuid[])
    ORDER BY ad.created_at ASC
  `;
  pool.query(query, [noteIds], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// `data` must already be validated/sanitised by the controller.
const createNote = (data, callback) => {
  const query = `
    INSERT INTO "ClinicalNote"
      (patient_id, appointment_id, dentist_id, visit_date, tooth_numbers, template_key,
       subjective, objective, assessment, plan, procedure_done, status, signed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
  `;
  const values = [
    data.patient_id, data.appointment_id, data.dentist_id, data.visit_date,
    data.tooth_numbers, data.template_key,
    data.subjective, data.objective, data.assessment, data.plan, data.procedure_done,
    data.status, data.status === 'signed' ? new Date().toISOString() : null,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    findNoteById(result.rows[0].id, callback);
  });
};

// Only drafts can be updated (the DB trigger also enforces this).
const updateDraft = (id, data, callback) => {
  const query = `
    UPDATE "ClinicalNote"
    SET appointment_id = $2, visit_date = $3, tooth_numbers = $4, template_key = $5,
        subjective = $6, objective = $7, assessment = $8, plan = $9, procedure_done = $10
    WHERE id = $1 AND status = 'draft'
    RETURNING id
  `;
  const values = [
    id, data.appointment_id, data.visit_date, data.tooth_numbers, data.template_key,
    data.subjective, data.objective, data.assessment, data.plan, data.procedure_done,
  ];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    if (!result.rows[0]) return callback(null, null);
    findNoteById(id, callback);
  });
};

const signNote = (id, callback) => {
  const query = `
    UPDATE "ClinicalNote"
    SET status = 'signed', signed_at = now()
    WHERE id = $1 AND status = 'draft'
    RETURNING id
  `;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    if (!result.rows[0]) return callback(null, null);
    findNoteById(id, callback);
  });
};

const deleteDraft = (id, callback) => {
  pool.query(`DELETE FROM "ClinicalNote" WHERE id = $1 AND status = 'draft' RETURNING id`, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

const createAddendum = ({ note_id, body, created_by }, callback) => {
  const query = `
    INSERT INTO "ClinicalNoteAddendum" (note_id, body, created_by)
    VALUES ($1, $2, $3)
    RETURNING id
  `;
  pool.query(query, [note_id, body, created_by], (err, result) => {
    if (err) return callback(err);
    const sel = `
      SELECT ad.*, u.first_name AS author_first_name, u.last_name AS author_last_name
      FROM "ClinicalNoteAddendum" ad JOIN "User" u ON u.id = ad.created_by
      WHERE ad.id = $1`;
    pool.query(sel, [result.rows[0].id], (selErr, selRes) => {
      if (selErr) return callback(selErr);
      callback(null, selRes.rows[0]);
    });
  });
};

// Used to check an appointment really belongs to the patient before linking a note to it.
const findAppointmentPatient = (appointment_id, callback) => {
  pool.query(`SELECT id, patient_id FROM "Appointment" WHERE id = $1`, [appointment_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0] || null);
  });
};

module.exports = {
  findNotesByPatient, findNoteById, findAddendaByNoteIds,
  createNote, updateDraft, signNote, deleteDraft,
  createAddendum, findAppointmentPatient,
};