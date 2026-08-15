const { createService, listServices, findServiceById, updateService } = require('../models/serviceModel');

const addService = (req, res, next) => {
  createService(req.body, (err, service) => {
    if (err) return next(err);
    res.status(201).json(service);
  });
};

const getAllServices = (req, res, next) => {
  listServices((err, services) => {
    if (err) return next(err);
    res.json(services);
  });
};

const getService = (req, res, next) => {
  findServiceById(req.params.id, (err, service) => {
    if (err) return next(err);
    if (!service) return res.status(404).json({ message: 'Service not found' });
    res.json(service);
  });
};

const editService = (req, res, next) => {
  updateService(req.params.id, req.body, (err, service) => {
    if (err) return next(err);
    if (!service) return res.status(404).json({ message: 'Service not found' });
    res.json(service);
  });
};

module.exports = { addService, getAllServices, getService, editService };