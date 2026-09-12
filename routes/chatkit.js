'use strict';

const router = require('express').Router();

// Retain these routes for cached pages. Never forward to the retired API-funded service.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
router.get('/config', (req, res) => {
  res.json({ enabled: false, configured: false, domainKey: '',
    handoffEnabled: global.settings?.openAI?.chatkit?.enabled === true });
});
router.post('/', (req, res) => {
  res.status(410).json({ error: 'Library chat has moved to ChatGPT. Refresh this page for connection instructions.' });
});

module.exports = router;
