// 404 handler — place after all routes, before errorHandler
const notFound = (req, res, next) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

// Central error handler — place last, after all other app.use()/routes.
// Pass errors here via next(err) instead of handling them inline in controllers.
const errorHandler = (err, req, res, next) => {
  console.error(err);

  // Postgres unique_violation
  if (err.code === '23505') {
    return res.status(409).json({ message: 'A record with that value already exists' });
  }

  // Postgres foreign_key_violation
  if (err.code === '23503') {
    return res.status(400).json({ message: 'Referenced record does not exist' });
  }

  // Postgres exclusion_violation (e.g. overlapping dentist appointment)
  if (err.code === '23P01') {
    return res.status(409).json({ message: 'This time slot conflicts with an existing appointment' });
  }

  // Postgres check_violation
  if (err.code === '23514') {
    return res.status(400).json({ message: 'Invalid data submitted' });
  }

  const statusCode = err.statusCode && err.statusCode !== 200 ? err.statusCode : 500;
  res.status(statusCode).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };