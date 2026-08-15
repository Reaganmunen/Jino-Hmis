const {
  createScheduleSlot, findScheduleByDentist, updateScheduleSlot, deleteScheduleSlot,
} = require('../models/dentistScheduleModel');

const addSlot = (req, res, next) => {
  createScheduleSlot(req.body, (err, slot) => {
    if (err) return next(err);
    res.status(201).json(slot);
  });
};

const getDentistSchedule = (req, res, next) => {
  findScheduleByDentist(req.params.dentistId, (err, slots) => {
    if (err) return next(err);
    res.json(slots);
  });
};

const editSlot = (req, res, next) => {
  updateScheduleSlot(req.params.id, req.body, (err, slot) => {
    if (err) return next(err);
    if (!slot) return res.status(404).json({ message: 'Schedule slot not found' });
    res.json(slot);
  });
};

const removeSlot = (req, res, next) => {
  deleteScheduleSlot(req.params.id, (err, rowCount) => {
    if (err) return next(err);
    if (!rowCount) return res.status(404).json({ message: 'Schedule slot not found' });
    res.json({ message: 'Schedule slot removed' });
  });
};

module.exports = { addSlot, getDentistSchedule, editSlot, removeSlot };