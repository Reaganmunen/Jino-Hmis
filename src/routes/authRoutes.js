const express = require('express');
const router = express.Router();
const { register, registerPatient, login, getMe } = require('../controllers/authController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, verifyToken, authorizeRoles('admin'), register); // staff accounts created by an admin
router.post('/register-patient', authLimiter, registerPatient); // public self sign-up
router.post('/login', authLimiter, login);
router.get('/me', verifyToken, getMe);

module.exports = router;