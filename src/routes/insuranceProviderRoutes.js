const express = require('express');
const router = express.Router();
const { addProvider, getAllProviders } = require('../controllers/insuranceProviderController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Patients need this to populate the provider dropdown when starting a claim.
router.get('/', authorizeRoles('admin', 'receptionist', 'patient'), getAllProviders);
router.post('/', authorizeRoles('admin'), addProvider);

module.exports = router;