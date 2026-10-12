const puppeteer = require('puppeteer');

const generatePdf = async (html) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Render's containers give Chromium a tiny /dev/shm (~64MB) by
        // default. Without this flag Chromium tries to use shared memory
        // for tab rendering, the renderer process crashes mid-render, and
        // page.pdf() throws — this is the #1 cause of Puppeteer failing
        // silently (or corruptly) in Render/Docker/Heroku containers.
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    const page = await browser.newPage();
    // Don't wait for "network idle": if the logo URL (or anything else the
    // page requests) is slow or unreachable from Render, networkidle0 hangs
    // until the 30s timeout and the whole PDF fails. Load the HTML itself,
    // then give images a short, capped window to finish, and print anyway.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await Promise.race([
      page.evaluate(() => Promise.all(
        Array.from(document.images).map((img) => (img.complete
          ? null
          : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }))),
      )),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
    // Newer Puppeteer versions can return a plain Uint8Array here instead of
    // a true Node Buffer. Express's res.send() checks Buffer.isBuffer() —
    // if that check fails, it silently falls back to res.json(), which
    // JSON.stringify()'s the typed array into {"0":37,"1":80,...} instead
    // of sending raw PDF bytes. Buffer.from() is a no-op if it's already a
    // real Buffer, and guarantees res.send() treats it as binary either way.
    return Buffer.from(pdfBytes);
  } finally {
    // Always close, even if setContent/pdf() throws — otherwise a failed
    // render leaks a zombie Chromium process, which on Render's low-memory
    // tiers compounds into every subsequent PDF request failing too.
    if (browser) await browser.close();
  }
};

// Shared response helper — every PDF download route does the same three
// things (set headers, send buffer, handle failure), so this keeps that
// logic in one place instead of repeated per controller.
const sendPdf = async (res, next, { html, filename }) => {
  try {
    const buffer = await generatePdf(html);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  } catch (err) {
    // Log the real Puppeteer failure server-side (Render logs) — otherwise
    // it's indistinguishable from every other error once it hits a generic
    // error handler, and the frontend just silently downloads whatever
    // that handler returns as if it were the PDF.
    console.error('PDF generation failed:', err);
    next(err);
  }
};

module.exports = { generatePdf, sendPdf };