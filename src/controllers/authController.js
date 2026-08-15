const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createUser, findUserByEmail, findUserById } = require('../models/userModel');
const { createPatient } = require('../models/patientModel');

const SALT_ROUNDS = 10;

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
};

// Staff registration (admin, dentist, receptionist). Patient self-registration is separate below.
const register = (req, res, next) => {
  const { role, first_name, last_name, email, phone, password } = req.body;

  if (!role || !first_name || !last_name || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (role === 'patient') {
    return res.status(400).json({ message: 'Use /auth/register-patient for patient sign-up' });
  }

  findUserByEmail(email, (err, existing) => {
    if (err) return next(err);
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    bcrypt.hash(password, SALT_ROUNDS, (hashErr, password_hash) => {
      if (hashErr) return next(hashErr);

      createUser({ role, first_name, last_name, email, phone, password_hash }, (createErr, user) => {
        if (createErr) return next(createErr);
        res.status(201).json({ user, token: generateToken(user) });
      });
    });
  });
};

// Creates a User (role: patient) AND its linked Patient record in one flow.
const registerPatient = (req, res, next) => {
  const {
    first_name, last_name, email, phone, password,
    date_of_birth, national_id, address, next_of_kin_name, next_of_kin_phone,
  } = req.body;

  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  findUserByEmail(email, (err, existing) => {
    if (err) return next(err);
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    bcrypt.hash(password, SALT_ROUNDS, (hashErr, password_hash) => {
      if (hashErr) return next(hashErr);

      createUser({ role: 'patient', first_name, last_name, email, phone, password_hash }, (userErr, user) => {
        if (userErr) return next(userErr);

        createPatient({
          user_id: user.id, first_name, last_name, date_of_birth, national_id,
          phone, email, address, next_of_kin_name, next_of_kin_phone,
        }, (patientErr, patient) => {
          if (patientErr) return next(patientErr);
          res.status(201).json({ user, patient, token: generateToken(user) });
        });
      });
    });
  });
};

const login = (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  findUserByEmail(email, (err, user) => {
    if (err) return next(err);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    bcrypt.compare(password, user.password_hash, (compareErr, isMatch) => {
      if (compareErr) return next(compareErr);
      if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

      delete user.password_hash;
      res.json({ user, token: generateToken(user) });
    });
  });
};

const getMe = (req, res, next) => {
  findUserById(req.user.id, (err, user) => {
    if (err) return next(err);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });
};

module.exports = { register, registerPatient, login, getMe };