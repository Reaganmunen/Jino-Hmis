const { findHistoryByClaim, annotateLatestHistoryEntry } = require('../models/claimStatusHistoryModel');

const getHistoryByClaim = (req, res, next) => {
  findHistoryByClaim(req.params.claimId, (err, history) => {
    if (err) return next(err);
    res.json(history);
  });
};

// Optional: attach a note/who-changed-it to the latest auto-created history row
const annotateHistory = (req, res, next) => {
  const { notes } = req.body;
  annotateLatestHistoryEntry(req.params.claimId, req.user.id, notes, (err, entry) => {
    if (err) return next(err);
    if (!entry) return res.status(404).json({ message: 'No history entry found for this claim' });
    res.json(entry);
  });
};

module.exports = { getHistoryByClaim, annotateHistory };