const jwt = require('jsonwebtoken');
const { findUserById } = require('../models/userModel');

// Verifies the JWT from the Authorization header and attaches the user to req.user.
// Expects: Authorization: Bearer <token>
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token expired' });
      }
      return res.status(401).json({ message: 'Invalid token' });
    }

    findUserById(decoded.id, (dbErr, user) => {
      if (dbErr) return next(dbErr);
      if (!user || !user.is_active) {
        return res.status(401).json({ message: 'Account not found or inactive' });
      }

      req.user = user; // { id, role, first_name, last_name, email, phone, is_active }
      next();
    });
  });
};

module.exports = verifyToken;