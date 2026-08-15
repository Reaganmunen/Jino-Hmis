const express = require('express');
const router = express.Router();
const { initiatePayment, handleCallback, checkStatus, getTransactionsByBill } = require('../controllers/mpesaController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { mpesaInitiateLimiter } = require('../middleware/rateLimiter');

// Public — Safaricom calls this directly, it can't send a JWT. Must stay outside verifyToken.
router.post('/callback', handleCallback);

// Everything else requires auth
router.post('/initiate', verifyToken, mpesaInitiateLimiter, authorizeRoles('admin', 'receptionist', 'patient'), initiatePayment);
router.get('/status/:checkoutRequestId', verifyToken, checkStatus);
router.get('/bill/:billId', verifyToken, getTransactionsByBill);

module.exports = router;