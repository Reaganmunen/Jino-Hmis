const {
  createBill, findBillById, findBillWithPatientDetails, findBillsByPatient, findBillsByStatus, voidBill,
} = require('../models/billModel');
const { findItemsByBill } = require('../models/billItemModel');
const { findPatientById } = require('../models/patientModel');
// ASSUMPTION: your frontend calls GET /payments/bill/:billId, so a
// paymentModel.js with this shape must already exist — I don't have that
// file. If the real export name differs, adjust this import.
const { findPaymentsByBill } = require('../models/paymentModel');
const { sendPdf } = require('../services/pdfService');
const { billInvoiceHtml, billStatementHtml } = require('../services/pdfTemplates/billTemplate');

const STAFF = ['admin', 'dentist', 'receptionist'];

const canAccessBill = (user, bill) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === bill.patient_id;
  return false;
};

const addBill = (req, res, next) => {
  const data = { ...req.body, created_by: req.user.id };
  createBill(data, (err, bill) => {
    if (err) return next(err);
    res.status(201).json(bill);
  });
};

const getBill = (req, res, next) => {
  findBillById(req.params.id, (err, bill) => {
    if (err) return next(err);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
    res.json(bill);
  });
};

const getPatientBills = (req, res, next) => {
  findBillsByPatient(req.params.patientId, (err, bills) => {
    if (err) return next(err);
    res.json(bills);
  });
};

const VALID_BILL_STATUSES = ['draft', 'unpaid', 'partially_paid', 'paid', 'void'];
// Accept a couple of common shorthand spellings from the frontend instead of
// rejecting them, since the DB enum itself only knows the canonical labels.
const STATUS_ALIASES = { partial: 'partially_paid', unpaid_partial: 'partially_paid' };

const getBillsByStatus = (req, res, next) => {
  const requested = req.params.status;
  const status = STATUS_ALIASES[requested] || requested;

  if (!VALID_BILL_STATUSES.includes(status)) {
    return res.status(400).json({
      message: `Invalid status "${requested}". Must be one of: ${VALID_BILL_STATUSES.join(', ')}`,
    });
  }

  findBillsByStatus(status, (err, bills) => {
    if (err) return next(err);
    res.json(bills);
  });
};

const cancelBill = (req, res, next) => {
  voidBill(req.params.id, (err, bill) => {
    if (err) return next(err);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    res.json(bill);
  });
};

// GET /bills/:id/pdf — a single bill's full invoice (line items + payments).
const downloadBillPdf = (req, res, next) => {
  findBillWithPatientDetails(req.params.id, (err, bill) => {
    if (err) return next(err);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }

    findItemsByBill(bill.id, (itemsErr, items) => {
      if (itemsErr) return next(itemsErr);
      findPaymentsByBill(bill.id, (payErr, payments) => {
        if (payErr) return next(payErr);

        const html = billInvoiceHtml(
          { bill, items, payments },
          process.env.CLINIC_NAME,
          process.env.CLINIC_LOGO_URL,
        );
        sendPdf(res, next, { html, filename: `invoice-${String(bill.id).slice(0, 8)}.pdf` });
      });
    });
  });
};

// GET /bills/patient/:patientId/statement/pdf — every bill for the patient, one document.
const downloadBillStatementPdf = (req, res, next) => {
  const { patientId } = req.params;

  // Ownership check mirrors the pattern used by allowSelfOrStaff-guarded
  // routes elsewhere (e.g. GET /bills/patient/:patientId) — patients can
  // only pull their own statement, staff can pull any patient's.
  const STAFF = ['admin', 'dentist', 'receptionist'];
  const isSelf = req.user.role === 'patient' && String(req.user.patient_id) === String(patientId);
  if (!STAFF.includes(req.user.role) && !isSelf) {
    return res.status(403).json({ message: 'You do not have permission to access this resource' });
  }

  findPatientById(patientId, (patErr, patient) => {
    if (patErr) return next(patErr);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    findBillsByPatient(patientId, (billsErr, bills) => {
      if (billsErr) return next(billsErr);

      const html = billStatementHtml(
        { patient, bills },
        process.env.CLINIC_NAME,
        process.env.CLINIC_LOGO_URL,
      );
      sendPdf(res, next, { html, filename: `statement-${patient.last_name}.pdf` });
    });
  });
};

module.exports = {
  addBill, getBill, getPatientBills, getBillsByStatus, cancelBill,
  downloadBillPdf, downloadBillStatementPdf,
};