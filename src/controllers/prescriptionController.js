const { createPrescription, findPrescriptionsByPatient } = require('../models/prescriptionModel');

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

module.exports = { addPrescription, getPatientPrescriptions };