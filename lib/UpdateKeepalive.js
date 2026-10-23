'use strict';

// JSON permits leading whitespace. Send it while a slow AI operation runs so
// nginx's idle read timeout does not discard a subsequently committed update.
// After headers are sent, the JSON envelope's code is the operation status.
module.exports = function updateKeepalive(req, res) {
  const prop = String(req.params.prop || '');
  const aiUpdate = /^(hdith_sharh|hdith_toc_sharh)\.revise$/.test(prop)
    || /^(hdith_sharh|hdith_toc_sharh)\.(text_en|title_en)$/.test(prop)
      && (!String(req.body.value || '').trim() || req.body.value === '…');
  if (!aiUpdate) return () => {};
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent) {
      res.status(200);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    res.write(' \n');
  }, 15000);
  timer.unref?.();
  const stop = () => clearInterval(timer);
  res.once?.('close', stop);
  return stop;
};
