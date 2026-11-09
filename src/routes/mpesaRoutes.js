const express = require('express');
const router = express.Router();
const { initiatePayment, handleCallback, checkStatus, getTransactionsByBill } = require('../controllers/mpesaController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { mpesaInitiateLimiter } = require('../middleware/rateLimiter');
const mpesaCallbackGuard = require('../middleware/mpesaCallbackGuard');

// Public — Safaricom calls this directly, it can't send a JWT. Must stay outside verifyToken.
// The :secret segment must equal MPESA_CALLBACK_SECRET, and MPESA_CALLBACK_URL must end with it.
// Daraja rejects callback URLs containing "mpesa", so register it via the /pay alias in mainRoutes.
router.post('/callback/:secret', mpesaCallbackGuard, handleCallback);

// Everything else requires auth
router.post('/initiate', verifyToken, mpesaInitiateLimiter, authorizeRoles('admin', 'receptionist', 'patient'), initiatePayment);
router.get('/status/:checkoutRequestId', verifyToken, checkStatus);
router.get('/bill/:billId', verifyToken, getTransactionsByBill);

module.exports = router;