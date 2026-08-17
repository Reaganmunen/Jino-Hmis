const {
  createScheduleSlot, findScheduleByDentist, findScheduleSlotById, updateScheduleSlot, deleteScheduleSlot,
} = require('../models/dentistScheduleModel');

// A dentist creating their own availability can't be trusted to submit
// someone else's dentist_id — resolved server-side the same way
// bookAppointment resolves booked_by. Admins may still set it explicitly
// (e.g. setting up a new dentist's schedule on their behalf).
const addSlot = (req, res, next) => {
  const dentist_id = req.user.role === 'dentist' ? req.user.id : req.body.dentist_id;
  createScheduleSlot({ ...req.body, dentist_id }, (err, slot) => {
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
  findScheduleSlotById(req.params.id, (findErr, slot) => {
    if (findErr) return next(findErr);
    if (!slot) return res.status(404).json({ message: 'Schedule slot not found' });
    if (req.user.role === 'dentist' && slot.dentist_id !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }

    updateScheduleSlot(req.params.id, req.body, (err, updated) => {
      if (err) return next(err);
      res.json(updated);
    });
  });
};

const removeSlot = (req, res, next) => {
  findScheduleSlotById(req.params.id, (findErr, slot) => {
    if (findErr) return next(findErr);
    if (!slot) return res.status(404).json({ message: 'Schedule slot not found' });
    if (req.user.role === 'dentist' && slot.dentist_id !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to modify this resource' });
    }

    deleteScheduleSlot(req.params.id, (err, rowCount) => {
      if (err) return next(err);
      if (!rowCount) return res.status(404).json({ message: 'Schedule slot not found' });
      res.json({ message: 'Schedule slot removed' });
    });
  });
};

module.exports = { addSlot, getDentistSchedule, editSlot, removeSlot };