const { recordPayment, findPaymentsByBill } = require('../models/paymentModel');

// For cash, card, bank_transfer, insurance payouts recorded manually by staff.
// M-Pesa payments go through mpesaController — the Daraja callback records the
// Payment row itself once Safaricom confirms success.
const addPayment = (req, res, next) => {
  const data = { ...req.body, received_by: req.user.id };
  recordPayment(data, (err, payment) => {
    if (err) return next(err);
    res.status(201).json(payment);
  });
};

const getPaymentsByBill = (req, res, next) => {
  findPaymentsByBill(req.params.billId, (err, payments) => {
    if (err) return next(err);
    res.json(payments);
  });
};

module.exports = { addPayment, getPaymentsByBill };