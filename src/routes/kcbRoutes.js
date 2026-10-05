const express = require('express');
const router = express.Router();
const { initiatePayment, handleCallback } = require('../controllers/kcbController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { mpesaInitiateLimiter } = require('../middleware/rateLimiter');

// Public — KCB calls this directly, it can't send a JWT. Must stay outside verifyToken.
router.post('/callback', handleCallback);

// Status polling and per-bill history reuse /api/mpesa/status/:id and /api/mpesa/bill/:id.
router.post('/initiate', verifyToken, mpesaInitiateLimiter, authorizeRoles('admin', 'receptionist', 'patient'), initiatePayment);

module.exports = router;