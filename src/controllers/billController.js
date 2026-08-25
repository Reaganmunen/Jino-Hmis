const { createBill, findBillById, findBillsByPatient, findBillsByStatus, voidBill } = require('../models/billModel');

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

module.exports = { addBill, getBill, getPatientBills, getBillsByStatus, cancelBill };