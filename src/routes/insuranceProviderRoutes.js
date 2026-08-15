const express = require('express');
const router = express.Router();
const { addProvider, getAllProviders } = require('../controllers/insuranceProviderController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.get('/', authorizeRoles('admin', 'receptionist'), getAllProviders);
router.post('/', authorizeRoles('admin'), addProvider);

module.exports = router;