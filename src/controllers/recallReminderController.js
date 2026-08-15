const {
  createRecallReminder, findDueReminders, findRemindersByPatient, markReminderSent,
} = require('../models/recallReminderModel');

const addReminder = (req, res, next) => {
  createRecallReminder(req.body, (err, reminder) => {
    if (err) return next(err);
    res.status(201).json(reminder);
  });
};

// Intended to be called by a scheduled job (node-cron) hitting this internally,
// or exposed to an admin dashboard. ?by=2026-08-17 defaults to today.
const getDue = (req, res, next) => {
  const byDate = req.query.by || new Date().toISOString().slice(0, 10);
  findDueReminders(byDate, (err, reminders) => {
    if (err) return next(err);
    res.json(reminders);
  });
};

const getPatientReminders = (req, res, next) => {
  findRemindersByPatient(req.params.patientId, (err, reminders) => {
    if (err) return next(err);
    res.json(reminders);
  });
};

// Called after the SMS/email actually goes out (e.g. by the cron job, post Africa's Talking send)
const markSent = (req, res, next) => {
  markReminderSent(req.params.id, (err, reminder) => {
    if (err) return next(err);
    if (!reminder) return res.status(404).json({ message: 'Reminder not found' });
    res.json(reminder);
  });
};

module.exports = { addReminder, getDue, getPatientReminders, markSent };