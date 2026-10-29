const pool = require('../config/db');

// Statuses a plan can no longer be accepted from.
const CLOSED_STATUSES = ['approved', 'in_progress', 'completed', 'cancelled', 'rejected'];

const LIST_COLUMNS = `
  a.id, a.treatment_plan_id, a.patient_id, a.decision, a.signer_name, a.signer_relationship,
  a.recorded_via, a.accepted_total, a.decline_reason, a.created_at,
  r.first_name AS recorded_by_first_name, r.last_name AS recorded_by_last_name, r.role AS recorded_by_role
`;
const FROM = `FROM "TreatmentPlanAcceptance" a JOIN "User" r ON r.id = a.recorded_by`;

// Newest record per plan for one patient (no signature image, so it stays small).
const findLatestByPatient = (patient_id, callback) => {
  pool.query(
    `SELECT DISTINCT ON (a.treatment_plan_id) ${LIST_COLUMNS} ${FROM}
     WHERE a.patient_id = $1
     ORDER BY a.treatment_plan_id, a.created_at DESC`,
    [patient_id],
    (err, result) => (err ? callback(err) : callback(null, result.rows)),
  );
};

// Newest record for one plan, including the drawn signature and the item snapshot.
const findLatestByPlan = (plan_id, callback) => {
  pool.query(
    `SELECT ${LIST_COLUMNS}, a.signature_png, a.accepted_items ${FROM}
     WHERE a.treatment_plan_id = $1 ORDER BY a.created_at DESC LIMIT 1`,
    [plan_id],
    (err, result) => (err ? callback(err) : callback(null, result.rows[0] || null)),
  );
};

// Saves the record and, for an acceptance, approves the plan, in one transaction.
// The UPDATE only matches a still-open plan, so two people accepting at once can't both win.
const record = (d, callback) => {
  pool.connect((connErr, client, release) => {
    if (connErr) return callback(connErr);
    const fail = (err) => client.query('ROLLBACK', () => { release(); callback(err); });

    client.query('BEGIN', (beginErr) => {
      if (beginErr) { release(); return callback(beginErr); }

      const insert = () => client.query(
        `INSERT INTO "TreatmentPlanAcceptance"
           (treatment_plan_id, patient_id, decision, signer_name, signer_relationship, recorded_by,
            recorded_via, signature_png, accepted_total, accepted_items, decline_reason, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
         RETURNING id`,
        [d.plan_id, d.patient_id, d.decision, d.signer_name, d.signer_relationship, d.recorded_by,
          d.recorded_via, d.signature_png, d.total, JSON.stringify(d.items), d.decline_reason, d.ip, d.user_agent],
        (insErr, insRes) => {
          if (insErr) return fail(insErr);
          client.query('COMMIT', (commitErr) => {
            release();
            if (commitErr) return callback(commitErr);
            callback(null, { id: insRes.rows[0].id });
          });
        },
      );

      if (d.decision !== 'accepted') return insert();

      client.query(
        `UPDATE "TreatmentPlan" SET status = 'approved', approved_at = now()
         WHERE id = $1 AND status::text <> ALL($2::text[]) RETURNING id`,
        [d.plan_id, CLOSED_STATUSES],
        (upErr, upRes) => {
          if (upErr) return fail(upErr);
          if (!upRes.rowCount) {
            return client.query('ROLLBACK', () => { release(); callback(null, null); });
          }
          insert();
        },
      );
    });
  });
};

module.exports = { CLOSED_STATUSES, findLatestByPatient, findLatestByPlan, record };
