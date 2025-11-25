/* jslint node:true, esversion:9 */
'use strict';

const admin = require('firebase-admin');

admin.initializeApp({
  apiKey: global.settings.firebase.apiKey,
  authDomain: global.settings.firebase.authDomain,
  projectId: global.settings.firebase.projectId,
  storageBucket: global.settings.firebase.storageBucket,
  messagingSenderId: global.settings.firebase.messagingSenderId,
  appId: global.settings.firebase.appId,
  measurementId: global.settings.firebase.measurementId
});

module.exports = admin;
