const { createReferral, findReferralsByPatient, updateReferralStatus } = require('../models/referralModel');

const addReferral = (req, res, next) => {
  const data = { ...req.body, referring_dentist_id: req.user.id };
  createReferral(data, (err, referral) => {
    if (err) return next(err);
    res.status(201).json(referral);
  });
};

const getPatientReferrals = (req, res, next) => {
  findReferralsByPatient(req.params.patientId, (err, referrals) => {
    if (err) return next(err);
    res.json(referrals);
  });
};

const setReferralStatus = (req, res, next) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });
  updateReferralStatus(req.params.id, status, (err, referral) => {
    if (err) return next(err);
    if (!referral) return res.status(404).json({ message: 'Referral not found' });
    res.json(referral);
  });
};

module.exports = { addReferral, getPatientReferrals, setReferralStatus };