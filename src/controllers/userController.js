const bcrypt = require('bcrypt');
const {
  findUserById, findUsersByRole, updateUser, updatePassword, updateProfilePicture, softDeleteUser,
} = require('../models/userModel');

const getUser = (req, res, next) => {
  findUserById(req.params.id, (err, user) => {
    if (err) return next(err);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });
};

// Self-service — any authenticated user fetches their own record
// (includes profile_picture_url, which isn't in the login session payload).
const getOwnProfile = (req, res, next) => {
  findUserById(req.user.id, (err, user) => {
    if (err) return next(err);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });
};

const getUsersByRole = (req, res, next) => {
  findUsersByRole(req.params.role, (err, users) => {
    if (err) return next(err);
    res.json(users);
  });
};

const updateUserDetails = (req, res, next) => {
  updateUser(req.params.id, req.body, (err, user) => {
    if (err) return next(err);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });
};

const changePassword = (req, res, next) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'current_password and new_password are required' });
  }

  findUserById(req.user.id, (err, user) => {
    if (err) return next(err);

    // findUserById excludes password_hash, so re-fetch via email for the compare
    const { findUserByEmail } = require('../models/userModel');
    findUserByEmail(user.email, (fetchErr, fullUser) => {
      if (fetchErr) return next(fetchErr);

      bcrypt.compare(current_password, fullUser.password_hash, (compareErr, isMatch) => {
        if (compareErr) return next(compareErr);
        if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect' });

        bcrypt.hash(new_password, 10, (hashErr, password_hash) => {
          if (hashErr) return next(hashErr);
          updatePassword(req.user.id, password_hash, (updateErr) => {
            if (updateErr) return next(updateErr);
            res.json({ message: 'Password updated successfully' });
          });
        });
      });
    });
  });
};

const deactivateUser = (req, res, next) => {
  softDeleteUser(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deactivated' });
  });
};

// Self-service — any authenticated user updates their own avatar.
const updateOwnPhoto = (req, res, next) => {
  const { profile_picture_url } = req.body;
  if (!profile_picture_url) {
    return res.status(400).json({ message: 'profile_picture_url is required' });
  }
  updateProfilePicture(req.user.id, profile_picture_url, (err, user) => {
    if (err) return next(err);
    res.json(user);
  });
};

module.exports = { getUser, getOwnProfile, getUsersByRole, updateUserDetails, changePassword, updateOwnPhoto, deactivateUser };