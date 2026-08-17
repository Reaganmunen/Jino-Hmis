const express = require('express');
const router = express.Router();
const { uploadFile, getPatientFiles, removeFile } = require('../controllers/patientFileController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles, allowSelfOrStaff } = require('../middleware/roleMiddleware');

router.use(verifyToken);

const STAFF = ['admin', 'dentist', 'receptionist'];

// Plug your multer (or other upload) middleware in before uploadFile once storage is decided,
// e.g. router.post('/', upload.single('file'), authorizeRoles(...), uploadFile);
router.post('/', authorizeRoles('admin', 'dentist', 'receptionist', 'patient'), uploadFile);
router.get(
  '/patient/:patientId',
  allowSelfOrStaff(STAFF, (req) => req.params.patientId),
  getPatientFiles,
);
router.delete('/:id', authorizeRoles('admin', 'dentist'), removeFile);

module.exports = router;