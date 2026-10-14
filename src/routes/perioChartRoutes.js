const express = require('express');
const router = express.Router();
const {
  getByPatient, getOne, create, update, finalise, remove,
} = require('../controllers/perioChartController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Periodontal charts are private clinical records: dentists and admins can read
// them; only dentists can write. Edit / finalise / delete of a draft is further
// limited to the dentist who started it, inside the controller.
router.use(authorizeRoles('admin', 'dentist'));

router.get('/patient/:patientId', getByPatient);
router.post('/patient/:patientId', authorizeRoles('dentist'), create);

router.get('/:id', getOne);
router.put('/:id', authorizeRoles('dentist'), update);
router.post('/:id/finalise', authorizeRoles('dentist'), finalise);
router.delete('/:id', authorizeRoles('dentist'), remove);

module.exports = router;