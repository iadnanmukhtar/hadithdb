const fs = require('fs');
const path = require('path');

function source(relativePath) {
	return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('Hadith and Quran share modals', () => {
	test('both server-rendered modals expose text, image, and native share actions', () => {
		for (const template of ['views/sub-views/hadith_modal.ejs', 'views/sub-views/quran_modal.ejs']) {
			const markup = source(template);
			expect(markup).toContain('hadith-share-copy-text');
			expect(markup).toContain('hadith-share-copy');
			expect(markup).toContain('hadith-share-native');
		}
	});

	test('dynamic Quran share modals expose text copy and use the shared handler', () => {
		const client = source('public/static/js/script.js');
		const dynamicModal = client.slice(client.indexOf('function quranShareModalHtml'), client.indexOf('function quranShareRefParts'));
		expect(dynamicModal).toContain("title: 'Copy text'");
		expect(dynamicModal).toContain('hadith-share-copy-text');
		expect(client).toContain("copyTextButton.addEventListener('click'");
		expect(client).toContain('copyHadithShareCardText(card, copyTextButton)');
	});

	test('share cards avoid color and gradient forms unsupported by html2canvas', () => {
		const css = source('public/static/css/style.css');
		const cardRule = css.slice(css.indexOf('.hadith-share-card {'), css.indexOf('.hadith-share-card-inner {'));
		expect(cardRule).toContain('--c-footnote-muted: #76787a;');
		expect(cardRule).toContain('background-color: #fbfbfb;');
		expect(cardRule).toContain('background-image: repeating-linear-gradient');
		expect(cardRule).not.toContain('linear-gradient(180deg');
	});
});
