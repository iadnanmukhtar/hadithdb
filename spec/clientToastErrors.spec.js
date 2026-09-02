'use strict';

const fs = require('fs');
const path = require('path');
const ClientErrors = require('../routes/clientErrors');

describe('client toast error reporting', () => {
  test('bounds and cleans browser-provided log fields', () => {
    expect(ClientErrors.bounded('  Save\nfailed\u0000  ', 20)).toBe('Save failed');
    expect(ClientErrors.bounded('abcdefgh', 4)).toBe('abcd');
    expect(ClientErrors.reportPath('/quran:1:1?token=secret#part')).toBe('/quran:1:1');
    expect(ClientErrors.reportPath('https://example.com/private')).toBe('');
  });

  test('wraps every toastr error with browser and server logging', () => {
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const updateRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'update.js'), 'utf8');
    const head = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'head.ejs'), 'utf8');
    const scripts = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');

    expect(client).toContain('function installToastReporting()');
    expect(client).toContain('$(function () {\n\t\'use strict\';\n\tinstallToastReporting();');
    expect(client).toContain("console.log('[Toast success]',");
    expect(client).toContain('originalSuccessToast(safeMessage, safeTitle, optionsOverride)');
    expect(client).toContain("console.error('[Toast error]',");
    expect(client).toContain("fetch('/api/client-errors'");
    expect(client).toContain('originalErrorToast(safeMessage, safeTitle, optionsOverride)');
    expect(app).toContain("app.use('/api/client-errors', clientErrorsRouter);");
    expect(app).toContain("app.use('/quran/api/client-errors', clientErrorsRouter);");
    expect(app).toContain("app.get('/vendor/toastr/toastr.min.js'");
    expect(updateRoute).toContain('res.status(status.code).json(status);');
    expect(head).toContain('href="/vendor/toastr/toastr.min.css"');
    expect(scripts).toContain('src="/vendor/toastr/toastr.min.js"');
  });

  test('uses themed, reader-friendly toast styling and Tafsir copy', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
    const editor = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');

    expect(css).toContain('#toast-container > .toast');
    expect(css).toContain('#toast-container.toast-top-right');
    expect(css).toContain('width: min(20.5rem, calc(100vw - 1.25rem));');
    expect(css).toContain('background: linear-gradient(135deg, var(--c-note)');
    expect(css).not.toContain('background-image: none !important;');
    expect(css).toContain('font-size: .86rem;');
    expect(css).toContain('min-height: 3.75rem;');
    expect(css).toContain('content: "✓";');
    expect(css).toContain('content: "!";');
    expect(css).toContain('animation: hadith-toast-arrive');
    expect(css).toContain('#toast-container .toast-progress');
    expect(css).toContain('#toast-container > .toast-error');
    expect(client).toContain('window.toastr.options.closeButton = true;');
    expect(client).toContain('window.toastr.options.progressBar = true;');
    expect(editor).toContain("'Tafsir updated'");
    expect(editor).toContain("'Tafsir update needs attention'");
    expect(editor).not.toContain('toastr.success(`${res.status} ${res.statusText}`');
  });

  test('requests JSON for inline updates and keeps non-JSON error HTML out of toasts', () => {
    const editor = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');

    expect(editor).toContain("'Accept': 'application/json'");
    expect(editor).toContain("res.headers.get('Retry-After')");
    expect(editor).toContain('The update service is temporarily unavailable.');
    expect(editor).not.toContain('Expected JSON from ${res.url');
    expect(editor).toContain('var errMessage = resBody.message ||');
    expect(editor).not.toContain('startupRetryAttempts');
  });

  test('does not listen or notify PM2 until application initialization completes', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '..', 'bin', 'www'), 'utf8');
    const pm2 = fs.readFileSync(path.join(__dirname, '..', 'ecosystem.config.cjs'), 'utf8');

    expect(app).toContain('app.locals.startupPromise = startupPromise;');
    expect(app).not.toContain('X-HadithDB-Retry-Safe');
    expect(server).toContain('await app.locals.startupPromise;\n    server.listen(port);');
    expect(server).toContain("process.send('ready');");
    expect(server.indexOf('await app.locals.startupPromise;')).toBeLessThan(server.indexOf('server.listen(port);'));
    expect(pm2).toContain('wait_ready: true');
    expect(pm2).toContain('listen_timeout: 180000');
  });
});
