const express = require('express');
const router = express.Router();
const { getHistoryByClaim, annotateHistory } = require('../controllers/claimStatusHistoryController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin', 'receptionist'));

router.get('/claim/:claimId', getHistoryByClaim);
router.put('/claim/:claimId/annotate', annotateHistory);

module.exports = router;