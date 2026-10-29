const {
  createPlan, findPlanById, findActivePlanByBill, findPlansByPatient,
  findActivePlansForCollections, cancelPlan,
} = require('../models/paymentPlanModel');
const { findBillById } = require('../models/billModel');
const { findPatientById } = require('../models/patientModel');
const { sendPdf } = require('../services/pdfService');
const { paymentPlanHtml } = require('../services/pdfTemplates/paymentPlanTemplate');
const svc = require('../services/paymentPlanService');

const STAFF = ['admin', 'dentist', 'receptionist'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const canAccess = (user, patientId) => {
  if (STAFF.includes(user.role)) return true;
  return user.role === 'patient' && user.patient_id && String(user.patient_id) === String(patientId);
};

// Turns a DB plan row (with instalments) into what the browser gets.
const toView = (row, today = svc.todayNairobi()) => {
  const bill = { total_amount: row.bill_total, amount_paid: row.bill_paid, status: row.bill_status };
  const summary = svc.summarise({ plan: row, instalments: row.instalments, bill, today });
  return {
    id: row.id,
    bill_id: row.bill_id,
    patient_id: row.patient_id,
    frequency: row.frequency,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    paid_before: Number(row.paid_before),
    bill: { total_amount: Number(row.bill_total), amount_paid: Number(row.bill_paid || 0), status: row.bill_status },
    ...summary,
  };
};

const cleanNotes = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 500) : null;
};

// POST /payment-plans   { bill_id, deposit, instalments, frequency, first_due_date, notes }
// preview:true returns the schedule without saving, so the form can show it live.
const create = (req, res, next) => {
  const b = req.body || {};
  if (!UUID_RE.test(String(b.bill_id || ''))) return res.status(400).json({ message: 'A valid bill is required' });

  findBillById(b.bill_id, (err, bill) => {
    if (err) return next(err);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!['unpaid', 'partially_paid'].includes(bill.status)) {
      return res.status(400).json({ message: 'A payment plan can only be set up on a bill that still has a balance' });
    }

    findActivePlanByBill(bill.id, (planErr, existing) => {
      if (planErr) return next(planErr);
      if (existing) return res.status(409).json({ message: 'This bill already has an active payment plan. Cancel it first to make a new one.' });

      const paid = Number(bill.amount_paid || 0);
      const balance = svc.fromCents(svc.toCents(bill.total_amount) - svc.toCents(paid));
      const result = svc.buildSchedule({
        balance,
        deposit: b.deposit === undefined || b.deposit === '' ? 0 : Number(b.deposit),
        count: Number(b.instalments),
        frequency: b.frequency,
        firstDueDate: b.first_due_date,
      });
      if (result.error) return res.status(400).json({ message: result.error });

      if (b.preview === true) {
        const fake = { paid_before: paid, status: 'active' };
        const summary = svc.summarise({
          plan: fake,
          instalments: result.instalments,
          bill: { total_amount: bill.total_amount, amount_paid: paid, status: bill.status },
        });
        return res.json({ balance, ...summary });
      }

      createPlan({
        bill_id: bill.id,
        patient_id: bill.patient_id,
        created_by: req.user.id,
        frequency: b.frequency,
        paid_before: paid,
        notes: cleanNotes(b.notes),
        instalments: result.instalments,
      }, (createErr, planId) => {
        if (createErr) return next(createErr);
        findPlanById(planId, (fErr, row) => {
          if (fErr) return next(fErr);
          res.status(201).json(toView(row));
        });
      });
    });
  });
};

// GET /payment-plans/bill/:billId  ->  { plan: <view> | null }
const getByBill = (req, res, next) => {
  if (!UUID_RE.test(req.params.billId)) return res.status(400).json({ message: 'Invalid bill id' });
  findBillById(req.params.billId, (err, bill) => {
    if (err) return next(err);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!canAccess(req.user, bill.patient_id)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
    findActivePlanByBill(bill.id, (pErr, row) => {
      if (pErr) return next(pErr);
      res.json({ plan: row ? toView(row) : null });
    });
  });
};

// GET /payment-plans/patient/:patientId
const getByPatient = (req, res, next) => {
  if (!UUID_RE.test(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient id' });
  findPlansByPatient(req.params.patientId, (err, rows) => {
    if (err) return next(err);
    const today = svc.todayNairobi();
    res.json(rows.map((r) => toView(r, today)));
  });
};

// GET /payment-plans/collections — instalments past their due date, with ageing buckets.
const getCollections = (req, res, next) => {
  findActivePlansForCollections((err, rows) => {
    if (err) return next(err);
    const today = svc.todayNairobi();
    const accounts = [];
    const buckets = {};
    svc.AGEING_BUCKETS.forEach((k) => { buckets[k.key] = { count: 0, amount: 0 }; });
    let dueSoonAmount = 0;

    rows.forEach((row) => {
      const v = toView(row, today);
      const overdue = v.instalments.filter((i) => i.status === 'overdue');
      v.instalments.filter((i) => i.status !== 'paid' && i.status !== 'overdue'
        && svc.daysBetween(today, i.due_date) <= 7).forEach((i) => { dueSoonAmount += i.outstanding; });
      if (!overdue.length) return;

      const oldest = Math.max(...overdue.map((i) => i.days_overdue));
      const bucket = svc.bucketFor(oldest);
      buckets[bucket].count += 1;
      buckets[bucket].amount += v.overdue_amount;
      accounts.push({
        plan_id: v.id,
        bill_id: v.bill_id,
        patient_id: v.patient_id,
        patient_name: `${row.patient_first_name} ${row.patient_last_name}`,
        patient_phone: row.patient_phone || null,
        overdue_amount: v.overdue_amount,
        overdue_instalments: overdue.length,
        oldest_days_overdue: oldest,
        bucket,
        next_due: v.next_due,
      });
    });

    accounts.sort((a, b) => b.oldest_days_overdue - a.oldest_days_overdue);
    Object.values(buckets).forEach((b) => { b.amount = svc.fromCents(svc.toCents(b.amount)); });
    res.json({
      as_of: today,
      total_overdue: svc.fromCents(accounts.reduce((s, a) => s + svc.toCents(a.overdue_amount), 0)),
      due_within_7_days: svc.fromCents(svc.toCents(dueSoonAmount)),
      buckets,
      accounts,
    });
  });
};

const cancel = (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid plan id' });
  cancelPlan(req.params.id, req.user.id, (err, count) => {
    if (err) return next(err);
    if (!count) return res.status(404).json({ message: 'No active payment plan found' });
    res.json({ message: 'Payment plan cancelled. The bill balance is unchanged.' });
  });
};

const downloadPdf = (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ message: 'Invalid plan id' });
  findPlanById(req.params.id, (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ message: 'Payment plan not found' });
    if (!canAccess(req.user, row.patient_id)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
    findPatientById(row.patient_id, (pErr, patient) => {
      if (pErr) return next(pErr);
      if (!patient) return res.status(404).json({ message: 'Patient not found' });
      const html = paymentPlanHtml({ view: toView(row), patient }, process.env.CLINIC_NAME, process.env.CLINIC_LOGO_URL);
      sendPdf(res, next, { html, filename: `payment-plan-${String(row.id).slice(0, 8)}.pdf` });
    });
  });
};

module.exports = { create, getByBill, getByPatient, getCollections, cancel, downloadPdf };
