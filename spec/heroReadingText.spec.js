const Utils = require('../lib/Utils');

test('hero reading text preserves wording, Arabic diacritics and verse numbers without Markdown or notes', () => {
  const source = '# **Mercy**\n\n*رَحْمَةٌ* [verse 2:3](https://example.test) CODE[^١] [[inline note]]\n\n[^١]: note body';
  expect(Utils.heroReadingText(source)).toBe('Mercy رَحْمَةٌ verse 2:3 CODE');
  expect(Utils.heroReadingText('One[2] two¹ and `three`')).toBe('One two and three');
});
