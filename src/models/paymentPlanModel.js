const pool = require('../config/db');

const PLAN_COLUMNS = `
  pp.id, pp.bill_id, pp.patient_id, pp.frequency, pp.paid_before, pp.notes, pp.status,
  pp.created_at, pp.cancelled_at, pp.created_by
`;

// Instalments for several plans in one query, grouped by plan id.
const loadInstalments = (planIds, callback) => {
  if (!planIds.length) return callback(null, {});
  pool.query(
    `SELECT id, plan_id, seq, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount
     FROM "PaymentPlanInstalment" WHERE plan_id = ANY($1::uuid[]) ORDER BY plan_id, seq`,
    [planIds],
    (err, result) => {
      if (err) return callback(err);
      const byPlan = {};
      result.rows.forEach((r) => { (byPlan[r.plan_id] = byPlan[r.plan_id] || []).push(r); });
      callback(null, byPlan);
    },
  );
};

// Plan + bill figures (the bill's totals are trigger-maintained; we only read them).
const BILL_JOIN = `
  b.total_amount AS bill_total, b.amount_paid AS bill_paid, b.status AS bill_status,
  b.created_at AS bill_created_at
`;

const attach = (rows, callback) => {
  loadInstalments(rows.map((r) => r.id), (err, byPlan) => {
    if (err) return callback(err);
    callback(null, rows.map((r) => ({ ...r, instalments: byPlan[r.id] || [] })));
  });
};

const createPlan = (data, callback) => {
  pool.connect((connErr, client, release) => {
    if (connErr) return callback(connErr);
    const fail = (err) => client.query('ROLLBACK', () => { release(); callback(err); });

    client.query('BEGIN', (beginErr) => {
      if (beginErr) { release(); return callback(beginErr); }
      client.query(
        `INSERT INTO "PaymentPlan" (bill_id, patient_id, created_by, frequency, paid_before, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [data.bill_id, data.patient_id, data.created_by, data.frequency, data.paid_before, data.notes],
        (planErr, planRes) => {
          if (planErr) return fail(planErr);
          const planId = planRes.rows[0].id;
          const values = []; const params = [];
          data.instalments.forEach((inst, i) => {
            params.push(`($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`);
            values.push(planId, inst.seq, inst.due_date, inst.amount);
          });
          client.query(
            `INSERT INTO "PaymentPlanInstalment" (plan_id, seq, due_date, amount) VALUES ${params.join(',')}`,
            values,
            (instErr) => {
              if (instErr) return fail(instErr);
              client.query('COMMIT', (commitErr) => {
                release();
                if (commitErr) return callback(commitErr);
                callback(null, planId);
              });
            },
          );
        },
      );
    });
  });
};

const findPlanById = (id, callback) => {
  pool.query(
    `SELECT ${PLAN_COLUMNS}, ${BILL_JOIN}
     FROM "PaymentPlan" pp JOIN "Bill" b ON b.id = pp.bill_id WHERE pp.id = $1`,
    [id],
    (err, result) => {
      if (err) return callback(err);
      if (!result.rows[0]) return callback(null, null);
      attach(result.rows, (aErr, rows) => (aErr ? callback(aErr) : callback(null, rows[0])));
    },
  );
};

// The live plan for a bill, or null.
const findActivePlanByBill = (bill_id, callback) => {
  pool.query(
    `SELECT ${PLAN_COLUMNS}, ${BILL_JOIN}
     FROM "PaymentPlan" pp JOIN "Bill" b ON b.id = pp.bill_id
     WHERE pp.bill_id = $1 AND pp.status = 'active'`,
    [bill_id],
    (err, result) => {
      if (err) return callback(err);
      if (!result.rows[0]) return callback(null, null);
      attach(result.rows, (aErr, rows) => (aErr ? callback(aErr) : callback(null, rows[0])));
    },
  );
};

const findPlansByPatient = (patient_id, callback) => {
  pool.query(
    `SELECT ${PLAN_COLUMNS}, ${BILL_JOIN}
     FROM "PaymentPlan" pp JOIN "Bill" b ON b.id = pp.bill_id
     WHERE pp.patient_id = $1 ORDER BY pp.created_at DESC LIMIT 100`,
    [patient_id],
    (err, result) => (err ? callback(err) : attach(result.rows, callback)),
  );
};

// Every live plan on a bill that still matters, with the patient's contact details.
const findActivePlansForCollections = (callback) => {
  pool.query(
    `SELECT ${PLAN_COLUMNS}, ${BILL_JOIN},
            p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.phone AS patient_phone
     FROM "PaymentPlan" pp
     JOIN "Bill" b ON b.id = pp.bill_id
     JOIN "Patient" p ON p.id = pp.patient_id
     WHERE pp.status = 'active' AND b.status NOT IN ('void', 'paid', 'draft')
     LIMIT 2000`,
    [],
    (err, result) => (err ? callback(err) : attach(result.rows, callback)),
  );
};

const cancelPlan = (id, user_id, callback) => {
  pool.query(
    `UPDATE "PaymentPlan" SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
     WHERE id = $1 AND status = 'active' RETURNING id`,
    [id, user_id],
    (err, result) => (err ? callback(err) : callback(null, result.rowCount)),
  );
};

module.exports = {
  createPlan, findPlanById, findActivePlanByBill, findPlansByPatient,
  findActivePlansForCollections, cancelPlan,
};
