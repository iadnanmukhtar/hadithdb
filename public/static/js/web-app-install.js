'use strict';

(function () {
  if (!('serviceWorker' in navigator))
    return;

  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((err) => {
    console.warn('Web app installation is unavailable:', err);
  });

  let installPrompt = null;
  const controls = () => Array.from(document.querySelectorAll('[data-web-app-install]'));
  const setVisible = (visible) => controls().forEach((control) => { control.hidden = !visible; });
  const appName = document.querySelector('meta[name="application-name"]')?.content || 'app';
  document.querySelectorAll('[data-web-app-install-label]').forEach((label) => {
    label.textContent = `Install ${appName}`;
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    setVisible(true);
  });

  document.addEventListener('click', async (event) => {
    const control = event.target.closest('[data-web-app-install]');
    if (!control || !installPrompt)
      return;
    event.preventDefault();
    const prompt = installPrompt;
    installPrompt = null;
    setVisible(false);
    await prompt.prompt();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    setVisible(false);
  });
}());
