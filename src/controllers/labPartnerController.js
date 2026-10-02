const {
  createLabPartner, listLabPartners, updateLabPartner,
} = require('../models/labPartnerModel');

// ?all=true includes deactivated labs (for the management list);
// dropdowns only get active ones.
const getLabPartners = (req, res, next) => {
  const activeOnly = req.query.all !== 'true';
  listLabPartners(activeOnly, (err, labs) => {
    if (err) return next(err);
    res.json(labs);
  });
};

const validate = (body) => {
  if (!body.name || !String(body.name).trim()) return 'name is required';
  if (body.turnaround_days != null && body.turnaround_days !== '') {
    const n = Number(body.turnaround_days);
    if (!Number.isInteger(n) || n < 0 || n > 120) return 'turnaround_days must be a whole number between 0 and 120';
  }
  return null;
};

const addLabPartner = (req, res, next) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ message: problem });

  createLabPartner({ ...req.body, name: req.body.name.trim() }, (err, lab) => {
    if (err) return next(err);
    res.status(201).json(lab);
  });
};

const editLabPartner = (req, res, next) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ message: problem });

  updateLabPartner(req.params.id, { ...req.body, name: req.body.name.trim() }, (err, lab) => {
    if (err) return next(err);
    if (!lab) return res.status(404).json({ message: 'Lab not found' });
    res.json(lab);
  });
};

module.exports = { getLabPartners, addLabPartner, editLabPartner };