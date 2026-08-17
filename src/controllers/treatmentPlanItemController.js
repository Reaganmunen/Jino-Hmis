const {
  addTreatmentPlanItem, findItemsByPlan, findTreatmentPlanItemById, updateItemStatus,
} = require('../models/treatmentPlanItemModel');
const { findTreatmentPlanById } = require('../models/treatmentPlanModel');

const STAFF = ['admin', 'dentist', 'receptionist'];

const canAccessPlan = (user, plan) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === plan.patient_id;
  return false;
};

const addItem = (req, res, next) => {
  addTreatmentPlanItem(req.body, (err, item) => {
    if (err) return next(err);
    res.status(201).json(item);
  });
};

// Items carry no patient_id of their own — ownership is resolved through
// the parent TreatmentPlan.
const getPlanItems = (req, res, next) => {
  findTreatmentPlanById(req.params.planId, (planErr, plan) => {
    if (planErr) return next(planErr);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    if (!canAccessPlan(req.user, plan)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }

    findItemsByPlan(req.params.planId, (err, items) => {
      if (err) return next(err);
      res.json(items);
    });
  });
};

// Body: { status, completed_appointment_id }
const setItemStatus = (req, res, next) => {
  const { status, completed_appointment_id } = req.body;

  findTreatmentPlanItemById(req.params.id, (itemErr, item) => {
    if (itemErr) return next(itemErr);
    if (!item) return res.status(404).json({ message: 'Treatment plan item not found' });

    findTreatmentPlanById(item.treatment_plan_id, (planErr, plan) => {
      if (planErr) return next(planErr);
      // Route already restricts this to admin/dentist, so no patient branch
      // to check here — just confirming the plan still exists.
      if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });

      updateItemStatus(req.params.id, status, completed_appointment_id, (err, updated) => {
        if (err) return next(err);
        res.json(updated);
      });
    });
  });
};

module.exports = { addItem, getPlanItems, setItemStatus };