const { validationResult } = require('express-validator');

// Drop this after any express-validator chain in a route to short-circuit on bad input.
// Usage:
//   const { body } = require('express-validator');
//   router.post('/patients', [
//     body('first_name').notEmpty(),
//     body('national_id').optional().isLength({ min: 5 }),
//   ], validateRequest, createPatient);
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }
  next();
};

module.exports = validateRequest;