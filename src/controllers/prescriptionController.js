const {
  createPrescription, findPrescriptionsByPatient, findPrescriptionsByDentist,
} = require('../models/prescriptionModel');

const addPrescription = (req, res, next) => {
  const data = { ...req.body, dentist_id: req.user.id };
  createPrescription(data, (err, prescription) => {
    if (err) return next(err);
    res.status(201).json(prescription);
  });
};

const getPatientPrescriptions = (req, res, next) => {
  findPrescriptionsByPatient(req.params.patientId, (err, prescriptions) => {
    if (err) return next(err);
    res.json(prescriptions);
  });
};

// Query params: ?from=2026-08-17T00:00:00&to=2026-08-18T00:00:00
const getDentistPrescriptions = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }
  findPrescriptionsByDentist(req.params.dentistId, from, to, (err, prescriptions) => {
    if (err) return next(err);
    res.json(prescriptions);
  });
};

module.exports = { addPrescription, getPatientPrescriptions, getDentistPrescriptions };