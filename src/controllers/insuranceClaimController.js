const {
  createInsuranceClaim, findClaimById, findClaimsByPatient, updateClaimStatus,
} = require('../models/insuranceClaimModel');

// Every status change here auto-logs to ClaimStatusHistory via DB trigger.
const addClaim = (req, res, next) => {
  createInsuranceClaim(req.body, (err, claim) => {
    if (err) return next(err);
    res.status(201).json(claim);
  });
};

const getClaim = (req, res, next) => {
  findClaimById(req.params.id, (err, claim) => {
    if (err) return next(err);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    res.json(claim);
  });
};

const getPatientClaims = (req, res, next) => {
  findClaimsByPatient(req.params.patientId, (err, claims) => {
    if (err) return next(err);
    res.json(claims);
  });
};

// Body: { status, approved_amount }
const setClaimStatus = (req, res, next) => {
  const { status, approved_amount } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });
  updateClaimStatus(req.params.id, status, approved_amount, (err, claim) => {
    if (err) return next(err);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    res.json(claim);
  });
};

module.exports = { addClaim, getClaim, getPatientClaims, setClaimStatus };