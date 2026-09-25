const {
  createDiagnosis, findDiagnosesByPatient, findDiagnosisById,
  findDiagnosesByDentist, findDiagnosisByAppointment, updateDiagnosis,
} = require('../models/diagnosisModel');

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

// Diagnosis has no patientId in the URL to check against a route middleware,
// so ownership is verified here once the row is fetched. Every non-patient
// role in this system is staff, so the only real restriction is: a patient
// may only see their own diagnosis.
const getDiagnosis = (req, res, next) => {
  findDiagnosisById(req.params.id, (err, diagnosis) => {
    if (err) return next(err);
    if (!diagnosis) return res.status(404).json({ message: 'Diagnosis not found' });
    if (req.user.role === 'patient' && req.user.patient_id !== diagnosis.patient_id) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
    res.json(diagnosis);
  });
};

// Lets a dentist correct a finding/checkup they logged (wrong tooth, a typo
// in the notes, etc). No dentistId in the URL, so — same as getDiagnosis
// above — ownership is checked here once the row is fetched: only the
// dentist who originally logged it, or an admin, may edit it.
const editDiagnosis = (req, res, next) => {
  findDiagnosisById(req.params.id, (err, diagnosis) => {
    if (err) return next(err);
    if (!diagnosis) return res.status(404).json({ message: 'Diagnosis not found' });
    if (req.user.role !== 'admin' && req.user.id !== diagnosis.dentist_id) {
      return res.status(403).json({ message: 'You do not have permission to edit this resource' });
    }

    const data = {
      tooth_refs: req.body.tooth_refs !== undefined ? req.body.tooth_refs : diagnosis.tooth_refs,
      diagnosis_text: req.body.diagnosis_text !== undefined ? req.body.diagnosis_text : diagnosis.diagnosis_text,
    };
    updateDiagnosis(req.params.id, data, (updErr, updated) => {
      if (updErr) return next(updErr);
      res.json(updated);
    });
  });
};

// Query params: ?from=2026-08-17T00:00:00&to=2026-08-18T00:00:00
const getDentistDiagnoses = (req, res, next) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ message: 'Query params "from" and "to" are required' });
  }
  findDiagnosesByDentist(req.params.dentistId, from, to, (err, diagnoses) => {
    if (err) return next(err);
    res.json(diagnoses);
  });
};

const getDiagnosisForAppointment = (req, res, next) => {
  findDiagnosisByAppointment(req.params.appointmentId, (err, diagnosis) => {
    if (err) return next(err);
    res.json(diagnosis || null);
  });
};

module.exports = {
  addDiagnosis, getPatientDiagnoses, getDiagnosis, editDiagnosis, getDentistDiagnoses, getDiagnosisForAppointment,
};