const { initiateStkPush } = require('../services/mpesaService');
const {
  createMpesaTransaction, findByCheckoutRequestId, updateMpesaTransactionResult, findTransactionsByBill,
} = require('../models/mpesaTransactionModel');
const { recordPayment } = require('../models/paymentModel');
const { findBillById } = require('../models/billModel');

const STAFF = ['admin', 'dentist', 'receptionist'];

// Same ownership rule used by billController/billItemController — kept local
// here rather than shared to avoid a cross-controller import cycle.
const canAccessBill = (user, bill) => {
  if (STAFF.includes(user.role)) return true;
  if (user.role === 'patient') return user.patient_id === bill.patient_id;
  return false;
};

// Daraja's AccountReference field is capped at 12 characters. Bill.id is a
// UUID (36 chars), which Safaricom will reject outright, so this strips the
// dashes and takes the first 12 hex chars. It's only ever shown to Safaricom
// / the payer's statement — reconciliation on our side keys off
// checkout_request_id (see handleCallback/checkStatus), never this value —
// so a truncated, non-unique reference is fine here.
const shortBillReference = (billId) => String(billId).replace(/-/g, '').slice(0, 12).toUpperCase();

// Patient/receptionist triggers this from the billing screen to prompt the
// patient's phone for payment. Route this through middleware/rateLimiter's
// mpesaInitiateLimiter to stop repeated STK prompts to one number.
const initiatePayment = (req, res, next) => {
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
      return res.status(400).json({
        message: `Amount exceeds balance due (KES ${balanceDue.toFixed(2)})`,
      });
    }

    initiateStkPush(
      { phone, amount, accountReference: shortBillReference(bill_id), transactionDesc: `Bill ${bill_id}` },
      (stkErr, stkResponse) => {
        if (stkErr) {
          return res.status(502).json({ message: 'Failed to initiate M-Pesa payment', detail: stkErr });
        }

        createMpesaTransaction(
          {
            bill_id,
            phone,
            amount,
            checkout_request_id: stkResponse.CheckoutRequestID,
            merchant_request_id: stkResponse.MerchantRequestID,
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

// Public endpoint (no JWT) — Safaricom calls this directly. Register it as
// MPESA_CALLBACK_URL and keep it OUT of the verifyToken middleware chain.
const handleCallback = (req, res, next) => {
  const callback = req.body.Body && req.body.Body.stkCallback;
  if (!callback) return res.status(400).json({ message: 'Malformed callback payload' });

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;
  const success = ResultCode === 0;

  let mpesaReceipt = null;
  let amountPaid = null;
  if (success && CallbackMetadata && CallbackMetadata.Item) {
    const items = CallbackMetadata.Item;
    mpesaReceipt = (items.find((i) => i.Name === 'MpesaReceiptNumber') || {}).Value || null;
    amountPaid = (items.find((i) => i.Name === 'Amount') || {}).Value || null;
  }

  updateMpesaTransactionResult(
    CheckoutRequestID,
    {
      status: success ? 'success' : 'failed',
      mpesa_receipt: mpesaReceipt,
      result_desc: ResultDesc,
      raw_callback: req.body,
    },
    (updateErr, transaction) => {
      if (updateErr) {
        console.error(updateErr);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // ack anyway, Safaricom retries otherwise
      }

      if (!success || !transaction) {
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
      }

      // Successful payment — record it against the Bill (trigger updates amount_paid/status)
      recordPayment(
        {
          bill_id: transaction.bill_id,
          amount: amountPaid || transaction.amount,
          method: 'mpesa',
          reference: mpesaReceipt,
          received_by: null,
        },
        (paymentErr) => {
          if (paymentErr) console.error(paymentErr);
          res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }
      );
    }
  );
};

// Transaction carries no patient_id of its own — ownership resolves through
// the parent Bill, same pattern as billItemController.getItemsByBill.
const checkStatus = (req, res, next) => {
  findByCheckoutRequestId(req.params.checkoutRequestId, (findErr, transaction) => {
    if (findErr) return next(findErr);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    findBillById(transaction.bill_id, (billErr, bill) => {
      if (billErr) return next(billErr);
      // Bill missing/void shouldn't hide a transaction status check from staff,
      // but a missing bill means we can't confirm ownership for a patient caller.
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