'use strict';

// A single origin-level worker lets each route-specific manifest remain an
// independently installable app without intercepting or caching private data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
