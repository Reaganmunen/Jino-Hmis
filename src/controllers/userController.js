const bcrypt = require('bcrypt');
const {
  findUserById, findUsersByRole, updateUser, updatePassword, softDeleteUser,
} = require('../models/userModel');

const getUser = (req, res, next) => {
  findUserById(req.params.id, (err, user) => {
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

module.exports = { getUser, getUsersByRole, updateUserDetails, changePassword, deactivateUser };