const {
  createTreatmentPlan, findTreatmentPlanById, findTreatmentPlansByPatient,
  findActiveTreatmentPlansByDentist, updateTreatmentPlanStatus,
} = require('../models/treatmentPlanModel');

const STAFF = ['admin', 'dentist', 'receptionist'];

const canAccessPlan = (user, plan) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === plan.patient_id;
  return false;
};

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
    if (!canAccessPlan(req.user, plan)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
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
// Patients hit this to approve their own plan before starting treatment;
// ownership must be checked here since the route has no patientId param.
const setStatus = (req, res, next) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });

  findTreatmentPlanById(req.params.id, (findErr, plan) => {
    if (findErr) return next(findErr);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    if (!canAccessPlan(req.user, plan)) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }
    // A patient may only ever move their plan to 'approved' or 'cancelled' —
    // progress states like 'in_progress'/'completed' are a clinical call.
    if (req.user.role === 'patient' && !['approved', 'cancelled'].includes(status)) {
      return res.status(403).json({ message: 'Patients may only approve or cancel a treatment plan' });
    }

    updateTreatmentPlanStatus(req.params.id, status, (err, updated) => {
      if (err) return next(err);
      res.json(updated);
    });
  });
};

// Powers the dentist overview "Active treatment plans" panel.
const getDentistActivePlans = (req, res, next) => {
  findActiveTreatmentPlansByDentist(req.params.dentistId, (err, plans) => {
    if (err) return next(err);
    res.json(plans);
  });
};

module.exports = { addPlan, getPlan, getPatientPlans, getDentistActivePlans, setStatus };