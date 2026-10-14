const {
  findChartsByPatient, findChartById, createChart, updateDraft, finaliseChart, deleteDraft,
} = require('../models/perioChartModel');
// Same file the browser uses for the live totals, so the stored summary always matches.
const PerioSummary = require('../../public/js/perioSummary.js');

const SITES = PerioSummary.SITES;
const TEETH = [
  '18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38',
];
const DIAGNOSES = ['periodontal_health', 'gingivitis', 'periodontitis'];
const STAGES = ['I', 'II', 'III', 'IV'];
const GRADES = ['A', 'B', 'C'];
const EXTENTS = ['localized', 'generalized', 'molar_incisor'];

const clip = (value, max) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};

// Whole numbers only, inside [min, max]; anything else is dropped (null).
const toInt = (v, min, max) => {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
};

// Keeps only real permanent teeth (FDI 11-48) and valid values. Empty teeth are dropped.
const sanitizeTeeth = (input) => {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  TEETH.forEach((fdi) => {
    const t = input[fdi];
    if (!t || typeof t !== 'object') return;

    if (t.missing === true) { out[fdi] = { missing: true }; return; }

    const pd = {}; const rec = {}; const bop = {}; const plq = {};
    SITES.forEach((s) => {
      const p = toInt(t.pd && t.pd[s], 0, 15);
      if (p !== null) pd[s] = p;
      const r = toInt(t.rec && t.rec[s], -9, 15);
      if (r !== null) rec[s] = r;
      if (t.bop && t.bop[s] === true) bop[s] = true;
      if (t.plq && t.plq[s] === true) plq[s] = true;
    });

    const entry = {};
    if (Object.keys(pd).length) entry.pd = pd;
    if (Object.keys(rec).length) entry.rec = rec;
    if (Object.keys(bop).length) entry.bop = bop;
    if (Object.keys(plq).length) entry.plq = plq;
    const mob = toInt(t.mob, 0, 3);
    if (mob !== null) entry.mob = mob;
    const furc = toInt(t.furc, 0, 3);
    if (furc !== null) entry.furc = furc;

    if (Object.keys(entry).length) out[fdi] = entry;
  });
  return out;
};

const sanitize = (body) => {
  const b = body || {};

  // exam_date: YYYY-MM-DD, not in the future; default today.
  let exam_date = new Date().toISOString().slice(0, 10);
  if (typeof b.exam_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.exam_date)) {
    const d = new Date(`${b.exam_date}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 86400000) exam_date = b.exam_date;
  }

  const teeth = sanitizeTeeth(b.teeth);
  const diagnosis = DIAGNOSES.includes(b.diagnosis) ? b.diagnosis : null;
  const periodontitis = diagnosis === 'periodontitis';

  return {
    exam_date,
    teeth,
    summary: PerioSummary.compute(teeth),
    diagnosis,
    // Stage / grade / extent only make sense for periodontitis.
    stage: periodontitis && STAGES.includes(b.stage) ? b.stage : null,
    grade: periodontitis && GRADES.includes(b.grade) ? b.grade : null,
    extent: periodontitis && EXTENTS.includes(b.extent) ? b.extent : null,
    recall_interval_months: toInt(b.recall_interval_months, 1, 12),
    treatment_notes: clip(b.treatment_notes, 2000),
  };
};

const isFinaliseRequested = (body) => !!body && (body.finalise === true || body.finalise === 'true');

const hasContent = (d) => Object.keys(d.teeth).length > 0 || !!d.diagnosis;

// A chart can be finalised once something was measured and a diagnosis chosen.
const finaliseProblem = (d) => {
  if (!d.summary || !d.summary.sites_measured) return 'Record at least one probing depth before finalising';
  if (!d.diagnosis) return 'Choose a periodontal diagnosis before finalising';
  return null;
};

/* GET /perio-charts/patient/:patientId -> charts newest first, WITHOUT the teeth data */
const getByPatient = (req, res, next) => {
  findChartsByPatient(req.params.patientId, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

/* GET /perio-charts/:id -> one full chart, including teeth */
const getOne = (req, res, next) => {
  findChartById(req.params.id, (err, chart) => {
    if (err) return next(err);
    if (!chart) return res.status(404).json({ message: 'Chart not found' });
    res.json(chart);
  });
};

/* POST /perio-charts/patient/:patientId   body: { ...fields, finalise: true|false } */
const create = (req, res, next) => {
  const data = sanitize(req.body);
  const wantsFinalise = isFinaliseRequested(req.body);

  if (!hasContent(data)) {
    return res.status(400).json({ message: 'Record at least one measurement or a missing tooth before saving' });
  }
  if (wantsFinalise) {
    const problem = finaliseProblem(data);
    if (problem) return res.status(400).json({ message: problem });
  }

  createChart({
    ...data,
    patient_id: req.params.patientId,
    dentist_id: req.user.id,
    status: wantsFinalise ? 'final' : 'draft',
  }, (err, chart) => {
    if (err) return next(err);
    res.status(201).json(chart);
  });
};

// Loads the chart and enforces: exists, written by this dentist, still a draft.
const loadOwnDraft = (req, res, next, done) => {
  findChartById(req.params.id, (err, chart) => {
    if (err) return next(err);
    if (!chart) return res.status(404).json({ message: 'Chart not found' });
    if (String(chart.dentist_id) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only the dentist who started this chart can change it' });
    }
    if (chart.status !== 'draft') {
      return res.status(409).json({ message: 'This chart is finalised and can no longer be edited. Start a new chart from it instead.' });
    }
    done(chart);
  });
};

/* PUT /perio-charts/:id   body: { ...fields, finalise?: true } (drafts only, author only) */
const update = (req, res, next) => {
  loadOwnDraft(req, res, next, (chart) => {
    const data = sanitize(req.body);
    const wantsFinalise = isFinaliseRequested(req.body);

    if (!hasContent(data)) {
      return res.status(400).json({ message: 'Record at least one measurement or a missing tooth before saving' });
    }
    if (wantsFinalise) {
      const problem = finaliseProblem(data);
      if (problem) return res.status(400).json({ message: problem });
    }

    updateDraft(chart.id, data, (err, updated) => {
      if (err) return next(err);
      if (!updated) return res.status(409).json({ message: 'This chart was finalised and can no longer be edited' });
      if (!wantsFinalise) return res.json(updated);

      finaliseChart(chart.id, (fErr, finalised) => {
        if (fErr) return next(fErr);
        if (!finalised) return res.status(409).json({ message: 'This chart was already finalised' });
        res.json(finalised);
      });
    });
  });
};

/* POST /perio-charts/:id/finalise  (finalises a saved draft as it is) */
const finalise = (req, res, next) => {
  loadOwnDraft(req, res, next, (chart) => {
    const problem = finaliseProblem({ summary: chart.summary, diagnosis: chart.diagnosis });
    if (problem) return res.status(400).json({ message: `${problem}. Open the draft, complete it, then finalise.` });

    finaliseChart(chart.id, (err, finalised) => {
      if (err) return next(err);
      if (!finalised) return res.status(409).json({ message: 'This chart was already finalised' });
      res.json(finalised);
    });
  });
};

/* DELETE /perio-charts/:id  (drafts only, author only) */
const remove = (req, res, next) => {
  loadOwnDraft(req, res, next, (chart) => {
    deleteDraft(chart.id, (err, row) => {
      if (err) return next(err);
      if (!row) return res.status(409).json({ message: 'This chart was finalised and cannot be deleted' });
      res.json({ message: 'Draft deleted' });
    });
  });
};

module.exports = { getByPatient, getOne, create, update, finalise, remove };