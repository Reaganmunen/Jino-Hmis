const { addTreatmentPlanItem, findItemsByPlan, updateItemStatus } = require('../models/treatmentPlanItemModel');

const addItem = (req, res, next) => {
  addTreatmentPlanItem(req.body, (err, item) => {
    if (err) return next(err);
    res.status(201).json(item);
  });
};

const getPlanItems = (req, res, next) => {
  findItemsByPlan(req.params.planId, (err, items) => {
    if (err) return next(err);
    res.json(items);
  });
};

// Body: { status, completed_appointment_id }
const setItemStatus = (req, res, next) => {
  const { status, completed_appointment_id } = req.body;
  updateItemStatus(req.params.id, status, completed_appointment_id, (err, item) => {
    if (err) return next(err);
    if (!item) return res.status(404).json({ message: 'Treatment plan item not found' });
    res.json(item);
  });
};

module.exports = { addItem, getPlanItems, setItemStatus };