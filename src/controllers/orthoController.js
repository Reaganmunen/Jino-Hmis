const {
  findCasesByPatient, findCaseById, createCase, updateBaselineDraft, finaliseBaseline,
  updateProgress, deleteDraftCase,
  findVisitsByCase, findVisitById, createVisit, updateVisit, deleteVisit,
  findPortalSummary,
} = require('../models/orthoModel');
const { findPatientByUserId } = require('../models/patientModel');

const TREATMENT_TYPES = ['fixed_metal', 'fixed_ceramic', 'clear_aligners', 'lingual', 'removable', 'retainers_only'];
const ANGLE = ['I', 'II_div1', 'II_div2', 'III'];
const SKELETAL = ['I', 'II', 'III'];
const STATUSES = ['planning', 'active', 'retention', 'completed', 'discontinued'];
const OPEN_STATUSES = ['planning', 'active', 'retention'];
const TRANSITIONS = {
  planning: ['active', 'discontinued'],
  active: ['retention', 'discontinued'],
  retention: ['completed', 'active', 'discontinued'], // retention -> active = refinement
  completed: [],
  discontinued: [],
};
const VISIT_TYPES = ['records', 'bonding', 'adjustment', 'aligner_change', 'emergency', 'debond', 'retainer_fit', 'retention_review'];
const LEVELS = ['good', 'fair', 'poor'];
const PROGRESS = ['ahead', 'on_track', 'slow', 'concern'];
const VISIT_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // an adjustment record can be corrected for 24h

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const clip = (value, max) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};
const oneOf = (v, list) => (list.includes(v) ? v : null);
const toInt = (v, min, max) => {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
// Millimetres to one decimal place.
const toMm = (v, min, max) => {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
};
const toMoney = (v) => {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 99999999 ? Math.round(n * 100) / 100 : null;
};
const toDate = (v) => (typeof v === 'string' && DATE.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const bool = (v) => v === true || v === 'true';

const isFinaliseRequested = (body) => !!body && (body.finalise === true || body.finalise === 'true');

/* ---------------- baseline sanitising ---------------- */

const sanitizeBaseline = (body) => {
  const b = body || {};
  return {
    treatment_type: oneOf(b.treatment_type, TREATMENT_TYPES),
    angle_class_right: oneOf(b.angle_class_right, ANGLE),
    angle_class_left: oneOf(b.angle_class_left, ANGLE),
    skeletal_pattern: oneOf(b.skeletal_pattern, SKELETAL),
    overjet_mm: toMm(b.overjet_mm, -10, 25),
    overbite_mm: toMm(b.overbite_mm, -10, 20),
    crowding_upper_mm: toMm(b.crowding_upper_mm, -20, 20),
    crowding_lower_mm: toMm(b.crowding_lower_mm, -20, 20),
    midline_deviation_mm: toMm(b.midline_deviation_mm, -15, 15),
    crossbite: bool(b.crossbite),
    open_bite: bool(b.open_bite),
    problem_list: clip(b.problem_list, 2000),
    treatment_objectives: clip(b.treatment_objectives, 2000),
    extractions: clip(b.extractions, 500),
    appliance_notes: clip(b.appliance_notes, 1000),
    planned_months: toInt(b.planned_months, 1, 60),
    total_fee: toMoney(b.total_fee),
  };
};

const finaliseProblem = (d) => {
  if (!d.treatment_type) return 'Choose a treatment type before finalising';
  if (!d.angle_class_right && !d.angle_class_left && !d.skeletal_pattern) return 'Record the malocclusion (Angle class or skeletal pattern) before finalising';
  if (!d.problem_list) return 'Write the problem list before finalising';
  if (!d.treatment_objectives) return 'Write the treatment objectives before finalising';
  if (!d.planned_months) return 'Enter the planned treatment duration before finalising';
  return null;
};

/* ---------------- cases ---------------- */

/* GET /ortho/patient/:patientId -> cases newest first (with visit_count / last_visit_date) */
const getCases = (req, res, next) => {
  findCasesByPatient(req.params.patientId, (err, cases) => {
    if (err) return next(err);
    res.json(cases);
  });
};

/* GET /ortho/cases/:id -> one case */
const getCase = (req, res, next) => {
  findCaseById(req.params.id, (err, c) => {
    if (err) return next(err);
    if (!c) return res.status(404).json({ message: 'Orthodontic case not found' });
    res.json(c);
  });
};

/* POST /ortho/patient/:patientId   body: { ...baseline, finalise?: true } */
const create = (req, res, next) => {
  const data = sanitizeBaseline(req.body);
  const wantsFinalise = isFinaliseRequested(req.body);
  if (!data.treatment_type) return res.status(400).json({ message: 'Choose a treatment type' });
  if (wantsFinalise) {
    const problem = finaliseProblem(data);
    if (problem) return res.status(400).json({ message: problem });
  }

  createCase({
    ...data,
    patient_id: req.params.patientId,
    dentist_id: req.user.id,
    baseline_status: wantsFinalise ? 'final' : 'draft',
  }, (err, c) => {
    // 23505 = the one-open-case-per-patient unique index
    if (err && err.code === '23505') {
      return res.status(409).json({ message: 'This patient already has an open orthodontic case. Complete or discontinue it first.' });
    }
    if (err) return next(err);
    res.status(201).json(c);
  });
};

// Loads the case and enforces: exists, written by this dentist, baseline still a draft.
const loadOwnDraft = (req, res, next, done) => {
  findCaseById(req.params.id, (err, c) => {
    if (err) return next(err);
    if (!c) return res.status(404).json({ message: 'Orthodontic case not found' });
    if (String(c.dentist_id) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only the dentist who started this case can change its baseline' });
    }
    if (c.baseline_status !== 'draft') {
      return res.status(409).json({ message: 'The baseline is finalised and can no longer be edited.' });
    }
    done(c);
  });
};

/* PUT /ortho/cases/:id   body: { ...baseline, finalise?: true } (draft baseline, author only) */
const update = (req, res, next) => {
  loadOwnDraft(req, res, next, (c) => {
    const data = sanitizeBaseline(req.body);
    const wantsFinalise = isFinaliseRequested(req.body);
    if (!data.treatment_type) return res.status(400).json({ message: 'Choose a treatment type' });
    if (wantsFinalise) {
      const problem = finaliseProblem(data);
      if (problem) return res.status(400).json({ message: problem });
    }

    updateBaselineDraft(c.id, data, (err, updated) => {
      if (err) return next(err);
      if (!updated) return res.status(409).json({ message: 'The baseline was finalised and can no longer be edited' });
      if (!wantsFinalise) return res.json(updated);
      finaliseBaseline(c.id, (fErr, finalised) => {
        if (fErr) return next(fErr);
        if (!finalised) return res.status(409).json({ message: 'The baseline was already finalised' });
        res.json(finalised);
      });
    });
  });
};

/* POST /ortho/cases/:id/finalise */
const finalise = (req, res, next) => {
  loadOwnDraft(req, res, next, (c) => {
    const problem = finaliseProblem(c);
    if (problem) return res.status(400).json({ message: `${problem}. Open the draft, complete it, then finalise.` });
    finaliseBaseline(c.id, (err, finalised) => {
      if (err) return next(err);
      if (!finalised) return res.status(409).json({ message: 'The baseline was already finalised' });
      res.json(finalised);
    });
  });
};

/* PATCH /ortho/cases/:id/progress
   body: { status?, start_date?, debond_date?, retainer_type?, retention_notes?, discontinue_reason? }
   Any dentist can update progress (a specialist may take over a case). */
const patchProgress = (req, res, next) => {
  findCaseById(req.params.id, (err, c) => {
    if (err) return next(err);
    if (!c) return res.status(404).json({ message: 'Orthodontic case not found' });
    if (!OPEN_STATUSES.includes(c.status)) {
      return res.status(409).json({ message: `This case is ${c.status} and can no longer be changed.` });
    }

    const b = req.body || {};
    const next_ = {
      status: c.status,
      start_date: c.start_date,
      debond_date: c.debond_date,
      retainer_type: c.retainer_type,
      retention_notes: c.retention_notes,
      discontinue_reason: c.discontinue_reason,
    };

    if ('status' in b && b.status !== c.status) {
      if (!STATUSES.includes(b.status) || !TRANSITIONS[c.status].includes(b.status)) {
        return res.status(400).json({ message: `A ${c.status} case cannot move to "${b.status}"` });
      }
      if (c.baseline_status !== 'final' && b.status !== 'discontinued') {
        return res.status(400).json({ message: 'Finalise the baseline before starting treatment' });
      }
      next_.status = b.status;
      if (b.status === 'active' && !next_.start_date) next_.start_date = toDate(b.start_date) || todayStr();
      if (b.status === 'retention' && !next_.debond_date) next_.debond_date = toDate(b.debond_date) || todayStr();
      if (b.status === 'discontinued') {
        next_.discontinue_reason = clip(b.discontinue_reason, 500);
        if (!next_.discontinue_reason) return res.status(400).json({ message: 'Give a reason for discontinuing treatment' });
      }
    }
    if ('start_date' in b) { const d = toDate(b.start_date); if (d) next_.start_date = d; }
    if ('debond_date' in b) { const d = toDate(b.debond_date); if (d) next_.debond_date = d; }
    if ('retainer_type' in b) next_.retainer_type = clip(b.retainer_type, 200);
    if ('retention_notes' in b) next_.retention_notes = clip(b.retention_notes, 1000);

    updateProgress(c.id, next_, (uErr, updated) => {
      if (uErr) return next(uErr);
      if (!updated) return res.status(404).json({ message: 'Orthodontic case not found' });
      res.json(updated);
    });
  });
};

/* DELETE /ortho/cases/:id  (draft baseline with no visits, author only) */
const remove = (req, res, next) => {
  loadOwnDraft(req, res, next, (c) => {
    deleteDraftCase(c.id, (err, row) => {
      if (err) return next(err);
      if (!row) return res.status(409).json({ message: 'This case has visits or a finalised baseline and cannot be deleted' });
      res.json({ message: 'Draft case deleted' });
    });
  });
};

/* ---------------- visits ---------------- */

const sanitizeVisit = (body) => {
  const b = body || {};
  let visit_date = todayStr();
  const d = toDate(b.visit_date);
  if (d && new Date(`${d}T00:00:00Z`).getTime() <= Date.now() + 86400000) visit_date = d;
  return {
    appointment_id: typeof b.appointment_id === 'string' && UUID.test(b.appointment_id) ? b.appointment_id : null,
    visit_date,
    visit_type: oneOf(b.visit_type, VISIT_TYPES),
    upper_wire: clip(b.upper_wire, 100),
    lower_wire: clip(b.lower_wire, 100),
    elastics: clip(b.elastics, 200),
    aligner_tray: toInt(b.aligner_tray, 0, 200),
    ipr_done: bool(b.ipr_done),
    procedures: clip(b.procedures, 1500),
    oral_hygiene: oneOf(b.oral_hygiene, LEVELS),
    compliance: oneOf(b.compliance, LEVELS),
    progress: oneOf(b.progress, PROGRESS),
    notes: clip(b.notes, 2000),
    next_visit_weeks: toInt(b.next_visit_weeks, 1, 52),
  };
};

/* GET /ortho/cases/:id/visits */
const getVisits = (req, res, next) => {
  findVisitsByCase(req.params.id, (err, visits) => {
    if (err) return next(err);
    res.json(visits);
  });
};

/* POST /ortho/cases/:id/visits */
const addVisit = (req, res, next) => {
  findCaseById(req.params.id, (err, c) => {
    if (err) return next(err);
    if (!c) return res.status(404).json({ message: 'Orthodontic case not found' });
    if (!OPEN_STATUSES.includes(c.status)) {
      return res.status(409).json({ message: `This case is ${c.status}; visits can no longer be added.` });
    }
    const data = sanitizeVisit(req.body);
    if (!data.visit_type) return res.status(400).json({ message: 'Choose a visit type' });

    createVisit({ ...data, case_id: c.id, patient_id: c.patient_id, dentist_id: req.user.id }, (cErr, visit) => {
      if (cErr) return next(cErr);
      res.status(201).json(visit);
    });
  });
};

// Loads the visit and enforces: exists, written by this dentist, still inside the correction window.
const loadOwnRecentVisit = (req, res, next, done) => {
  findVisitById(req.params.visitId, (err, v) => {
    if (err) return next(err);
    if (!v) return res.status(404).json({ message: 'Visit not found' });
    if (String(v.dentist_id) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only the dentist who recorded this visit can change it' });
    }
    if (Date.now() - new Date(v.created_at).getTime() > VISIT_EDIT_WINDOW_MS) {
      return res.status(409).json({ message: 'Visit records can only be corrected within 24 hours of being saved.' });
    }
    done(v);
  });
};

/* PUT /ortho/visits/:visitId */
const editVisit = (req, res, next) => {
  loadOwnRecentVisit(req, res, next, (v) => {
    const data = sanitizeVisit(req.body);
    if (!data.visit_type) return res.status(400).json({ message: 'Choose a visit type' });
    updateVisit(v.id, data, (err, updated) => {
      if (err) return next(err);
      if (!updated) return res.status(404).json({ message: 'Visit not found' });
      res.json(updated);
    });
  });
};

/* DELETE /ortho/visits/:visitId */
const removeVisit = (req, res, next) => {
  loadOwnRecentVisit(req, res, next, (v) => {
    deleteVisit(v.id, (err, row) => {
      if (err) return next(err);
      if (!row) return res.status(404).json({ message: 'Visit not found' });
      res.json({ message: 'Visit deleted' });
    });
  });
};

/* ---------------- patient portal ---------------- */

/* GET /ortho/me -> the logged-in patient's own finalised cases + visit dates (no clinical notes) */
const getMine = (req, res, next) => {
  findPatientByUserId(req.user.id, (err, patient) => {
    if (err) return next(err);
    if (!patient) return res.status(404).json({ message: 'Patient record not found' });
    findPortalSummary(patient.id, (sErr, summary) => {
      if (sErr) return next(sErr);
      res.json(summary);
    });
  });
};

module.exports = {
  getCases, getCase, create, update, finalise, patchProgress, remove,
  getVisits, addVisit, editVisit, removeVisit, getMine,
};