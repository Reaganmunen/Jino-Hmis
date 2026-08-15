const { createInsuranceProvider, listInsuranceProviders } = require('../models/insuranceProviderModel');

const addProvider = (req, res, next) => {
  createInsuranceProvider(req.body, (err, provider) => {
    if (err) return next(err);
    res.status(201).json(provider);
  });
};

const getAllProviders = (req, res, next) => {
  listInsuranceProviders((err, providers) => {
    if (err) return next(err);
    res.json(providers);
  });
};

module.exports = { addProvider, getAllProviders };