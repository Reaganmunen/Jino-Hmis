const express = require('express');
const router = express.Router();
const {
  getSummary, getRevenueTrendStat, getTopServicesStat, getWorkload, getSchedule,
} = require('../controllers/statsController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);
router.use(authorizeRoles('admin')); // whole router is admin-only, unlike inventory/bills which share staff roles

router.get('/stats/summary', getSummary);           // ?from=&to=  (today's range)
router.get('/stats/revenue-trend', getRevenueTrendStat); // ?days=30
router.get('/stats/top-services', getTopServicesStat);   // ?limit=5
router.get('/stats/workload', getWorkload);          // ?from=&to=
router.get('/schedule', getSchedule);                // ?from=&to=  (all dentists)

module.exports = router;