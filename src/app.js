const express = require('express');
const path = require('path');

const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const { generalLimiter } = require('./middleware/rateLimiter');
const mainRoutes = require('./routes/mainRoutes');
const { brandedPage } = require('./config/branding');

const app = express();

// Render puts one reverse proxy in front of the app. Trust exactly that hop so req.ip is the
// real client IP. Without this every user shares the proxy's IP, so the rate limiters count
// ALL users together (login: 10 per 15 min, API: 120 per minute) instead of one user at a time.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Login and sign-up pages carry this clinic's branding (colours, logo, name) from BRAND_* env
// vars. Must come before express.static so these routes win over the plain files.
app.get('/login.html', brandedPage('login.html'));
app.get('/register.html', brandedPage('register.html'));

// Serve frontend assets without API rate limiting
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate-limit API requests only
app.use('/api', generalLimiter);

// API routes
app.use('/api', mainRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;