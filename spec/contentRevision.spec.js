'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ContentRevision = require('../lib/ContentRevision');
const Tafsir = require('../lib/Tafsir');

jest.mock('axios');

describe('content revision', () => {
	afterEach(() => {
		jest.clearAllMocks();
		delete global.query;
		delete global.settings;
	});

	test('instructs every revision to link localized Quran and hadith references and mark quotations', () => {
		const messages = ContentRevision.buildMessages({
			book_alias: 'riyad', text: 'قال الله تعالى', text_en: ''
		}, ContentRevision.TYPES.hdith_sharh);
		const prompt = messages.map(message => message.content).join('\n');
		expect(prompt).toContain('([Muslim 2985](https://hadithunlocked.com/muslim:2985))');
		expect(prompt).toContain('([مسلم ٢٩٨٥](https://hadithunlocked.com/muslim:2985))');
		expect(prompt).toContain('([Āl ʿImrān 3:29](https://quran.islamunlocked.com/quran:3:29))');
		expect(prompt).toContain('([آل عمران ٣:٢٩](https://quran.islamunlocked.com/quran:3:29))');
		expect(prompt).toContain('﴿النص﴾');
		expect(prompt).toContain('«النص»');
		expect(prompt).toContain('standard English double quotation marks like "text"');
		expect(prompt).toContain('do not use ﴿...﴾ in English');
		expect(prompt).toContain('do not use «...» in English');
		expect(prompt).toContain('[^1]: Note text');
		expect(prompt).toContain('[^[Dhāriyāt 51:56–57](https://quran.islamunlocked.com/quran:51:56-57)]');
	});

	test('stores an English translation while revising Arabic-only sharh', async () => {
		global.settings = { openAI: { key: 'test', model: 'test-model' } };
		global.query = jest.fn(async sql => {
			if (sql.includes('FROM hdith_hadith_sharh hs')) return [{
				id: 9, hadith_id: 3, text: 'قال الله تعالى', text_en: '', ref: 'muslim:2985', book_alias: 'muslim'
			}];
			if (sql.startsWith('UPDATE hdith_hadith_sharh SET')) return { affectedRows: 1 };
			return [];
		});
		axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({
			text: '﴿قُلْ إِن تُخْفُوا﴾ ([آل عمران ٣:٢٩](https://quran.islamunlocked.com/quran:3:29))',
			text_en: '﴿Say, whether you conceal﴾ ([Āl ʿImrān 3:29](https://quran.islamunlocked.com/quran:3:29))'
		}) } }] } });

		const result = await ContentRevision.revise('hdith_sharh', 9);

		expect(result.fields.text_en).toContain('quran.islamunlocked.com/quran:3:29');
		expect(global.query.mock.calls.some(([sql]) => sql.includes('text_en=\'\\"Say, whether you conceal\\"'))).toBe(true);
	});

	test('renumbers embedded Markdown footnotes independently for Arabic and English content', () => {
		const fields = ContentRevision.normalizeMarkdownFootnotes(ContentRevision.TYPES.toc, {
			intro: 'نص[^note]\n\n[^note]: حاشية',
			intro_en: 'Text[^source]\n\n[^source]: Note'
		});
		expect(fields.intro).toBe('نص[^1]\n\n[^1]: حاشية');
		expect(fields.intro_en).toBe('Text[^1]\n\n[^1]: Note');
	});

	test('renders a linked inline footnote as a numbered note containing the link', () => {
		const markdown = 'abc [^[Dhāriyāt 51:56–57](https://quran.islamunlocked.com/quran:51:56-57)]';
		const html = Tafsir.renderCommentaryText(markdown, '', 'md', { footnoteIdPrefix: 'intro-link' });
		expect(html).toContain('abc <sup class="footnote-ref">');
		expect(html).toContain('href="#intro-link-fn1"');
		expect(html).toContain('<li id="intro-link-fn1" class="footnote-item"><p><a href="https://quran.islamunlocked.com/quran:51:56-57">Dhāriyāt 51:56–57</a>');
		expect(html).not.toContain('abc [<sup');
	});

	test('uses the tafsir footnote color for revised content footnotes and their links', () => {
		const css = fs.readFileSync(path.join(__dirname, '../public/static/css/style.css'), 'utf8');
		expect(css).toContain(':is(.intro, .h .body) .footnote-ref a');
		expect(css).toContain(':is(.intro, .h .body) .footnotes a');
		expect(css).toMatch(/:is\(\.intro, \.h \.body\) \.footnotes li::marker \{[\s\S]*?color: var\(--c-footnote-muted\);/);
	});

	test('renders namespaced Markdown footnotes in English and Arabic content', () => {
		const english = Tafsir.renderCommentaryText('Text[^1]\n\n[^1]: Note', '', 'md', { footnoteIdPrefix: 'intro-9-en' });
		const arabic = Tafsir.renderCommentaryText('نص[^1]\n\n[^1]: حاشية', '', 'md', { bracketedFootnotes: true, footnoteIdPrefix: 'intro-9-ar' });
		expect(english).toContain('href="#intro-9-en-fn1"');
		expect(english).toContain('<section class="footnotes">');
		expect(arabic).toContain('href="#intro-9-ar-fn1"');
		expect(arabic).toContain('حاشية');
	});

	test('renders admin Revise controls for shuruh, intros, articles, and tafsir passages', () => {
		const files = [
			'views/sub-views/hadith_metadata.ejs',
			'views/sub-views/hadith_heading_sharh.ejs',
			'views/sub-views/heading.ejs',
			'views/sub-views/chapterTitle.ejs',
			'views/sub-views/quran_commentary_article.ejs',
			'views/sub-views/quran_commentary_heading_intro.ejs',
			'public/static/js/script.js'
		].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
		expect(files).toContain('data-prop="hdith_sharh.revise"');
		expect(files).toContain('data-prop="hdith_toc_sharh.revise"');
		expect(files).toContain('data-prop="toc.revise"');
		expect(files).toContain("'data-prop': 'commentary.revise'");
		expect(files).toContain('btn btn-sm btn-outline-secondary hadith-admin-action ms-1 mb-1');
		expect(files).toContain('<% if (utils.trimToEmpty(entry.text_en)) { %><aside class="admin hadith-admin-actions mt-1">');
		expect(files).toContain('<% if (!utils.trimToEmpty(entry.text_en)) { %><aside class="admin hadith-admin-actions mt-1"');
		expect(files).toContain('revisionColumns.filter(\'[data-reader-language-column="english"], [lang="en"]\')');
		expect(files).toContain('Tafsir.renderCommentaryText');
		expect(files).toContain('footnoteIdPrefix');
		const route = fs.readFileSync(path.join(__dirname, '../routes/update.js'), 'utf8');
		expect(route).toContain("ContentRevision.revise('hdith_sharh'");
		expect(route).toContain("ContentRevision.revise('hdith_toc_sharh'");
		expect(route).toContain("ContentRevision.revise('toc'");
		expect(route).toContain("ContentRevision.revise('commentary'");
	});

	test('the hadith revision prompt uses the same link and quotation contract', () => {
		const source = fs.readFileSync(path.join(__dirname, '../lib/HadithRevision.js'), 'utf8');
		expect(source).toContain('https://hadithunlocked.com/muslim:2985');
		expect(source).toContain('https://quran.islamunlocked.com/quran:3:29');
		expect(source).toContain('like *«...»*');
		expect(source).toContain('like ﴿...﴾');
		expect(source).toContain('like *"..."*');
		expect(source).toContain('like "..."');
		expect(source).toContain('Do not use Arabic guillemets «...» or Qur\'anic verse marks ﴿...﴾ in English output.');
	});
});
