const { addBillItem, findItemsByBill, removeBillItem } = require('../models/billItemModel');
const { findBillById } = require('../models/billModel');

const STAFF = ['admin', 'dentist', 'receptionist'];

const canAccessBill = (user, bill) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === bill.patient_id;
  return false;
};

// Bill.total_amount recalculates automatically via DB trigger on write.
const addItem = (req, res, next) => {
  addBillItem(req.body, (err, item) => {
    if (err) return next(err);
    res.status(201).json(item);
  });
};

// BillItem carries no patient_id of its own — ownership is resolved through
// the parent Bill.
const getItemsByBill = (req, res, next) => {
  findBillById(req.params.billId, (billErr, bill) => {
    if (billErr) return next(billErr);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }

    findItemsByBill(req.params.billId, (err, items) => {
      if (err) return next(err);
      res.json(items);
    });
  });
};

const removeItem = (req, res, next) => {
  removeBillItem(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'Bill item not found' });
    res.json({ message: 'Bill item removed' });
  });
};

module.exports = { addItem, getItemsByBill, removeItem };