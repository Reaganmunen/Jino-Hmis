const { initiateStkPush } = require('../services/mpesaService');
const {
  createMpesaTransaction, findByCheckoutRequestId, updateMpesaTransactionResult, findTransactionsByBill,
} = require('../models/mpesaTransactionModel');
const { recordPayment } = require('../models/paymentModel');
const { findBillById } = require('../models/billModel');

// Patient/receptionist triggers this from the billing screen to prompt the
// patient's phone for payment. Route this through middleware/rateLimiter's
// mpesaInitiateLimiter to stop repeated STK prompts to one number.
const initiatePayment = (req, res, next) => {
  const { bill_id, phone, amount } = req.body;
  if (!bill_id || !phone || !amount) {
    return res.status(400).json({ message: 'bill_id, phone, and amount are required' });
  }

  findBillById(bill_id, (billErr, bill) => {
    if (billErr) return next(billErr);
    if (!bill) return res.status(404).json({ message: 'Bill not found' });

    initiateStkPush(
      { phone, amount, accountReference: bill_id, transactionDesc: `Bill ${bill_id}` },
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

const checkStatus = (req, res, next) => {
  findByCheckoutRequestId(req.params.checkoutRequestId, (err, transaction) => {
    if (err) return next(err);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    res.json(transaction);
  });
};

const getTransactionsByBill = (req, res, next) => {
  findTransactionsByBill(req.params.billId, (err, transactions) => {
    if (err) return next(err);
    res.json(transactions);
  });
};

module.exports = { initiatePayment, handleCallback, checkStatus, getTransactionsByBill };