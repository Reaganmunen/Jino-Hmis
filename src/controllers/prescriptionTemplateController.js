const {
  findTemplatesByDentist, createTemplate, deleteTemplate,
} = require('../models/prescriptionTemplateModel');

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// GET /prescription-templates — the logged-in dentist's own saved templates.
const getTemplates = (req, res, next) => {
  findTemplatesByDentist(req.user.id, (err, templates) => {
    if (err) return next(err);
    res.json(templates);
  });
};

// POST /prescription-templates
const addTemplate = (req, res, next) => {
  const body = req.body || {};
  const name = clean(body.name, 80);
  const drug_name = clean(body.drug_name, 200);
  const dosage = clean(body.dosage, 200);
  const frequency = clean(body.frequency, 200);
  const duration = clean(body.duration, 200);
  const notes = clean(body.notes, 1000);

  if (!name || !drug_name || !dosage || !frequency || !duration) {
    return res.status(400).json({ message: 'name, drug_name, dosage, frequency, and duration are required' });
  }

  createTemplate(
    { dentist_id: req.user.id, name, drug_name, dosage, frequency, duration, notes },
    (err, template) => {
      if (err) {
        if (err.code === '23505') {
          return res.status(409).json({ message: 'You already have a template with that name.' });
        }
        return next(err);
      }
      res.status(201).json(template);
    },
  );
};

// DELETE /prescription-templates/:id
const removeTemplate = (req, res, next) => {
  deleteTemplate(req.params.id, req.user.id, (err, rowCount) => {
    if (err) {
      if (err.code === '22P02') return res.status(404).json({ message: 'Template not found' }); // malformed id
      return next(err);
    }
    if (!rowCount) return res.status(404).json({ message: 'Template not found' });
    res.json({ message: 'Template deleted' });
  });
};

module.exports = { getTemplates, addTemplate, removeTemplate };
