const { createConsentForm, findConsentFormsByPatient } = require('../models/consentFormModel');

const addConsentForm = (req, res, next) => {
  const data = { ...req.body, witnessed_by: req.user.id };
  createConsentForm(data, (err, form) => {
    if (err) return next(err);
    res.status(201).json(form);
  });
};

const getPatientConsentForms = (req, res, next) => {
  findConsentFormsByPatient(req.params.patientId, (err, forms) => {
    if (err) return next(err);
    res.json(forms);
  });
};

module.exports = { addConsentForm, getPatientConsentForms };