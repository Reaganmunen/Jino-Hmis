const { createDiagnosis, findDiagnosesByPatient, findDiagnosisById } = require('../models/diagnosisModel');

const addDiagnosis = (req, res, next) => {
  const data = { ...req.body, dentist_id: req.user.id };
  createDiagnosis(data, (err, diagnosis) => {
    if (err) return next(err);
    res.status(201).json(diagnosis);
  });
};

const getPatientDiagnoses = (req, res, next) => {
  findDiagnosesByPatient(req.params.patientId, (err, diagnoses) => {
    if (err) return next(err);
    res.json(diagnoses);
  });
};

const getDiagnosis = (req, res, next) => {
  findDiagnosisById(req.params.id, (err, diagnosis) => {
    if (err) return next(err);
    if (!diagnosis) return res.status(404).json({ message: 'Diagnosis not found' });
    res.json(diagnosis);
  });
};

module.exports = { addDiagnosis, getPatientDiagnoses, getDiagnosis };