const express = require('express');
const router = express.Router();
const { recordUsage, getUsageByAppointment, getUsageByItem } = require('../controllers/inventoryUsageController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'dentist'));

router.post('/', recordUsage); // transactional: logs usage + decrements stock together
router.get('/appointment/:appointmentId', getUsageByAppointment);
router.get('/item/:itemId', getUsageByItem);

module.exports = router;