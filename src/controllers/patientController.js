const {
  createPatient, findPatientById, findPatientByUserId,
  searchPatients, listPatients, updatePatient, softDeletePatient,
} = require('../models/patientModel');

const addPatient = (req, res, next) => {
  createPatient(req.body, (err, patient) => {
    if (err) return next(err);
    res.status(201).json(patient);
  });
};

const getPatient = (req, res, next) => {
  findPatientById(req.params.id, (err, patient) => {
    if (err) return next(err);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    res.json(patient);
  });
};

const getMyPatientRecord = (req, res, next) => {
  findPatientByUserId(req.user.id, (err, patient) => {
    if (err) return next(err);
    if (!patient) return res.status(404).json({ message: 'Patient record not found' });
    res.json(patient);
  });
};

const search = (req, res, next) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ message: 'Query param "q" is required' });
  searchPatients(q, (err, patients) => {
    if (err) return next(err);
    res.json(patients);
  });
};

const getAllPatients = (req, res, next) => {
  listPatients((err, patients) => {
    if (err) return next(err);
    res.json(patients);
  });
};

const editPatient = (req, res, next) => {
  updatePatient(req.params.id, req.body, (err, patient) => {
    if (err) return next(err);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    res.json(patient);
  });
};

const removePatient = (req, res, next) => {
  softDeletePatient(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'Patient not found' });
    res.json({ message: 'Patient record deactivated' });
  });
};

module.exports = {
  addPatient, getPatient, getMyPatientRecord, search, getAllPatients, editPatient, removePatient,
};