/* global quranApiPath */
(() => {
  'use strict';
  const themes = [
    { id: 'note', label: 'Note', paper: '#fff8db', ink: '#634800' },
    { id: 'paper', label: 'Paper', paper: '#f3f1ec', ink: '#332f2a' },
    { id: 'calm', label: 'Calm', paper: '#f3dfbd', ink: '#3f3023' },
    { id: 'focus', label: 'Focus', paper: '#fffdf4', ink: '#211f18' },
    { id: 'sage', label: 'Sage', paper: '#e8eee5', ink: '#263426' },
    { id: 'quiet', label: 'Quiet', paper: '#505155', ink: '#f1edf0' }
  ];
  const valid = value => themes.some(theme => theme.id === value) ? value : 'note';
  const apply = value => {
    const theme = valid(value);
    document.querySelectorAll('#notebook-modal, #personal-notebook').forEach(element => { element.dataset.notebookTheme = theme; });
    return theme;
  };
  const render = (container, value, choose) => {
    if (!container) return;
    const selected = valid(value);
    container.innerHTML = '';
    themes.forEach(theme => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'notebook-theme-choice';
      button.textContent = theme.label;
      button.style.setProperty('--theme-paper', theme.paper);
      button.style.setProperty('--theme-ink', theme.ink);
      button.setAttribute('aria-pressed', String(theme.id === selected));
      button.addEventListener('click', () => choose(theme.id));
      container.appendChild(button);
    });
  };
  window.NotebookThemes = { themes, valid, apply, render };
})();
