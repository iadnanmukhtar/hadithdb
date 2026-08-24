'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const partial = path.join(__dirname, '..', 'views', 'sub-views', 'toc_heading_rail.ejs');
const tocTemplate = path.join(__dirname, '..', 'views', 'toc.ejs');

function render(items) {
	return ejs.renderFile(partial, {
		tocHeadingRailItems: items,
		tocHeadingRailTitle: 'Riyad al-Salihin',
		tocHeadingRailBookHref: '/riyad'
	});
}

describe('TOC heading rail', () => {
	test('lists H1 chapters under the fixed book name', async () => {
		const html = await render([{
			key: 'toc-heading-0',
			number: '0.07',
			title: 'Certainty and Trust in Allah',
			titleLang: 'en',
			href: '/riyad/0.07'
		}, {
			key: 'toc-heading-1',
			number: '0.08',
			title: 'باب عربي',
			titleLang: 'ar',
			href: '/riyad/0.08'
		}]);

		expect(html).toContain('data-toc-heading-rail');
		expect(html).toContain('href="/riyad">Riyad al-Salihin</a>');
		expect(html).toContain('href="/riyad/0.07"');
		expect(html).toContain('>0.07 Certainty and Trust in Allah</a>');
		expect(html).toMatch(/data-toc-heading-key="toc-heading-1"[^>]*lang="ar" dir="rtl"[^>]*>0\.08 باب عربي<\/a>/);
	});

	test('omits an empty rail and connects the TOC page to H1 targets', async () => {
		expect(await render([])).not.toContain('data-toc-heading-rail');
		const template = fs.readFileSync(tocTemplate, 'utf8');
		expect(template).toContain("include('sub-views/toc_heading_rail.ejs'");
		expect((template.match(/data-toc-heading-target/g) || [])).toHaveLength(2);
	});

	test('places untracked authored-introduction articles before Surah 1', async () => {
		const html = await render([{
			key: 'toc-commentary-introduction-1',
			number: '',
			title: 'Foreword',
			titleLang: 'en',
			href: '/quran/tafsir/rida/introduction#introduction-1',
			track: false
		}, {
			key: 'toc-heading-0',
			number: '1',
			title: 'al-Fatihah',
			titleLang: 'en',
			href: '/quran/tafsir/rida/1'
		}]);

		expect(html.indexOf('Foreword')).toBeLessThan(html.indexOf('1 al-Fatihah'));
		expect(html).toContain('href="/quran/tafsir/rida/introduction#introduction-1"');
		expect(html).not.toMatch(/href="\/quran\/tafsir\/rida\/introduction#introduction-1"[^>]*data-toc-heading-key/);
		expect(html).toMatch(/class="[^"]*active[^"]*" href="\/quran\/tafsir\/rida\/1"[^>]*data-toc-heading-key="toc-heading-0"/);
	});

	test('uses a linked introduction row instead of an introduction body on commentary TOCs', () => {
		const template = fs.readFileSync(tocTemplate, 'utf8');
		expect(template).toContain('quran-commentary-introduction-link-row');
		expect(template).toContain('#introduction-${article.h2}');
		expect(template).toContain('quranCommentaryIntroductionHref');
		expect(template).not.toContain("include('sub-views/quran_commentary_introduction.ejs'");
	});
});
