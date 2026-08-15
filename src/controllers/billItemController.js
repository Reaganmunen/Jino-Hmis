const { addBillItem, findItemsByBill, removeBillItem } = require('../models/billItemModel');

// Bill.total_amount recalculates automatically via DB trigger on write.
const addItem = (req, res, next) => {
  addBillItem(req.body, (err, item) => {
    if (err) return next(err);
    res.status(201).json(item);
  });
};

const getItemsByBill = (req, res, next) => {
  findItemsByBill(req.params.billId, (err, items) => {
    if (err) return next(err);
    res.json(items);
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