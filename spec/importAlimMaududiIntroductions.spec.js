'use strict';

const crypto = require('crypto');
const {
	countChanges,
	escapeUnescapedMarkdownBackticks,
	introductionUrl,
	parseIntroductionPage,
	readOptions,
	validateSource
} = require('../bin/utils/import-alim-maududi-introductions');
const Tafsir = require('../lib/Tafsir');

function page(surah, body) {
	const url = introductionUrl('https://www.alim.org/quran/tafsir/maududi/surah', surah);
	return `<!doctype html><html><head><title>Surah Example ${surah}:0 Tafsir Maududi | Alim</title>
		<link rel="canonical" href="${url}"></head><body>
		<div class="tafsirContent"><note>${body}</note></div></body></html>`;
}

describe('Alim tafsir introduction importer', () => {
	test('converts the source introduction structure to strict Markdown', () => {
		const parsed = parseIntroductionPage(page(2, `
			<h2><b>Name</b></h2>
			<p>Why <em>Al-Baqarah</em>? This paragraph contains enough source text to pass the importer validation without fabricating content.</p>
			<h2>Theme</h2>
			<ol><li><p>First <strong>principle</strong>.</p><ul><li>Nested point.</li></ul></li><li>Second principle.</li></ol>
		`), 2);

		expect(parsed.intro_en).toBe([
			'## **Name**',
			'',
			'Why *Al-Baqarah*? This paragraph contains enough source text to pass the importer validation without fabricating content.',
			'',
			'## Theme',
			'',
			'1. First **principle**.',
			'',
			'   - Nested point.',
			'2. Second principle.'
		].join('\n'));
		expect(parsed.sourceTextLength).toBeGreaterThan(100);
		expect(parsed.sha256).toBe(crypto.createHash('sha256').update(parsed.intro_en).digest('hex'));
	});

	test('converts Ibn Kathir title and Arabic quote divs to Markdown blocks', () => {
		const parsed = parseIntroductionPage(page(2, `
			<div class="title">Virtues of Surat Al-Baqarah</div>
			<p>This Ibn Kathir introduction paragraph contains enough English source text to satisfy the minimum validation length.</p>
			<div class="arabic_text_style" dir="rtl">إِنَّ لِكُلِّ شَيْءٍ سَنَامًا</div>
		`), 2);

		expect(parsed.intro_en).toBe([
			'## Virtues of Surat Al-Baqarah',
			'',
			'This Ibn Kathir introduction paragraph contains enough English source text to satisfy the minimum validation length.',
			'',
			'إِنَّ لِكُلِّ شَيْءٍ سَنَامًا'
		].join('\n'));
	});

	test('escapes literal Ibn Kathir transliteration backticks so Tafsir Markdown leaves them as text', () => {
		const tick = String.fromCharCode(96);
		const parsed = parseIntroductionPage(page(2, `
			<p>Also, ${tick}Abdullah bin Mas${tick}ud narrated this report, and this sentence is long enough to satisfy source validation.</p>
		`), 2);
		const rendered = Tafsir.renderEnglishCommentaryMarkdown(parsed.intro_en);

		expect(parsed.intro_en).toBe(`Also, \\${tick}Abdullah bin Mas\\${tick}ud narrated this report, and this sentence is long enough to satisfy source validation.`);
		expect(rendered).toContain(`Also, ${tick}Abdullah bin Mas${tick}ud narrated this report`);
		expect(rendered).not.toContain('quran-tafsir-backtick');
		expect(rendered).not.toContain('<code>');
		expect(escapeUnescapedMarkdownBackticks(`one ${tick} two \\${tick} three \\\\${tick}`))
			.toBe(`one \\${tick} two \\${tick} three \\\\\\${tick}`);
	});

	test('accepts Alim short introductions when the page identity and note are valid', () => {
		const parsed = parseIntroductionPage(page(9, '<div class="title">Which was revealed in Makkah</div>'), 9,
			introductionUrl('https://www.alim.org/quran/tafsir/maududi/surah', 9));
		expect(parsed.intro_en).toBe('## Which was revealed in Makkah');
		expect(parsed.sourceTextLength).toBe(28);
	});

	test('accepts Alim introductions placed directly in tafsirContent', () => {
		const url = introductionUrl('https://www.alim.org/quran/tafsir/maududi/surah', 97);
		const html = `<!doctype html><title>Surah Example 97:0 Tafsir | Alim</title>
			<link rel="canonical" href="${url}"><div class="tafsirContent">
			<div class="title">Which was revealed in Makkah</div>
			<div class="arabic_text_style">بِسْمِ اللَّهِ</div>
			<p>In the name of Allah, the Beneficent, the Merciful</p></div>`;
		const parsed = parseIntroductionPage(html, 97, url);
		expect(parsed.intro_en).toContain('## Which was revealed in Makkah');
		expect(parsed.intro_en).toContain('بِسْمِ اللَّهِ');
	});

	test('rejects a redirected or missing source introduction', () => {
		expect(() => parseIntroductionPage(page(3, '<p>This is deliberately long enough to be parsed, but its canonical URL identifies the wrong page and must be rejected immediately.</p>'), 2))
			.toThrow(/canonical URL/);
		expect(() => parseIntroductionPage('<title>Surah Example 2:0 Tafsir Maududi | Alim</title>', 2))
			.toThrow(/expected one/);
	});

	test('requires checksum-verified coverage for all 114 surahs', () => {
		const introductions = Array.from({ length: 114 }, (unused, index) => {
			const surah = index + 1;
			const intro = `## Name\n\n${'Introduction text. '.repeat(8)}${surah}`;
			return {
				surah,
				url: introductionUrl('https://www.alim.org/quran/tafsir/maududi/surah', surah),
				intro_en: intro,
				sourceTextLength: intro.length,
				sha256: crypto.createHash('sha256').update(intro).digest('hex')
			};
		});
		expect(() => validateSource(introductions)).not.toThrow();
		expect(() => validateSource(introductions.slice(1))).toThrow(/Expected 114/);
		introductions[4].sha256 = '0'.repeat(64);
		expect(() => validateSource(introductions)).toThrow(/checksum mismatch/);
	});

	test('rejects checksum-valid caches that contain unescaped backticks', () => {
		const tick = String.fromCharCode(96);
		const introductions = Array.from({ length: 114 }, (unused, index) => {
			const surah = index + 1;
			const intro = `## Name\n\n${'Introduction text. '.repeat(8)}${surah}${surah === 2 ? ` ${tick}Abdullah` : ''}`;
			return {
				surah,
				url: introductionUrl('https://www.alim.org/quran/tafsir/maududi/surah', surah),
				intro_en: intro,
				sourceTextLength: intro.length,
				sha256: crypto.createHash('sha256').update(intro).digest('hex')
			};
		});

		expect(() => validateSource(introductions)).toThrow(/surah 2 contains unescaped backticks/);
	});

	test('counts inserts and exact intro updates without touching other fields', () => {
		const source = [
			{ surah: 1, intro_en: 'One' },
			{ surah: 2, intro_en: 'Two' },
			{ surah: 3, intro_en: 'Three' }
		];
		expect(countChanges([
			{ id: 11, h1: 1, intro_en: 'One' },
			{ id: 12, h1: 2, intro_en: 'Old two' }
		], source)).toEqual({ inserts: 1, updates: 1, unchanged: 1 });
		expect(() => countChanges([{ h1: 1 }, { h1: 1 }], source)).toThrow(/duplicate surah 1/);
	});

	test('defaults to dry-run and requires explicit apply', () => {
		expect(readOptions([])).toMatchObject({ alias: 'en-maududi', sourceSlug: 'maududi', dryRun: true, buildIndex: true });
		expect(readOptions(['--apply', '--no-index'])).toMatchObject({ dryRun: false, buildIndex: false });
		expect(readOptions(['--alias', 'ibn-kathir', '--source-slug', 'ibn-kathir'])).toMatchObject({
			alias: 'ibn-kathir',
			sourceSlug: 'ibn-kathir',
			baseUrl: 'https://www.alim.org/quran/tafsir/ibn-kathir/surah',
			importUser: 'import-alim-ibn-kathir-intros'
		});
	});
});
