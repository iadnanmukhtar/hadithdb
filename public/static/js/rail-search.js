// The same partial can appear in several pickers, including ones inserted after load.
if (!document.documentElement.hasAttribute('data-rail-search-ready')) {
  document.documentElement.setAttribute('data-rail-search-ready', '');
  function clearRailSearch(input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-rail-search] button');
    if (button) clearRailSearch(button.closest('[data-rail-search]').querySelector('input'));
  });
  document.addEventListener('keydown', event => {
    const input = event.target;
    if (event.key === 'Escape' && input.matches('[data-rail-search] input') && input.value) {
      event.preventDefault();
      clearRailSearch(input);
    }
  });
}
