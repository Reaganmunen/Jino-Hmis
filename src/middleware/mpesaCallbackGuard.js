const crypto = require('crypto');

// Safaricom's published callback source IPs. Verify against the current Daraja docs
// before relying on this, or override with MPESA_ALLOWED_IPS (comma-separated).
const DEFAULT_SAFARICOM_IPS = [
  '196.201.214.200', '196.201.214.206', '196.201.213.114', '196.201.214.207',
  '196.201.214.208', '196.201.213.44', '196.201.212.127', '196.201.212.138',
  '196.201.212.129', '196.201.212.136', '196.201.212.74', '196.201.212.69',
];

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');

// Safaricom does not sign callbacks, so the URL itself carries a secret.
// Wrong secret -> 404 so the endpoint looks like it doesn't exist.
const mpesaCallbackGuard = (req, res, next) => {
  const secret = process.env.MPESA_CALLBACK_SECRET;
  if (!secret) {
    console.error('MPESA_CALLBACK_SECRET is not set; rejecting all M-Pesa callbacks');
    return res.sendStatus(404);
  }
  if (!safeEqual(req.params.secret || '', secret)) return res.sendStatus(404);

  // Optional second layer. Needs app.set('trust proxy', 1) when behind Render/Vercel/nginx,
  // otherwise req.ip is the proxy's address.
  if (process.env.MPESA_CALLBACK_IP_CHECK === 'true') {
    const allowed = process.env.MPESA_ALLOWED_IPS
      ? process.env.MPESA_ALLOWED_IPS.split(',').map((s) => s.trim())
      : DEFAULT_SAFARICOM_IPS;
    if (!allowed.includes(clientIp(req))) {
      console.warn(`M-Pesa callback rejected from IP ${clientIp(req)}`);
      return res.sendStatus(404);
    }
  }
  next();
};

module.exports = mpesaCallbackGuard;