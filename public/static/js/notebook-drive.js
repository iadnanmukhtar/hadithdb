/* global quranApiPath */
(() => {
  'use strict';
  if (window.notebookDrive) return;
  let state = null, working = false, generation = 0, message = '';
  let pickerLoading, shadow = null;
  const importButtons = [...document.querySelectorAll('[data-notebook-drive-import]')];
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
    for (const button of importButtons) {
      button.hidden = !state?.connected || !state?.migrated;
      button.disabled = working || !!state?.needsDriveAccess;
    }
    for (const panel of panels) {
      const controls = panel.querySelector('[data-community-drive-controls]');
      if (controls) {
        controls.hidden = !state?.connected || !shadow;
        const toggle = controls.querySelector('[data-community-drive-enabled]');
        toggle.checked = !!shadow?.enabled;
        toggle.disabled = working;
        controls.querySelector('[data-community-drive-status]').textContent = !shadow?.enabled ? 'Copying is off.' : shadow.pending ? `${shadow.pending} copy update(s) pending. Sync retries automatically while connected.` : 'Copying is on. New saves will sync automatically.';
      }
      const settingsPanel = panel.hasAttribute('data-notebook-drive-settings');
      panel.hidden = !state || (!settingsPanel && state.connected && state.migrated && !state.needsDriveAccess && !message);
      if (!state) continue;
      panel.dataset.connected = String(!!state.connected);
      panel.querySelector('[data-notebook-drive-icon]')?.setAttribute('aria-label', state.connected ? 'Google Drive connected' : 'Google Drive disconnected');
      panel.querySelector('[data-notebook-drive-message]').textContent = message || (state.needsDriveAccess ? 'Reconnect to use limited access to files you create or select for your notebook.' : !state.configured ? 'Google Drive storage is being set up. Your existing notes are preserved.' : !state.connected ? 'Connect Google Drive to store your notes in a Hadith Unlocked folder. Existing notes will be copied there.' : !state.migrated ? 'Finish moving your existing notes to Google Drive.' : panel.hasAttribute('data-notebook-drive-compact') ? '' : 'Your notes are stored in Google Drive.');
      const button = panel.querySelector('[data-notebook-drive-connect]');
      button.hidden = !state.configured || (state.connected && state.migrated && !state.needsDriveAccess);
      button.disabled = working;
      button.textContent = state.needsDriveAccess ? 'Reconnect Google Drive' : state.connected ? 'Finish moving notes' : 'Connect Google Drive';
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
      state = result;
      if (document.querySelector('[data-community-drive-controls]')) shadow = await request('/shadow');
      if (ownGeneration !== generation) return;
      paint();
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
    if (state.connected && !state.needsDriveAccess) { finishMigration(); return; }
    if (!window.google?.accounts?.oauth2) { message = 'Google authorization is still loading. Please try again.'; paint(); return; }
    const ownGeneration = generation;
    working = true; message = ''; paint();
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: state.clientId, scope: 'openid email https://www.googleapis.com/auth/drive.file', include_granted_scopes: false, ux_mode: 'popup',
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
  function loadPicker() {
    if (window.google?.picker) return Promise.resolve();
    if (pickerLoading) return pickerLoading;
    pickerLoading = new Promise((resolve, reject) => {
      const load = () => window.gapi.load('picker', { callback: resolve,
        onerror: () => reject(new Error('Google Drive file selection could not load. Please retry.')),
        timeout: 15000, ontimeout: () => reject(new Error('Google Drive file selection timed out. Please retry.')) });
      if (window.gapi?.load) { load(); return; }
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js'; script.async = true;
      script.onload = load;
      script.onerror = () => reject(new Error('Google Drive file selection could not load. Please retry.'));
      document.head.appendChild(script);
    }).catch(err => { pickerLoading = null; throw err; });
    return pickerLoading;
  }
  function importFromDrive() {
    if (working || !state?.connected || state.needsDriveAccess) return;
    if (!state.picker) {
      message = 'Import from Google Drive is being set up. Please try again later.'; paint(); return;
    }
    if (!window.google?.accounts?.oauth2) {
      message = 'Google authorization is still loading. Please try again.'; paint(); return;
    }
    const ownGeneration = generation;
    working = true; message = ''; paint();
    const finish = () => { if (ownGeneration === generation) { working = false; paint(); } };
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: state.clientId, scope: 'https://www.googleapis.com/auth/drive.file',
      include_granted_scopes: false, ...(state.googleAccount ? { hint: state.googleAccount } : {}),
      error_callback: () => { if (ownGeneration === generation) message = 'Google Drive file selection was cancelled or blocked.'; finish(); },
      callback: async response => {
        if (ownGeneration !== generation) return;
        try {
          if (response.error || !response.access_token) throw new Error('Google Drive authorization was not completed.');
          await loadPicker();
          if (ownGeneration !== generation) return;
          const pickerApi = window.google.picker;
          const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
            .setIncludeFolders(true).setSelectFolderEnabled(false).setParent(state.folderId);
          let picker;
          picker = new pickerApi.PickerBuilder().addView(view)
            .setTitle('Choose Markdown files from your Hadith Unlocked folder')
            .setOAuthToken(response.access_token).setDeveloperKey(state.picker.apiKey)
            .setAppId(state.picker.appId).setOrigin(window.location.origin)
            .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
            .setCallback(async data => {
              if (ownGeneration !== generation) { picker.dispose(); return; }
              if (data.action === pickerApi.Action.CANCEL) { picker.dispose(); finish(); return; }
              if (data.action !== pickerApi.Action.PICKED) return;
              picker.dispose();
              try {
                const docs = data.docs || [];
                if (!docs.length || docs.length > 20 || docs.some(doc => !/\.md$/i.test(doc.name || '')))
                  throw new Error('Choose between 1 and 20 Markdown (.md) files.');
                message = 'Importing selected notes…'; paint();
                const result = await request('/import', 'POST', { fileIds: docs.map(doc => doc.id) });
                if (ownGeneration !== generation) return;
                message = `${result.notes.length} note${result.notes.length === 1 ? '' : 's'} ready. Existing files were updated without making copies.`;
                document.dispatchEvent(new CustomEvent('notebookDriveConnected'));
              } catch (err) { if (ownGeneration === generation) message = err.message; }
              finally { finish(); }
            }).build();
          picker.setVisible(true);
        } catch (err) { if (ownGeneration === generation) message = err.message; finish(); }
      }
    });
    tokenClient.requestAccessToken();
  }
  document.querySelector('[data-community-drive-enabled]')?.addEventListener('change', async event => {
    const enabled = event.target.checked, ownGeneration = generation;
    working = true; paint();
    try {
      const result = await request('/shadow', 'PUT', { enabled });
      if (ownGeneration === generation) { shadow = result; message = ''; }
    } catch (err) { if (ownGeneration === generation) message = err.message; }
    finally { if (ownGeneration === generation) { working = false; paint(); } }
  });
  for (const button of importButtons) button.addEventListener('click', importFromDrive);
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
  document.addEventListener('hadithAuthChanged', () => { ++generation; state = null; shadow = null; message = ''; working = false; paint(); refresh(); });
  refresh();
})();
