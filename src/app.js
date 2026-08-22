const express = require('express');
const path = require('path');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { generalLimiter } = require('./middleware/rateLimiter');
const mainRoutes = require('./routes/mainRoutes');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend assets without API rate limiting
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate-limit API requests only
app.use('/api', generalLimiter);

// API routes
app.use('/api', mainRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;