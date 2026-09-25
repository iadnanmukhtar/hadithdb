'use strict';
const Shares = require('../lib/NotebookShare');
const readerVersion = require('crypto').createHash('sha256').update(require('fs').readFileSync(require.resolve('../public/static/js/notebook-shared-reader.js'))).digest('hex').slice(0, 12);
module.exports = async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  try {
    const note = await Shares.read(req.params.token);
    res.render('notebook_shared', { note, unavailable: false, readerVersion });
  } catch (err) {
    const missing = err.status === 404;
    res.status(missing ? 404 : 503).render('notebook_shared', { note: null, unavailable: true,
      message: missing ? 'This link has been removed or the note is no longer available.' : 'This note is temporarily unavailable. Please try again later.' });
  }
};
