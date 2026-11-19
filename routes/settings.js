/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');

const router = express.Router();

router.get(['/', '/beta'], async function (req, res, next) {
  try {
    res.locals.req = req;
    res.locals.res = res;
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    const settingsPath = req.baseUrl || '/settings';
    const settingsBeta = req.path.replace(/\/$/, '') === '/beta';
    const isQuranSettings = settingsPath === '/quran/settings' || settingsPath.indexOf('/quran/settings/') === 0;
    res.render('settings', {
      results: [],
      settingsBeta,
      settingsPath,
      page: {
        menu: 'My Settings',
        title_en: `${isQuranSettings ? 'Quran ' : ''}Settings${settingsBeta ? ' (beta)' : ''}`,
        description_en: `Manage your ${isQuranSettings ? 'Quran reading, memorization, review, and ' : ''}account settings.`,
        subtitle_en: 'Account settings',
        subtitle: null,
        canonical: settingsPath,
        alternate: settingsPath,
        feed: null,
        noindex: true,
        context: isQuranSettings ? { quranSearchProxy: true } : {}
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
