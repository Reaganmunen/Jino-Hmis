const {
  createTreatmentPlan, findTreatmentPlanById, findTreatmentPlansByPatient, updateTreatmentPlanStatus,
} = require('../models/treatmentPlanModel');

const addPlan = (req, res, next) => {
  const data = { ...req.body, dentist_id: req.user.id };
  createTreatmentPlan(data, (err, plan) => {
    if (err) return next(err);
    res.status(201).json(plan);
  });
};

const getPlan = (req, res, next) => {
  findTreatmentPlanById(req.params.id, (err, plan) => {
    if (err) return next(err);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    res.json(plan);
  });
};

const getPatientPlans = (req, res, next) => {
  findTreatmentPlansByPatient(req.params.patientId, (err, plans) => {
    if (err) return next(err);
    res.json(plans);
  });
};

// Body: { status: 'approved' | 'in_progress' | 'completed' | 'cancelled' }
// Patients hit this to approve their own plan before starting treatment.
const setStatus = (req, res, next) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });
  updateTreatmentPlanStatus(req.params.id, status, (err, plan) => {
    if (err) return next(err);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    res.json(plan);
  });
};

module.exports = { addPlan, getPlan, getPatientPlans, setStatus };