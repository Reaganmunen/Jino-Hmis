const {
  createInsuranceClaim, findClaimById, findClaimsByPatient, findClaimByBillId,
  updateClaimStatus, recordClaimPayout,
} = require('../models/insuranceClaimModel');
const { findPatientByUserId } = require('../models/patientModel');
const { findBillById } = require('../models/billModel');

const STAFF_ROLES = ['admin', 'receptionist'];

// Patients can create a claim for themselves (starts as 'draft', the column
// default — the endpoint ignores anything else in the body). Staff can create
// on behalf of a walk-in patient using patient_id from the body directly.
const addClaim = (req, res, next) => {
  if (req.user.role === 'patient') {
    findPatientByUserId(req.user.id, (err, patient) => {
      if (err) return next(err);
      if (!patient) return res.status(404).json({ message: 'Patient record not found' });

      const { bill_id, insurance_provider_id, policy_number, claim_amount } = req.body;
      createInsuranceClaim(
        { patient_id: patient.id, bill_id, insurance_provider_id, policy_number, claim_amount },
        (createErr, claim) => {
          if (createErr) return next(createErr);
          res.status(201).json(claim);
        }
      );
    });
    return;
  }

  createInsuranceClaim(req.body, (err, claim) => {
    if (err) return next(err);
    res.status(201).json(claim);
  });
};

// Staff-only (route-gated) — full claim record by id.
const getClaim = (req, res, next) => {
  findClaimById(req.params.id, (err, claim) => {
    if (err) return next(err);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    res.json(claim);
  });
};

// Patients may only fetch their own claim history; staff can fetch anyone's.
const getPatientClaims = (req, res, next) => {
  const { patientId } = req.params;

  const proceed = () => {
    findClaimsByPatient(patientId, (err, claims) => {
      if (err) return next(err);
      res.json(claims);
    });
  };

  if (STAFF_ROLES.includes(req.user.role)) return proceed();

  findPatientByUserId(req.user.id, (err, patient) => {
    if (err) return next(err);
    if (!patient || String(patient.id) !== String(patientId)) {
      return res.status(403).json({ message: 'Not authorized to view these claims' });
    }
    proceed();
  });
};

// Lets billing.js ask "does this bill already have a claim?" without pulling
// the patient's full claim history. Ownership check goes through the bill's
// patient_id since the claim may not exist yet.
const getClaimForBill = (req, res, next) => {
  const { billId } = req.params;

  findBillById(billId, (billErr, bill) => {
    if (billErr) return next(billErr);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });

    const proceed = () => {
      findClaimByBillId(billId, (err, claim) => {
        if (err) return next(err);
        res.json(claim || null);
      });
    };

    if (STAFF_ROLES.includes(req.user.role)) return proceed();

    findPatientByUserId(req.user.id, (err, patient) => {
      if (err) return next(err);
      if (!patient || String(patient.id) !== String(bill.patient_id)) {
        return res.status(403).json({ message: 'Not authorized to view this claim' });
      }
      proceed();
    });
  });
};

// Staff-only (route-gated). Body: { status, approved_amount }
// Handles draft -> submitted -> under_review -> approved/partially_approved/rejected.
// Rejects an attempt to set 'paid' directly — that has to go through payoutClaim
// below so the Payment row and the claim status can't drift apart.
const setClaimStatus = (req, res, next) => {
  const { status, approved_amount } = req.body;
  if (!status) return res.status(400).json({ message: 'status is required' });
  if (status === 'paid') {
    return res.status(400).json({
      message: "Use POST /:id/payout to move a claim to 'paid' — it records the Payment too.",
    });
  }
  updateClaimStatus(req.params.id, status, approved_amount, (err, claim) => {
    if (err) return next(err);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });
    res.json(claim);
  });
};

// Staff-only (route-gated). Body: { reference } — the insurer's payout/EFT/cheque
// reference. Records the payout as a Payment against the claim's bill and moves
// the claim to 'paid', both in one transaction.
const payoutClaim = (req, res, next) => {
  const { reference } = req.body;

  findClaimById(req.params.id, (err, claim) => {
    if (err) return next(err);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    if (!['approved', 'partially_approved'].includes(claim.status)) {
      return res.status(400).json({
        message: `Claim must be approved before payout (current status: ${claim.status})`,
      });
    }
    if (!claim.approved_amount || Number(claim.approved_amount) <= 0) {
      return res.status(400).json({ message: 'Claim has no approved_amount to pay out' });
    }

    recordClaimPayout(
      {
        claim_id: claim.id,
        bill_id: claim.bill_id,
        amount: claim.approved_amount,
        reference,
        received_by: req.user.id,
      },
      (payoutErr, result) => {
        if (payoutErr) return next(payoutErr);
        res.json(result);
      }
    );
  });
};

module.exports = {
  addClaim, getClaim, getPatientClaims, getClaimForBill, setClaimStatus, payoutClaim,
};