for (const field of document.querySelectorAll('.ux-rail-search')) {
  const input = field.querySelector('input');
  function clear() {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  field.querySelector('button').addEventListener('click', clear);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      clear();
    }
  });
}
