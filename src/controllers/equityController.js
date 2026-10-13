const crypto = require('crypto');
const { initiateStkPush, isConfigured } = require('../services/equityJengaService');
const {
  createProviderTransaction, settleTransactionIfPending,
} = require('../models/mpesaTransactionModel');
const { recordPayment } = require('../models/paymentModel');
const { findBillById } = require('../models/billModel');

// Equity paybill STK push (Jenga). Transactions live in the same "MpesaTransaction" table as the
// Daraja and KCB ones (provider = 'equity'), so /api/mpesa/status/:id and /api/mpesa/bill/:id
// and the existing polling UI work for all three without changes.

const STAFF = ['admin', 'dentist', 'receptionist'];

const canAccessBill = (user, bill) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === bill.patient_id;
  return false;
};

const initiatePayment = (req, res, next) => {
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Equity payments are not configured on this server' });
  }

  const { bill_id, phone, amount } = req.body;
  if (!bill_id || !phone || !amount) {
    return res.status(400).json({ message: 'bill_id, phone, and amount are required' });
  }
  // Equity charges whole shillings, so work with the amount that will actually be requested.
  const wholeAmount = Math.round(Number(amount));
  if (!(wholeAmount >= 1)) {
    return res.status(400).json({ message: 'amount must be at least KES 1' });
  }

  findBillById(bill_id, (billErr, bill) => {
    if (billErr) return next(billErr);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }
    if (bill.status === 'paid' || bill.status === 'void') {
      return res.status(400).json({ message: `Bill is already ${bill.status}` });
    }

    const balanceDue = Number(bill.total_amount) - Number(bill.amount_paid);
    if (wholeAmount > balanceDue) {
      return res.status(400).json({ message: `Amount exceeds balance due (KES ${balanceDue.toFixed(2)})` });
    }

    initiateStkPush({ phone, amount: wholeAmount }, (stkErr, stk) => {
      if (stkErr) {
        console.error('Equity STK push failed:', JSON.stringify(stkErr));
        return res.status(502).json({
          message: 'Failed to initiate Equity payment',
          detail: stkErr.message || undefined,
        });
      }

      // Equity's only identifier is the 6-char reference we generated; it is echoed back on the
      // callback as transactionReference, so it serves as the checkout id for reconciliation.
      createProviderTransaction(
        {
          bill_id,
          phone,
          amount: wholeAmount,
          checkout_request_id: stk.reference,
          merchant_request_id: stk.reference,
          provider: 'equity',
        },
        (dbErr, transaction) => {
          if (dbErr) return next(dbErr);
          res.status(201).json({
            message: 'STK push sent. Ask the patient to check their phone.',
            transaction,
          });
        }
      );
    });
  });
};

// Jenga callback codes: 0 pending, 1 failed, 2 / 4 paid by the customer but not yet credited to
// the clinic account, 3 completed and credited, 5 / 6 cancelled, 7 rejected.
const FAILED_CODES = [1, 5, 6, 7];

const parseCallback = (body) => {
  const b = body || {};
  return {
    reference: b.transactionReference,
    code: Number(b.code),
    message: b.message,
    receipt: b.telcoReference || null, // the M-Pesa receipt number
    amount: b.requestAmount !== undefined ? b.requestAmount : null,
  };
};

// Fails closed: Jenga callbacks carry no signature, so the shared secret is the only proof of origin.
const secretMatches = (provided) => {
  const expected = process.env.EQUITY_CALLBACK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Public endpoint (no JWT) — Jenga calls this. Keep it OUT of verifyToken.
const handleCallback = (req, res) => {
  const ack = () => res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  if (!secretMatches(req.query.token)) {
    return res.status(401).json({ message: 'Invalid callback token' });
  }

  const parsed = parseCallback(req.body);
  if (!parsed.reference || Number.isNaN(parsed.code)) {
    console.warn('Equity callback not recognised:', JSON.stringify(req.body));
    return ack(); // acknowledge so Jenga doesn't keep retrying a payload we can't use
  }

  if (parsed.code === 0) return ack(); // still pending, wait for the final status

  const success = parsed.code === 3;
  if (!success && !FAILED_CODES.includes(parsed.code)) {
    // 2 / 4 (customer debited, clinic not yet credited) or a code we don't know. Leave the
    // transaction pending rather than guess — it needs a look at the Equity statement.
    console.warn(`Equity callback ${parsed.reference} needs manual reconciliation (code ${parsed.code}):`, JSON.stringify(req.body));
    return ack();
  }

  // Only the first final callback for a pending transaction wins, so a retry can't record the payment twice.
  settleTransactionIfPending(
    parsed.reference,
    {
      status: success ? 'success' : 'failed',
      mpesa_receipt: parsed.receipt,
      result_desc: parsed.message,
      raw_callback: req.body,
    },
    (err, transaction) => {
      if (err) {
        console.error('Equity callback DB error:', err);
        return ack();
      }
      if (!transaction || !success) return ack();

      if (parsed.amount !== null && Number(parsed.amount) !== Number(transaction.amount)) {
        console.warn(`Equity amount mismatch on ${parsed.reference}: requested ${transaction.amount}, paid ${parsed.amount}`);
      }

      recordPayment(
        {
          bill_id: transaction.bill_id,
          amount: parsed.amount !== null ? parsed.amount : transaction.amount,
          method: 'mpesa', // paid through M-Pesa; the Payment.method list is unchanged
          reference: parsed.receipt,
          received_by: null,
        },
        (paymentErr) => {
          if (paymentErr) console.error('Equity recordPayment failed:', paymentErr);
          ack();
        }
      );
    }
  );
};

module.exports = { initiatePayment, handleCallback, parseCallback };
