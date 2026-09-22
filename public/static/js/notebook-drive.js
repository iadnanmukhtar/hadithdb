/* global quranApiPath */
(() => {
  'use strict';
  if (window.notebookDrive) return;
  let state = null, working = false, generation = 0, message = '';
  const panels = [...document.querySelectorAll('[data-notebook-drive-panel]')];
  async function request(path = '', method = 'GET', body) {
    const token = await window.hadithAuth?.getToken();
    if (!token) throw new Error('Please sign in to connect Google Drive.');
    const response = await fetch(quranApiPath('/notebook/drive' + path), {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not connect Google Drive.');
    return data;
  }
  function paint() {
    for (const panel of panels) {
      const settingsPanel = panel.hasAttribute('data-notebook-drive-settings');
      panel.hidden = !state || (!settingsPanel && state.connected && state.migrated && !message);
      if (!state) continue;
      panel.dataset.connected = String(!!state.connected);
      panel.querySelector('[data-notebook-drive-icon]')?.setAttribute('aria-label', state.connected ? 'Google Drive connected' : 'Google Drive disconnected');
      panel.querySelector('[data-notebook-drive-message]').textContent = message || (!state.configured ? 'Google Drive storage is being set up. Your existing notes are preserved.' : !state.connected ? 'Connect Google Drive to store your notes in a Hadith Unlocked folder. Existing notes will be copied there.' : !state.migrated ? 'Finish moving your existing notes to Google Drive.' : panel.hasAttribute('data-notebook-drive-compact') ? '' : 'Your notes are stored in Google Drive.');
      const button = panel.querySelector('[data-notebook-drive-connect]');
      button.hidden = !state.configured || (state.connected && state.migrated);
      button.disabled = working;
      button.textContent = state.connected ? 'Finish moving notes' : 'Connect Google Drive';
      const folder = panel.querySelector('[data-notebook-drive-folder]');
      if (folder) {
        folder.hidden = !settingsPanel || !state.connected || !state.folderUrl;
        if (state.folderUrl) folder.href = state.folderUrl;
      }
      const disconnect = panel.querySelector('[data-notebook-drive-disconnect]');
      if (disconnect) { disconnect.hidden = !settingsPanel || !state.connected; disconnect.disabled = working; }
    }
  }
  async function refresh() {
    const ownGeneration = generation;
    try {
      if (!await window.hadithAuth?.getToken()) { state = null; paint(); return; }
      const result = await request();
      if (ownGeneration !== generation) return;
      state = result; paint();
    } catch (err) { if (ownGeneration === generation) { message = err.message; paint(); } }
  }
  async function migrate(ownGeneration) {
    let done = false;
    while (!done && ownGeneration === generation) {
      message = 'Copying and verifying existing notes in Google Drive…'; paint();
      done = (await request('/migrate', 'POST')).done;
    }
    if (ownGeneration !== generation) return;
    message = ''; await refresh();
    document.dispatchEvent(new CustomEvent('notebookDriveConnected'));
  }
  async function finishMigration() {
    working = true; paint(); const ownGeneration = generation;
    try { await migrate(ownGeneration); }
    catch (err) { if (ownGeneration === generation) message = err.message; }
    finally { if (ownGeneration === generation) { working = false; paint(); } }
  }
  function connect() {
    if (working || !state?.configured) return;
    if (state.connected) { finishMigration(); return; }
    if (!window.google?.accounts?.oauth2) { message = 'Google authorization is still loading. Please try again.'; paint(); return; }
    const ownGeneration = generation;
    working = true; message = ''; paint();
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: state.clientId, scope: 'openid email https://www.googleapis.com/auth/drive.file', ux_mode: 'popup',
      callback: async response => {
        if (ownGeneration !== generation) return;
        try {
          if (!response.code || response.error) throw new Error('Google Drive authorization was not completed.');
          const result = await request('/connect', 'POST', { code: response.code });
          if (ownGeneration !== generation) return;
          state = result;
          await migrate(ownGeneration);
        } catch (err) { if (ownGeneration === generation) message = err.message; }
        finally { if (ownGeneration === generation) { working = false; paint(); } }
      },
      error_callback: () => { if (ownGeneration === generation) { working = false; message = 'Google Drive authorization was cancelled or blocked. Please try again.'; paint(); } }
    });
    client.requestCode();
  }
  for (const panel of panels) {
    panel.querySelector('[data-notebook-drive-connect]').addEventListener('click', connect);
    panel.querySelector('[data-notebook-drive-disconnect]')?.addEventListener('click', async () => {
      if (working) return;
      // Keep unsaved drafts in place; the existing editor will prompt before leaving.
      working = true; paint(); const ownGeneration = generation;
      try { await request('', 'DELETE'); if (ownGeneration !== generation) return; message = ''; await refresh(); document.dispatchEvent(new CustomEvent('notebookDriveDisconnected')); }
      catch (err) { if (ownGeneration === generation) message = err.message; }
      finally { if (ownGeneration === generation) { working = false; paint(); } }
    });
  }
  window.notebookDrive = { required: () => { refresh(); } };
  document.addEventListener('hadithAuthChanged', () => { ++generation; state = null; message = ''; working = false; paint(); refresh(); });
  refresh();
})();
