const express = require('express');
const router = express.Router();
const { addItem, getPlanItems, setItemStatus } = require('../controllers/treatmentPlanItemController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

router.post('/', authorizeRoles('dentist'), addItem);
router.get('/plan/:planId', getPlanItems);
router.put('/:id/status', authorizeRoles('admin', 'dentist'), setItemStatus);

module.exports = router;