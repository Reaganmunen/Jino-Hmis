const {
  findLatestByPatient, findAllByPatient, createMedicalHistory, findPatientAllergies,
} = require('../models/medicalHistoryModel');
const {
  GROUPS, CONDITIONS, CONDITION_KEYS, PROCEDURES, SMOKING, ALCOHOL, STALE_AFTER_DAYS,
} = require('../config/medicalHistoryCatalogue');
const {
  buildContext, standingAlerts, drugAlerts, procedureAlerts,
} = require('../services/medicalAlertService');

const clip = (value, max) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};

// Turns whatever the client sent into a clean row. Unknown condition keys,
// empty medicines and out-of-range numbers are silently dropped.
const sanitize = (body) => {
  const b = body || {};

  const conditions = Array.isArray(b.conditions)
    ? Array.from(new Set(b.conditions.filter((k) => CONDITION_KEYS.has(k))))
    : [];

  const condition_notes = {};
  if (b.condition_notes && typeof b.condition_notes === 'object') {
    conditions.forEach((k) => {
      const note = clip(b.condition_notes[k], 300);
      if (note) condition_notes[k] = note;
    });
  }

  const medications = (Array.isArray(b.medications) ? b.medications : [])
    .map((m) => ({
      name: clip(m && m.name, 120),
      dose: clip(m && m.dose, 80),
      frequency: clip(m && m.frequency, 80),
      reason: clip(m && m.reason, 120),
    }))
    .filter((m) => m.name)
    .slice(0, 30);

  const is_pregnant = b.is_pregnant === true || b.is_pregnant === 'true';
  let pregnancy_weeks = null;
  if (is_pregnant && b.pregnancy_weeks !== '' && b.pregnancy_weeks != null) {
    const w = parseInt(b.pregnancy_weeks, 10);
    if (Number.isFinite(w) && w >= 1 && w <= 45) pregnancy_weeks = w;
  }

  const anaesthetic_reaction = b.anaesthetic_reaction === true || b.anaesthetic_reaction === 'true';

  return {
    conditions,
    condition_notes,
    medications,
    is_pregnant,
    pregnancy_weeks,
    is_breastfeeding: b.is_breastfeeding === true || b.is_breastfeeding === 'true',
    smoking_status: SMOKING.includes(b.smoking_status) ? b.smoking_status : null,
    alcohol_use: ALCOHOL.includes(b.alcohol_use) ? b.alcohol_use : null,
    anaesthetic_reaction,
    anaesthetic_reaction_notes: anaesthetic_reaction ? clip(b.anaesthetic_reaction_notes, 1000) : null,
    past_surgeries: clip(b.past_surgeries, 1000),
    other_conditions: clip(b.other_conditions, 1000),
    notes: clip(b.notes, 2000),
  };
};

const isClinician = (user) => user.role === 'dentist' || user.role === 'admin';

// How current is this record? Used to prompt a re-confirmation.
const reviewStatus = (row) => {
  if (!row) return { needs_review: true, stale: false, days_since_review: null };
  if (!row.reviewed_at) return { needs_review: true, stale: false, days_since_review: null };
  const days = Math.floor((Date.now() - new Date(row.reviewed_at).getTime()) / 86400000);
  return { needs_review: false, stale: days > STALE_AFTER_DAYS, days_since_review: days };
};

/* GET /medical-history/catalogue */
const getCatalogue = (req, res) => {
  res.json({
    groups: GROUPS,
    conditions: CONDITIONS,
    procedures: PROCEDURES.map((p) => ({ key: p.key, label: p.label })),
    smoking: SMOKING,
    alcohol: ALCOHOL,
    stale_after_days: STALE_AFTER_DAYS,
  });
};

/* GET /medical-history/patient/:patientId  -> { current, needs_review, stale, days_since_review } */
const getCurrent = (req, res, next) => {
  findLatestByPatient(req.params.patientId, (err, row) => {
    if (err) return next(err);
    res.json({ current: row, ...reviewStatus(row) });
  });
};

/* GET /medical-history/patient/:patientId/history  (clinicians only) */
const getHistory = (req, res, next) => {
  findAllByPatient(req.params.patientId, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

/* POST /medical-history/patient/:patientId
   Always inserts a new version. Clinician saves count as reviewed; entries by
   reception or the patient stay "not yet reviewed" until a dentist confirms them. */
const saveHistory = (req, res, next) => {
  const clinician = isClinician(req.user);
  const data = {
    ...sanitize(req.body),
    patient_id: req.params.patientId,
    // staff = dentist/admin (reviewed on save), reception = front desk, patient = self
    source: clinician ? 'staff' : (req.user.role === 'receptionist' ? 'reception' : 'patient'),
    recorded_by: req.user.id,
    reviewed_by: clinician ? req.user.id : null,
    reviewed_at: clinician ? new Date().toISOString() : null,
  };
  createMedicalHistory(data, (err, row) => {
    if (err) return next(err);
    res.status(201).json({ current: row, ...reviewStatus(row) });
  });
};

/* POST /medical-history/patient/:patientId/confirm
   "Nothing has changed since last time" — copies the newest version forward
   with a fresh review stamp, so the record shows it was re-checked today. */
const confirmHistory = (req, res, next) => {
  findLatestByPatient(req.params.patientId, (err, latest) => {
    if (err) return next(err);
    if (!latest) return res.status(404).json({ message: 'No medical history on file to confirm' });
    const data = {
      patient_id: latest.patient_id,
      conditions: latest.conditions,
      condition_notes: latest.condition_notes,
      medications: latest.medications,
      is_pregnant: latest.is_pregnant,
      pregnancy_weeks: latest.pregnancy_weeks,
      is_breastfeeding: latest.is_breastfeeding,
      smoking_status: latest.smoking_status,
      alcohol_use: latest.alcohol_use,
      anaesthetic_reaction: latest.anaesthetic_reaction,
      anaesthetic_reaction_notes: latest.anaesthetic_reaction_notes,
      past_surgeries: latest.past_surgeries,
      other_conditions: latest.other_conditions,
      notes: latest.notes,
      source: 'staff',
      recorded_by: req.user.id,
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    };
    createMedicalHistory(data, (insErr, row) => {
      if (insErr) return next(insErr);
      res.status(201).json({ current: row, ...reviewStatus(row) });
    });
  });
};

/* GET /medical-history/patient/:patientId/alerts?drug=amoxicillin&procedure=extraction
   -> { has_history, needs_review, stale, standing: [], drug: [], procedure: [] } */
const getAlerts = (req, res, next) => {
  const { patientId } = req.params;
  findPatientAllergies(patientId, (pErr, patient) => {
    if (pErr) return next(pErr);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    findLatestByPatient(patientId, (err, row) => {
      if (err) return next(err);
      const ctx = buildContext(row, patient);
      const status = reviewStatus(row);
      res.json({
        has_history: !!row,
        needs_review: status.needs_review,
        stale: status.stale,
        standing: row || ctx.latex ? standingAlerts(ctx) : [],
        drug: req.query.drug ? drugAlerts(ctx, req.query.drug) : [],
        procedure: req.query.procedure ? procedureAlerts(ctx, req.query.procedure) : [],
      });
    });
  });
};

module.exports = {
  getCatalogue, getCurrent, getHistory, saveHistory, confirmHistory, getAlerts,
};
