const { createBill, findBillById, findBillsByPatient, findBillsByStatus, voidBill } = require('../models/billModel');

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
    res.json(bill);
  });
};

const getPatientBills = (req, res, next) => {
  findBillsByPatient(req.params.patientId, (err, bills) => {
    if (err) return next(err);
    res.json(bills);
  });
};

const getBillsByStatus = (req, res, next) => {
  findBillsByStatus(req.params.status, (err, bills) => {
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