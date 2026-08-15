const rateLimit = require('express-rate-limit');

// Tight limit on login/register — blunts brute-force and credential stuffing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limit STK push initiation per IP — prevents someone spamming a patient's phone
const mpesaInitiateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: { message: 'Too many payment attempts. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Looser general API limiter — safety net against runaway scripts/loops
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, mpesaInitiateLimiter, generalLimiter };