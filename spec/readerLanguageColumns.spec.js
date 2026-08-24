'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('Hadith and Tafsir language columns', () => {
  test('marks Hadith translation and Arabic panels without treating Quran search items as Hadith', () => {
    const hadith = source('views/sub-views/hadith.ejs');
    const item = source('views/sub-views/hadith_item.ejs');

    expect(hadith).toContain("isQuranItem ? ' quran-search-item' : ' hadith-language-item'");
    expect(hadith).toContain('data-reader-language-item="hadith"');
    expect(hadith).toContain('data-reader-language-column="english"');
    expect(hadith).toContain('data-reader-language-column="arabic"');
    expect(item).toContain("data-reader-language-column=\"<%= lang === 'ar' ? 'arabic' : 'english' %>\"");
  });

  test('persists one valid preference and creates one language root per infinite-scroll section', () => {
    const script = source('public/static/js/script.js');

    expect(script).toContain("return 'hadithdb.readerLanguageColumns';");
    expect(script).toContain("query('[data-reader-language-item=\"hadith\"]')");
    expect(script).toContain("query('[data-reader-infinite-page=\"1\"]')");
    expect(script).toContain("item.closest('[data-reader-infinite-page=\"1\"]') || item.closest('main')");
    expect(script).toContain("tafsir.closest('[data-reader-infinite-page=\"1\"]') || tafsir.closest('.tafsir-only-page:not(.translation-only-page)')");
    expect(script).toContain("query('.tafsir-only-page:not(.translation-only-page)')");
    expect(script).toContain("query('.quran-tafsirs')");
		expect(script).toContain("activePanel.querySelector('.quran-tafsir-entry')");
		expect(script).toContain("child.matches('header, summary') && child.querySelector('.quran-tafsir-ayah-range, .quran-tafsir-ayah')");
		expect(script).toContain("entryHeader.insertAdjacentElement('afterend', toolbar)");
		expect(script).toContain('initReaderLanguageColumnToggles(container[0]);');
    expect(script).toContain("if (!state.english && !state.arabic)\n\t\t\t\treturn;");
    expect(script).toContain('initReaderLanguageColumnToggles(document);');
    expect(script).toContain('initReaderLanguageColumnToggles(chunk);');
  });

  test('marks Tafsir text independently while leaving source metadata and page chrome visible', () => {
    const script = source('public/static/js/script.js');
    const passage = source('views/tafsir_passage.ejs');
    const chapterTitle = source('views/sub-views/chapterTitle.ejs');
    const heading = source('views/sub-views/heading.ejs');
    const introduction = source('views/quran_commentary_introduction.ejs');

    const ayahHeading = script.slice(script.indexOf('var appendAyahHeading = function'), script.indexOf('var footnoteIdPart = function'));
    expect(ayahHeading).toContain(".addClass('quran-tafsir-ayah')");
    expect(ayahHeading).not.toContain('data-reader-language-column');
    expect(script).toContain(".addClass('col-6 text-start').attr('lang', 'en')");
    expect(script).toContain('generatedBody.attr(\'data-reader-language-column\', panelLanguage === \'ar\' ? \'arabic\' : \'english\')');
    expect(script).toContain("generatedBody.find('.quran-tafsir-local-pair > [lang]')");
    expect(passage).not.toMatch(/<(?:h1|h2)[^>]*data-reader-language-column/);
    expect(passage).not.toMatch(/breadcrumbs[\s\S]{0,400}data-reader-language-column/);
    expect(chapterTitle).not.toMatch(/<(?:h1|h2)[^>]*data-reader-language-column/);
    expect(chapterTitle).not.toMatch(/breadcrumbs[\s\S]{0,400}data-reader-language-column/);
    expect(heading).not.toMatch(/<h3[^>]*data-reader-language-column/);
    expect(introduction).not.toMatch(/<(?:h1|h2)[^>]*data-reader-language-column/);
    expect(introduction).not.toMatch(/breadcrumbs[\s\S]{0,250}data-reader-language-column/);
    expect(chapterTitle).toContain('data-prop="toc.intro_en" data-reader-language-column="english"');
    expect(heading).toContain('data-prop="toc.intro" data-reader-language-column="arabic"');
  });

  test('hides the selected panels and expands the remaining column at all widths', () => {
    const css = source('public/static/css/style.css');
    const script = source('public/static/js/script.js');

    expect(css).toContain('[data-reader-language-root].reader-hide-english [data-reader-language-column="english"]');
    expect(css).toContain('[data-reader-language-root].reader-hide-arabic [data-reader-language-column="arabic"]');
    expect(css).toContain('[data-reader-language-root].reader-hide-english [data-reader-language-column="arabic"]');
    expect(css).toContain('flex: 0 0 100%;');
    expect(css).toMatch(/\.reader-language-toolbar \{[\s\S]*justify-content: space-between;[\s\S]*width: 100%;/);
		expect(css).toContain('.quran-tafsir-entry > .reader-language-toolbar');
    expect(script).toContain('quran-ayah-select-btn quran-passage-display-btn quran-passage-view-btn reader-language-toggle');
    expect(script).not.toContain("label.textContent = 'Columns'");
    expect(script).not.toContain('text.textContent = choice.label');
    expect(script).toContain('var mustRemainVisible = active && !otherActive;');
    expect(script).toContain('button.disabled = mustRemainVisible;');
    expect(script).toContain('if (!state.english && !state.arabic)\n\t\t\t\treturn;');
    expect(script).toContain('if (!next.translation && !next.arabic)\n\t\t\t\treturn;');
  });
});
