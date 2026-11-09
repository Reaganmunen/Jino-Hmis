const pool = require('../config/db');
const { queryStkStatus } = require('../services/mpesaService');
const { settleTransactionIfPending } = require('../models/mpesaTransactionModel');
const { recordPayment } = require('../models/paymentModel');

const INTERVAL_MS = 2 * 60 * 1000;
const BATCH_SIZE = 50;

let running = false;

const eachSequentially = (items, worker, done) => {
  let i = 0;
  const next = () => (i >= items.length ? done() : worker(items[i++], next));
  next();
};

const credit = (tx, done) => {
  recordPayment(
    {
      bill_id: tx.bill_id,
      amount: tx.amount,
      method: 'mpesa',
      // The STK query response has no receipt number, so fall back to the checkout ID.
      reference: tx.mpesa_receipt || tx.checkout_request_id,
      received_by: null,
    },
    (err) => {
      if (err) console.error(`[mpesa-reconcile] recordPayment failed for ${tx.checkout_request_id}:`, err);
      else console.log(`[mpesa-reconcile] credited bill ${tx.bill_id} for ${tx.checkout_request_id}`);
      done();
    }
  );
};

// Pass 1: 'pending' rows whose callback never arrived (or was deferred). Ask Safaricom.
const settlePending = (done) => {
  const sql = `
    SELECT * FROM "MpesaTransaction"
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '2 minutes'
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at
    LIMIT ${BATCH_SIZE}
  `;
  pool.query(sql, (err, result) => {
    if (err) { console.error('[mpesa-reconcile] pending query failed:', err.message); return done(); }

    eachSequentially(result.rows, (tx, next) => {
      queryStkStatus(tx.checkout_request_id, (queryErr, r) => {
        // Errors here usually mean "still processing" or a transient Daraja issue; retry next run.
        if (queryErr || !r || r.ResultCode === undefined) return next();
        const code = String(r.ResultCode);
        if (code === '4999') return next(); // still processing

        const success = code === '0';
        settleTransactionIfPending(
          tx.checkout_request_id,
          {
            status: success ? 'success' : 'failed',
            mpesa_receipt: null,
            result_desc: r.ResultDesc || null,
            raw_callback: { source: 'reconciliation', response: r },
          },
          (settleErr, settled) => {
            if (settleErr) { console.error('[mpesa-reconcile] settle failed:', settleErr.message); return next(); }
            if (!settled || !success) return next();
            credit(settled, next);
          }
        );
      });
    }, done);
  });
};

// Pass 2: 'success' rows with no matching Payment (recordPayment failed after settling).
// ASSUMES a "Payment" table with bill_id, method and reference columns; adjust if yours differ.
const creditOrphans = (done) => {
  const sql = `
    SELECT t.* FROM "MpesaTransaction" t
    WHERE t.status = 'success'
      AND t.created_at < NOW() - INTERVAL '5 minutes'
      AND t.created_at > NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM "Payment" p
        WHERE p.bill_id = t.bill_id
          AND p.method = 'mpesa'
          AND p.reference IN (t.mpesa_receipt, t.checkout_request_id)
      )
    ORDER BY t.created_at
    LIMIT ${BATCH_SIZE}
  `;
  pool.query(sql, (err, result) => {
    if (err) { console.error('[mpesa-reconcile] orphan query failed:', err.message); return done(); }
    eachSequentially(result.rows, credit, done);
  });
};

const runOnce = () => {
  if (running) return;
  running = true;
  settlePending(() => creditOrphans(() => { running = false; }));
};

// Call once at startup. Run on ONE instance only if you scale horizontally.
const startMpesaReconciliation = () => {
  if (process.env.MPESA_RECONCILE === 'false') return;
  setTimeout(runOnce, 30 * 1000);
  setInterval(runOnce, INTERVAL_MS).unref();
  console.log('[mpesa-reconcile] job started');
};

module.exports = { startMpesaReconciliation, runOnce };