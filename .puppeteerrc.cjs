const { join } = require('path');

/**
 * Store the downloaded Chrome inside the project folder.
 *
 * By default Puppeteer caches Chrome in /opt/render/.cache/puppeteer, which
 * Render does NOT carry over from the build step to the running service,
 * so Chrome is missing at runtime ("Could not find Chrome").
 * Files inside the project directory are preserved, so we put it there.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};