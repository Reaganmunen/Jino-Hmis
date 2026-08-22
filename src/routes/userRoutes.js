const express = require('express');
const router = express.Router();
const {
  getUser, getOwnProfile, getUsersByRole, updateUserDetails, changePassword, updateOwnPhoto, deactivateUser,
} = require('../controllers/userController');
const verifyToken = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

router.use(verifyToken);

// Any authenticated user (patients included) can see the dentist list — needed for booking.
router.get('/dentists', (req, res, next) => {
  req.params.role = 'dentist';
  getUsersByRole(req, res, next);
});

router.get('/me', getOwnProfile); // any authenticated user fetches their own record
router.get('/role/:role', authorizeRoles('admin'), getUsersByRole);
router.get('/:id', authorizeRoles('admin'), getUser);
router.put('/:id', authorizeRoles('admin'), updateUserDetails);
router.put('/me/password', changePassword); // any authenticated user changes their own password
router.put('/me/photo', updateOwnPhoto);     // any authenticated user changes their own avatar
router.delete('/:id', authorizeRoles('admin'), deactivateUser);

module.exports = router;