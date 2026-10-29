const { findLatestByPatient, findLatestByPlan, record, CLOSED_STATUSES } = require('../models/planAcceptanceModel');
const { findTreatmentPlanById } = require('../models/treatmentPlanModel');
const { findItemsByPlan } = require('../models/treatmentPlanItemModel');
const { findPatientById } = require('../models/patientModel');
const { findUserById } = require('../models/userModel');
const { sendPdf } = require('../services/pdfService');
const { quoteHtml } = require('../services/pdfTemplates/quoteTemplate');

const STAFF = ['admin', 'dentist', 'receptionist'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATIONSHIPS = ['self', 'guardian', 'other'];
const MAX_SIGNATURE_BYTES = 60000; // keeps the JSON body under the app's 100 kb limit
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const canAccess = (user, patientId) => {
  if (STAFF.includes(user.role)) return true;
  return user.role === 'patient' && user.patient_id && String(user.patient_id) === String(patientId);
};

// Items the patient is being asked to agree to. Skipped ones are not part of the estimate.
const liveItems = (items) => items
  .filter((i) => i.status !== 'skipped')
  .map((i) => ({
    procedure_name: i.procedure_name,
    tooth_number: i.tooth_number || null,
    estimated_cost: Number(i.estimated_cost || 0),
    sequence_order: i.sequence_order,
  }));

const sumCents = (items) => items.reduce((s, i) => s + Math.round(i.estimated_cost * 100), 0);

// Returns the cleaned data URL, or null if it is not a real, small PNG.
const cleanSignature = (value) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200 || buf.length > MAX_SIGNATURE_BYTES) return null;
  if (!buf.slice(0, 8).equals(PNG_MAGIC)) return null;
  return `data:image/png;base64,${m[1]}`;
};

const loadPlan = (req, res, next, cb) => {
  if (!UUID_RE.test(req.params.planId)) return res.status(400).json({ message: 'Invalid plan id' });
  findTreatmentPlanById(req.params.planId, (err, plan) => {
    if (err) return next(err);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    if (!canAccess(req.user, plan.patient_id)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
    cb(plan);
  });
};

// GET /plan-acceptance/patient/:patientId  ->  newest record per plan (no signature image)
const getByPatient = (req, res, next) => {
  if (!UUID_RE.test(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
  findLatestByPatient(req.params.patientId, (err, rows) => {
    if (err) return next(err);
    res.json(rows);
  });
};

// GET /plan-acceptance/:planId  ->  { acceptance: {...} | null, can_accept: boolean }
const getForPlan = (req, res, next) => loadPlan(req, res, next, (plan) => {
  findLatestByPlan(plan.id, (err, acceptance) => {
    if (err) return next(err);
    findItemsByPlan(plan.id, (itemsErr, items) => {
      if (itemsErr) return next(itemsErr);
      const live = liveItems(items);
      res.json({
        acceptance,
        can_accept: !CLOSED_STATUSES.includes(plan.status) && live.length > 0,
        items: live,
        total: sumCents(live) / 100,
      });
    });
  });
});

// POST /plan-acceptance/:planId
// { decision: 'accepted'|'declined', signer_name, signer_relationship, signature, confirm, decline_reason }
// The server recomputes the items and total itself, so the client can't change what was agreed to.
const submit = (req, res, next) => loadPlan(req, res, next, (plan) => {
  const b = req.body || {};
  const decision = b.decision;
  if (!['accepted', 'declined'].includes(decision)) {
    return res.status(400).json({ message: 'decision must be accepted or declined' });
  }
  if (CLOSED_STATUSES.includes(plan.status)) {
    return res.status(409).json({ message: `This plan is already ${String(plan.status).replace('_', ' ')}` });
  }

  const relationship = RELATIONSHIPS.includes(b.signer_relationship) ? b.signer_relationship : 'self';
  const signerName = String(b.signer_name || '').trim().slice(0, 120);
  let signature = null;

  if (decision === 'accepted') {
    if (signerName.length < 2) return res.status(400).json({ message: 'Please type the full name of the person signing' });
    if (b.confirm !== true) return res.status(400).json({ message: 'Please tick the box to confirm you agree' });
    signature = cleanSignature(b.signature);
    if (!signature) return res.status(400).json({ message: 'Please sign in the box before accepting' });
  }

  findItemsByPlan(plan.id, (itemsErr, items) => {
    if (itemsErr) return next(itemsErr);
    const live = liveItems(items);
    if (!live.length) return res.status(400).json({ message: 'This plan has no procedures yet, so there is nothing to accept' });

    record({
      plan_id: plan.id,
      patient_id: plan.patient_id,
      decision,
      signer_name: signerName || null,
      signer_relationship: relationship,
      recorded_by: req.user.id,
      recorded_via: req.user.role === 'patient' ? 'patient_portal' : 'in_clinic',
      signature_png: signature,
      total: sumCents(live) / 100,
      items: live,
      decline_reason: decision === 'declined' && b.decline_reason ? String(b.decline_reason).trim().slice(0, 500) : null,
      ip: req.ip,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    }, (err, saved) => {
      if (err) return next(err);
      if (!saved) return res.status(409).json({ message: 'This plan was just accepted by someone else' });
      res.status(201).json({ id: saved.id, decision, message: decision === 'accepted' ? 'Treatment plan accepted' : 'Your decision has been recorded' });
    });
  });
});

// GET /plan-acceptance/:planId/quote/pdf
const downloadQuotePdf = (req, res, next) => loadPlan(req, res, next, (plan) => {
  findItemsByPlan(plan.id, (itemsErr, items) => {
    if (itemsErr) return next(itemsErr);
    findPatientById(plan.patient_id, (pErr, patient) => {
      if (pErr) return next(pErr);
      if (!patient) return res.status(404).json({ message: 'Patient not found' });
      findLatestByPlan(plan.id, (aErr, acceptance) => {
        if (aErr) return next(aErr);
        findUserById(plan.dentist_id, (dErr, dentist) => {
          if (dErr) return next(dErr);
          const html = quoteHtml(
            { plan, items: liveItems(items), patient, dentist, acceptance },
            process.env.CLINIC_NAME,
            process.env.CLINIC_LOGO_URL,
          );
          sendPdf(res, next, { html, filename: `treatment-quote-${String(plan.id).slice(0, 8)}.pdf` });
        });
      });
    });
  });
});

module.exports = { getByPatient, getForPlan, submit, downloadQuotePdf };
