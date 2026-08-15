const express = require('express');
const path = require('path');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { generalLimiter } = require('./middleware/rateLimiter');
const mainRoutes = require('./routes/mainRoutes');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// public/ sits one level up from src/, as a sibling — not nested inside it
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', mainRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;