const { initiateStkPush, queryStkStatus, normalizePhone } = require('../services/mpesaService');
const {
  createMpesaTransaction, findByCheckoutRequestId, settleTransactionIfPending, findTransactionsByBill,
} = require('../models/mpesaTransactionModel');
const { recordPayment } = require('../models/paymentModel');
const { findBillById } = require('../models/billModel');

const STAFF = ['admin', 'dentist', 'receptionist'];

// A push younger than this still counts against the bill's balance (prevents overpaying
// via two prompts sent back to back). STK prompts time out after ~1-2 minutes.
const PENDING_WINDOW_MS = 5 * 60 * 1000;

// Callback can arrive before createMpesaTransaction has inserted the row.
const ROW_LOOKUP_RETRIES = 3;
const ROW_LOOKUP_DELAY_MS = 1000;

// Confirm "success" callbacks with Safaricom before crediting. On by default in production.
const shouldVerifyCallback = () =>
  process.env.MPESA_VERIFY_CALLBACK
    ? process.env.MPESA_VERIFY_CALLBACK === 'true'
    : process.env.MPESA_ENV === 'production';

const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

const canAccessBill = (user, bill) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === bill.patient_id;
  return false;
};

// Daraja's AccountReference is capped at 12 chars; Bill.id is a UUID. Reconciliation
// keys off checkout_request_id, so a truncated reference is fine.
const shortBillReference = (billId) => String(billId).replace(/-/g, '').slice(0, 12).toUpperCase();

const initiatePayment = (req, res, next) => {
  const { bill_id, phone, amount: rawAmount } = req.body;
  if (!bill_id || !phone || !rawAmount) {
    return res.status(400).json({ message: 'bill_id, phone, and amount are required' });
  }
  // Round once here so what we validate, store and charge are the same number.
  const amount = Math.round(Number(rawAmount));
  if (!Number.isFinite(amount) || amount < 1) {
    return res.status(400).json({ message: 'amount must be at least 1' });
  }

  // Reject bad numbers here instead of letting Safaricom answer "Invalid PhoneNumber".
  const normalizedPhone = normalizePhone(String(phone));
  if (!/^254[17]\d{8}$/.test(normalizedPhone)) {
    return res.status(400).json({ message: 'Enter a valid Safaricom number, e.g. 0712345678' });
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

    findTransactionsByBill(bill_id, (txErr, transactions) => {
      if (txErr) return next(txErr);

      const cutoff = Date.now() - PENDING_WINDOW_MS;
      const pendingTotal = transactions
        .filter((t) => t.status === 'pending' && new Date(t.created_at).getTime() > cutoff)
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const balanceDue = Number(bill.total_amount) - Number(bill.amount_paid);
      const available = balanceDue - pendingTotal;

      if (amount > available) {
        const message = pendingTotal > 0
          ? `Amount exceeds balance due after pending M-Pesa prompts (KES ${Math.max(available, 0).toFixed(2)} available). Wait a few minutes or complete the prompt already sent.`
          : `Amount exceeds balance due (KES ${balanceDue.toFixed(2)})`;
        return res.status(400).json({ message });
      }

      initiateStkPush(
        { phone: normalizedPhone, amount, accountReference: shortBillReference(bill_id), transactionDesc: `Bill ${bill_id}` },
        (stkErr, stkResponse) => {
          if (stkErr) {
            console.error('M-Pesa STK push failed:', stkErr);
            return res.status(502).json({ message: 'Failed to initiate M-Pesa payment. Please try again.' });
          }

          createMpesaTransaction(
            {
              bill_id,
              phone: normalizedPhone,
              amount,
              checkout_request_id: stkResponse.CheckoutRequestID,
              merchant_request_id: stkResponse.MerchantRequestID,
            },
            (dbErr, transaction) => {
              if (dbErr) {
                // The prompt is already on the patient's phone. Log the IDs so it can be traced.
                console.error('Failed to save MpesaTransaction after STK push', stkResponse, dbErr);
                return next(dbErr);
              }
              res.status(201).json({
                message: 'STK push sent. Ask the patient to check their phone.',
                transaction,
              });
            }
          );
        }
      );
    });
  });
};

// Settles the row only if it is still 'pending'. Returns the row on the first callback,
// null on a duplicate, and waits briefly if the row hasn't been inserted yet.
const settleWithRetry = (checkoutRequestId, data, attempt, done) => {
  settleTransactionIfPending(checkoutRequestId, data, (err, transaction) => {
    if (err) return done(err);
    if (transaction) return done(null, transaction);

    findByCheckoutRequestId(checkoutRequestId, (findErr, existing) => {
      if (findErr) return done(findErr);
      if (existing) return done(null, null); // already settled -> duplicate callback
      if (attempt >= ROW_LOOKUP_RETRIES) {
        console.error(`M-Pesa callback for unknown CheckoutRequestID ${checkoutRequestId}`);
        return done(null, null);
      }
      setTimeout(() => settleWithRetry(checkoutRequestId, data, attempt + 1, done), ROW_LOOKUP_DELAY_MS);
    });
  });
};

const creditBill = (transaction, amountPaid, mpesaReceipt, res) => {
  recordPayment(
    {
      bill_id: transaction.bill_id,
      amount: amountPaid || transaction.amount,
      method: 'mpesa',
      reference: mpesaReceipt || transaction.checkout_request_id,
      received_by: null,
    },
    (paymentErr) => {
      // Transaction is already 'success'; the reconciliation job re-credits any
      // success row with no matching Payment, so just log here.
      if (paymentErr) console.error('recordPayment failed, reconciliation will retry:', paymentErr);
      res.status(200).json(ACK);
    }
  );
};

// Public endpoint (no JWT). Mounted at /callback/:secret behind mpesaCallbackGuard.
// Always ack with 200; anything we couldn't finish is picked up by the reconciliation job.
const handleCallback = (req, res) => {
  const callback = req.body && req.body.Body && req.body.Body.stkCallback;
  if (!callback) return res.status(400).json({ message: 'Malformed callback payload' });

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;
  const success = Number(ResultCode) === 0;

  let mpesaReceipt = null;
  let amountPaid = null;
  if (success && CallbackMetadata && Array.isArray(CallbackMetadata.Item)) {
    const items = CallbackMetadata.Item;
    mpesaReceipt = (items.find((i) => i.Name === 'MpesaReceiptNumber') || {}).Value || null;
    amountPaid = (items.find((i) => i.Name === 'Amount') || {}).Value || null;
  }

  const settle = () => {
    settleWithRetry(
      CheckoutRequestID,
      {
        status: success ? 'success' : 'failed',
        mpesa_receipt: mpesaReceipt,
        result_desc: ResultDesc,
        raw_callback: req.body,
      },
      0,
      (err, transaction) => {
        if (err) {
          console.error('Failed to settle M-Pesa transaction, reconciliation will retry:', err);
          return res.status(200).json(ACK);
        }
        if (!success || !transaction) return res.status(200).json(ACK);
        creditBill(transaction, amountPaid, mpesaReceipt, res);
      }
    );
  };

  if (!success || !shouldVerifyCallback()) return settle();

  // Callbacks are unsigned, so ask Safaricom whether this payment really succeeded.
  // If the check fails or can't be completed, leave the row 'pending'; the reconciliation
  // job will settle it from Safaricom's answer.
  queryStkStatus(CheckoutRequestID, (queryErr, result) => {
    if (queryErr || !result || String(result.ResultCode) !== '0') {
      console.warn(`M-Pesa callback for ${CheckoutRequestID} not confirmed by Safaricom; deferring`, queryErr || result);
      return res.status(200).json(ACK);
    }
    settle();
  });
};

const checkStatus = (req, res, next) => {
  findByCheckoutRequestId(req.params.checkoutRequestId, (findErr, transaction) => {
    if (findErr) return next(findErr);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    findBillById(transaction.bill_id, (billErr, bill) => {
      if (billErr) return next(billErr);
      if (!bill) return res.status(404).json({ message: 'Bill not found' });
      if (!canAccessBill(req.user, bill)) {
        return res.status(403).json({ message: 'You do not have permission to access this resource' });
      }
      res.json(transaction);
    });
  });
};

const getTransactionsByBill = (req, res, next) => {
  findBillById(req.params.billId, (billErr, bill) => {
    if (billErr) return next(billErr);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (!canAccessBill(req.user, bill)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource' });
    }

    findTransactionsByBill(req.params.billId, (err, transactions) => {
      if (err) return next(err);
      res.json(transactions);
    });
  });
};

module.exports = { initiatePayment, handleCallback, checkStatus, getTransactionsByBill };