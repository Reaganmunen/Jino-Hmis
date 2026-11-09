// Per-clinic branding for the login and sign-up pages.
//
// Every clinic runs the same code from the same repo. What makes a deployment look like
// "its" clinic is environment variables, set in that deployment's dashboard (and in your
// local .env), so no client's logo or colours ever need to be committed to GitHub.
//
// With NO BRAND_* variables set, login.html / register.html render exactly as they always
// have (Jino colours and logo), so existing clinics are unaffected.
//
//   BRAND_NAME         Clinic name. Used in the page title and the logo's alt text.
//   BRAND_PRIMARY      Dark brand colour, hex (#004143). Left panel, headings, labels.
//   BRAND_ACCENT       Accent colour, hex (#98532a). Buttons, links, focus ring, highlights.
//   BRAND_LOGO_URL     Logo for the dark left panel, so use the white/light version.
//                      Absolute https:// URL, or a path such as /assets/brand/logo.png.
//   BRAND_LOGO_HEIGHT  Optional. Logo height in px on desktop (default 72).
//   BRAND_FAVICON_URL  Optional. Browser-tab icon (PNG).
//
// Note: in a .env file, quote hex colours (BRAND_PRIMARY="#004143"). An unquoted # starts a
// comment and the value comes through empty. On Render/Vercel dashboards no quotes are needed.

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// ---------- Reading and validating the env vars ----------

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim();

const readColor = (name) => {
  let v = clean(process.env[name]);
  if (!v) return null;
  if (/^[0-9a-f]{6}$/i.test(v)) v = `#${v}`;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  console.warn(`[branding] ${name}="${v}" is not a 6-digit hex colour (e.g. #004143), ignoring it.`);
  return null;
};

const readUrl = (name) => {
  const v = clean(process.env[name]);
  if (!v) return null;
  if (/^(https?:\/\/|\/)[^\s"'<>]+$/i.test(v)) return v;
  console.warn(`[branding] ${name} must be an https:// URL or a path starting with /, ignoring it.`);
  return null;
};

const logoHeight = parseInt(clean(process.env.BRAND_LOGO_HEIGHT), 10);

const brand = {
  name: clean(process.env.BRAND_NAME) || 'Jino',
  primary: readColor('BRAND_PRIMARY'),
  accent: readColor('BRAND_ACCENT'),
  logoUrl: readUrl('BRAND_LOGO_URL'),
  faviconUrl: readUrl('BRAND_FAVICON_URL'),
  logoHeight: logoHeight > 0 ? logoHeight : 72,
};

// A clinic that has its own colours or logo should not get the seasonal (Christmas, New Year,
// Valentine's) re-colouring or Santa hat on these two pages, so theme.js is left out for them.
const isCustom = Boolean(brand.primary || brand.accent || brand.logoUrl);

// ---------- Colour helpers ----------

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (hex, other, t) => {
  const a = toRgb(hex);
  const b = toRgb(other);
  return toHex(a.map((v, i) => v * (1 - t) + b[i] * t));
};
const tint = (hex, t) => mix(hex, '#ffffff', t); // t = how much white to mix in
const shade = (hex, t) => mix(hex, '#000000', t); // t = how much black to mix in
const rgba = (hex, alpha) => `rgba(${toRgb(hex).join(',')},${alpha})`;

// ---------- The <style> block injected into the pages ----------
// Overrides the CSS variables and the few hard-coded blues in css/auth.css, so auth.css
// itself never changes and every other clinic keeps the default look.

const buildStyle = () => {
  const css = [];

  if (brand.primary || brand.accent) {
    const p = brand.primary || '#0F2440'; // Jino navy, if only an accent was given
    const a = brand.accent || '#2F6FED'; // Jino blue, if only a primary was given
    const warm = tint(a, 0.5); // lighter accent that stays readable on the dark panel

    css.push(`
:root{
  --navy-950:${shade(p, 0.4)};
  --navy-900:${shade(p, 0.15)};
  --navy-800:${p};
  --blue-600:${a};
  --blue-500:${tint(a, 0.15)};
  --blue-100:${tint(a, 0.85)};
  --blue-50:${tint(a, 0.94)};
  --shadow-glass:0 1px 1px rgba(255,255,255,0.7) inset, 0 20px 48px -18px ${rgba(shade(p, 0.4), 0.28)}, 0 4px 14px -6px ${rgba(a, 0.14)};
}
.auth-brand{background:linear-gradient(165deg,${shade(p, 0.35)},${p});}
.auth-brand-body p{color:${tint(p, 0.72)};}
.brand-points li{color:${tint(p, 0.86)};border-top-color:rgba(255,255,255,0.1);}
.brand-points svg path{stroke:${warm};}
.auth-brand-bottom{color:${tint(p, 0.6)};}
.sticker .sticker-ic.blue svg *{stroke:${a};}
.auth-main{background:
  radial-gradient(720px 420px at 88% -6%, ${tint(a, 0.82)}, transparent 60%),
  radial-gradient(620px 380px at -6% 100%, ${tint(p, 0.9)}, transparent 55%),
  linear-gradient(180deg,${tint(a, 0.95)},#FFFFFF 55%);}
.btn-primary{box-shadow:0 6px 16px -6px ${rgba(a, 0.5)};}
.btn-primary:hover{background:${shade(a, 0.14)};}`);
  }

  if (brand.logoUrl) {
    css.push(`
.auth-brand .brand-logo{height:${brand.logoHeight}px;width:auto;border-radius:0;}
@media (max-width:900px){.auth-brand .brand-logo{height:${Math.round(brand.logoHeight * 0.72)}px;}}`);
  }

  return css.length ? `<style id="brand-style">${css.join('\n')}\n</style>` : '';
};

// ---------- Filling in the placeholders in login.html / register.html ----------

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULT_ICON_LINKS = [
  '<link rel="icon" type="image/x-icon" href="favicon.ico">',
  '<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">',
  '<link rel="icon" type="image/png" sizes="16x16" href="assets/favicon-16.png">',
  '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">',
].join('\n');

const customIconLinks = () =>
  `<link rel="icon" type="image/png" href="${escapeHtml(brand.faviconUrl)}">\n` +
  `<link rel="apple-touch-icon" href="${escapeHtml(brand.faviconUrl)}">`;

const placeholders = {
  BRAND_NAME: escapeHtml(brand.name),
  BRAND_LOGO_URL: escapeHtml(brand.logoUrl || 'assets/logo-mark.png'),
  BRAND_ICON_LINKS: brand.faviconUrl ? customIconLinks() : DEFAULT_ICON_LINKS,
  BRAND_THEME_SCRIPT: isCustom ? '' : '<script src="js/theme.js"></script>',
  BRAND_STYLE: buildStyle(),
};

const render = (html) => html.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in placeholders ? placeholders[key] : match));

// Express handler: serves one of the public HTML pages with the branding filled in.
// Mount it BEFORE express.static so it wins over the plain file.
const brandedPage = (fileName) => (req, res, next) => {
  fs.readFile(path.join(PUBLIC_DIR, fileName), 'utf8', (err, html) => {
    if (err) return next(err);
    res.type('html').send(render(html));
  });
};

module.exports = { brand, brandedPage };
