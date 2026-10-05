const crypto = require('crypto');
const { initiateStkPush, isConfigured } = require('../services/kcbBuniService');
const {
  createProviderTransaction, settleTransactionIfPending,
} = require('../models/mpesaTransactionModel');
const { recordPayment } = require('../models/paymentModel');
const { findBillById } = require('../models/billModel');

// KCB Buni STK push. Transactions live in the same "MpesaTransaction" table as the
// Daraja ones (provider = 'kcb'), so /api/mpesa/status/:id and /api/mpesa/bill/:id
// and the existing polling UI work for both without changes.

const STAFF = ['admin', 'dentist', 'receptionist'];

const canAccessBill = (user, bill) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === bill.patient_id;
  return false;
};

const shortBillReference = (billId) => String(billId).replace(/-/g, '').slice(0, 12).toUpperCase();

const initiatePayment = (req, res, next) => {
  if (!isConfigured()) {
    return res.status(503).json({ message: 'KCB payments are not configured on this server' });
  }

  const { bill_id, phone, amount } = req.body;
  if (!bill_id || !phone || !amount) {
    return res.status(400).json({ message: 'bill_id, phone, and amount are required' });
  }
  if (Number(amount) <= 0) {
    return res.status(400).json({ message: 'amount must be greater than 0' });
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
    if (Number(amount) > balanceDue) {
      return res.status(400).json({ message: `Amount exceeds balance due (KES ${balanceDue.toFixed(2)})` });
    }

    // Shared short code: invoiceNumber is the KCB account the money settles into.
    // Own paybill (KCB_SHARED_SHORTCODE=false) without KCB_INVOICE_NUMBER: fall back to a bill reference.
    const invoiceNumber = process.env.KCB_INVOICE_NUMBER || shortBillReference(bill_id);

    initiateStkPush(
      { phone, amount, invoiceNumber, transactionDescription: 'Clinic bill' },
      (stkErr, stk) => {
        if (stkErr) {
          console.error('KCB STK push failed:', JSON.stringify(stkErr));
          return res.status(502).json({
            message: 'Failed to initiate KCB payment',
            detail: stkErr.message || undefined,
          });
        }

        createProviderTransaction(
          {
            bill_id,
            phone,
            amount,
            checkout_request_id: stk.CheckoutRequestID,
            merchant_request_id: stk.MerchantRequestID,
            provider: 'kcb',
          },
          (dbErr, transaction) => {
            if (dbErr) return next(dbErr);
            res.status(201).json({
              message: 'STK push sent. Ask the patient to check their phone.',
              transaction,
            });
          }
        );
      }
    );
  });
};

// Pulls the fields we need out of the callback. Buni forwards the standard M-Pesa
// shape (Body.stkCallback); the fallbacks tolerate a flattened variant.
const parseCallback = (body) => {
  const cb = (body && body.Body && body.Body.stkCallback) || (body && body.stkCallback) || body || {};
  const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
  const pick = (name) => (items.find((i) => i.Name === name) || {}).Value;

  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    receipt: pick('MpesaReceiptNumber') || null,
    amount: pick('Amount') || null,
  };
};

const secretMatches = (provided) => {
  const expected = process.env.KCB_CALLBACK_SECRET;
  if (!expected) return true; // not enforced until a secret is configured
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Public endpoint (no JWT) — KCB calls this. Keep it OUT of verifyToken.
const handleCallback = (req, res) => {
  const ack = () => res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  if (!secretMatches(req.query.token)) {
    return res.status(401).json({ message: 'Invalid callback token' });
  }

  const parsed = parseCallback(req.body);
  if (!parsed.checkoutRequestId || parsed.resultCode === undefined) {
    console.warn('KCB callback not recognised:', JSON.stringify(req.body));
    return ack(); // acknowledge so KCB doesn't keep retrying a payload we can't use
  }

  const success = Number(parsed.resultCode) === 0;

  // Only the first callback for a pending transaction wins, so a KCB retry can't record the payment twice.
  settleTransactionIfPending(
    parsed.checkoutRequestId,
    {
      status: success ? 'success' : 'failed',
      mpesa_receipt: parsed.receipt,
      result_desc: parsed.resultDesc,
      raw_callback: req.body,
    },
    (err, transaction) => {
      if (err) {
        console.error('KCB callback DB error:', err);
        return ack();
      }
      if (!transaction || !success) return ack();

      if (parsed.amount && Number(parsed.amount) !== Number(transaction.amount)) {
        console.warn(`KCB amount mismatch on ${parsed.checkoutRequestId}: requested ${transaction.amount}, paid ${parsed.amount}`);
      }

      recordPayment(
        {
          bill_id: transaction.bill_id,
          amount: parsed.amount || transaction.amount,
          method: 'mpesa', // paid through M-Pesa; the Payment.method list is unchanged
          reference: parsed.receipt,
          received_by: null,
        },
        (paymentErr) => {
          if (paymentErr) console.error('KCB recordPayment failed:', paymentErr);
          ack();
        }
      );
    }
  );
};

module.exports = { initiatePayment, handleCallback, parseCallback };