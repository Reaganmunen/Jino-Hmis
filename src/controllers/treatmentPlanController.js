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
//
// Patients approve or cancel their own plan themselves. Staff
// (dentist/admin/receptionist) can also set 'approved' -- e.g. when a
// patient can't log in to approve it themselves -- plus move it through
// the clinical progress states a patient shouldn't be able to touch.
// This is an explicit allow-list per role rather than "anything a
// non-patient sends goes through", so it's clear in one place exactly
// who is permitted to set which status, and adding a new status or role
// later doesn't silently open up more than intended.
const ALLOWED_STATUSES_BY_ROLE = {
  patient: ['approved', 'cancelled'],
  dentist: ['approved', 'in_progress', 'completed', 'cancelled'],
  admin: ['approved', 'in_progress', 'completed', 'cancelled'],
  receptionist: ['approved', 'in_progress', 'completed', 'cancelled'],
};

const setStatus = (req, res, next) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });

  findTreatmentPlanById(req.params.id, (findErr, plan) => {
    if (findErr) return next(findErr);
    if (!plan) return res.status(404).json({ message: 'Treatment plan not found' });
    if (!canAccessPlan(req.user, plan)) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }

    const allowedStatuses = ALLOWED_STATUSES_BY_ROLE[req.user.role] || [];
    if (!allowedStatuses.includes(status)) {
      return res.status(403).json({ message: `Your role is not permitted to set status "${status}"` });
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