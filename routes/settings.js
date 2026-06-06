/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');

const router = express.Router();

router.get('/', async function (req, res, next) {
  try {
    res.locals.req = req;
    res.locals.res = res;
    res.render('settings', {
      results: [],
      page: {
        menu: 'My Settings',
        title_en: `${global.settings.site.shortName} | My Settings`,
        subtitle_en: 'Account settings',
        subtitle: null,
        canonical: '/settings',
        alternate: '/settings',
        feed: null,
        context: {}
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
