const pool = require('../config/db');

// Every insert/status update here auto-logs a row into ClaimStatusHistory
// via trg_claim_status_history — no manual history tracking needed.
// status defaults to 'draft' at the DB level, so callers (e.g. a patient
// self-submitting a claim) don't need to pass one.
const createInsuranceClaim = (data, callback) => {
  const { patient_id, bill_id, insurance_provider_id, policy_number, claim_amount } = data;
  const query = `
    INSERT INTO "InsuranceClaim"
      (patient_id, bill_id, insurance_provider_id, policy_number, claim_amount)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const values = [patient_id, bill_id, insurance_provider_id, policy_number, claim_amount];
  pool.query(query, values, (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findClaimById = (id, callback) => {
  const query = `SELECT * FROM "InsuranceClaim" WHERE id = $1`;
  pool.query(query, [id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

const findClaimsByPatient = (patient_id, callback) => {
  const query = `SELECT * FROM "InsuranceClaim" WHERE patient_id = $1 ORDER BY created_at DESC`;
  pool.query(query, [patient_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows);
  });
};

// Lets billing.js ask "does this bill already have a claim?" A bill can only
// reasonably carry one active claim, so most recent wins.
const findClaimByBillId = (bill_id, callback) => {
  const query = `
    SELECT * FROM "InsuranceClaim" WHERE bill_id = $1 ORDER BY created_at DESC LIMIT 1
  `;
  pool.query(query, [bill_id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// For draft -> submitted -> under_review -> approved/partially_approved/rejected.
// Deliberately does NOT accept 'paid' — see recordClaimPayout, which is the only
// path that's allowed to move a claim to 'paid' because it has to touch Payment too.
const updateClaimStatus = (id, status, approved_amount, callback) => {
  const submittedAtClause = status === 'submitted' ? ', submitted_at = now()' : '';
  const query = `
    UPDATE "InsuranceClaim"
    SET status = $1, approved_amount = $2 ${submittedAtClause}
    WHERE id = $3
    RETURNING *
  `;
  pool.query(query, [status, approved_amount, id], (err, result) => {
    if (err) return callback(err);
    callback(null, result.rows[0]);
  });
};

// Records the insurer's payout as a Payment (method: 'insurance') — this is what
// actually moves money against the bill, since trg_payment_recalc recomputes
// Bill.amount_paid/status off SUM(Payment.amount) regardless of method — and
// moves the claim to 'paid' in the same transaction. If either write fails, both
// roll back, so a claim can never end up 'paid' without a matching Payment, or
// vice versa.
const recordClaimPayout = ({ claim_id, bill_id, amount, reference, received_by }, callback) => {
  pool.connect((connErr, client, release) => {
    if (connErr) return callback(connErr);

    const rollback = (err) => {
      client.query('ROLLBACK', () => {
        release();
        callback(err);
      });
    };

    client.query('BEGIN', (beginErr) => {
      if (beginErr) { release(); return callback(beginErr); }

      client.query(
        `INSERT INTO "Payment" (bill_id, amount, method, reference, received_by)
         VALUES ($1, $2, 'insurance', $3, $4)
         RETURNING *`,
        [bill_id, amount, reference, received_by],
        (payErr, payResult) => {
          if (payErr) return rollback(payErr);

          client.query(
            `UPDATE "InsuranceClaim" SET status = 'paid' WHERE id = $1 RETURNING *`,
            [claim_id],
            (claimErr, claimResult) => {
              if (claimErr) return rollback(claimErr);

              client.query('COMMIT', (commitErr) => {
                release();
                if (commitErr) return callback(commitErr);
                callback(null, { payment: payResult.rows[0], claim: claimResult.rows[0] });
              });
            }
          );
        }
      );
    });
  });
};

module.exports = {
  createInsuranceClaim,
  findClaimById,
  findClaimsByPatient,
  findClaimByBillId,
  updateClaimStatus,
  recordClaimPayout,
};