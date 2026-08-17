const { createConsentForm, findConsentFormsByPatient } = require('../models/consentFormModel');
const { findPatientByUserId } = require('../models/patientModel');

// Staff (admin/dentist/receptionist) witness a signature in person, so their
// user id goes in witnessed_by and they can pass any patient_id from the form.
// Patients self-signing from the portal can't witness themselves and can't be
// trusted to submit someone else's patient_id, so both are resolved server-side.
const addConsentForm = (req, res, next) => {
  const finalize = (patient_id) => {
    const data = { ...req.body, patient_id, witnessed_by: req.user.role === 'patient' ? null : req.user.id };
    createConsentForm(data, (err, form) => {
      if (err) return next(err);
      res.status(201).json(form);
    });
  };

  if (req.user.role === 'patient') {
    findPatientByUserId(req.user.id, (err, patient) => {
      if (err) return next(err);
      if (!patient) return res.status(404).json({ message: 'Patient record not found' });
      finalize(patient.id);
    });
  } else {
    finalize(req.body.patient_id);
  }
};

const getPatientConsentForms = (req, res, next) => {
  findConsentFormsByPatient(req.params.patientId, (err, forms) => {
    if (err) return next(err);
    res.json(forms);
  });
};

module.exports = { addConsentForm, getPatientConsentForms };