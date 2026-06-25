'use strict';

const debug = require('./Debug')('hadithdb:Utils');
const axios = require("axios");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
const { homedir } = require('os');
const util = require('util');
const sqlite3 = require('sqlite3');
const { marked } = require('marked');
const AdmZip = require('adm-zip');

marked.setOptions({
	gfm: true,
	breaks: true
});

class Utils {

	static CACHENDX;
	static CACHE_SUFFIX_SLUG = '.v119';

	static truncate(s, n, useWordBoundary, before, useHTML) {
		if (!s || s.length <= n) { return s; }
		s = s.replace(/<\/?[^>]+>/g, '');
		var ts = s.slice(0, n - 1);
		ts = useWordBoundary ? ts.slice(0, ts.lastIndexOf(" ")) : ts;
		if (before)
			return (useHTML ? '&hellip;' : '...') + ts;
		else
			return ts + (useHTML ? '&hellip;' : '...');
	}

	static isFalsey(o) {
		return o === undefined || o === null || o === false || Utils.trimToEmpty(o) === '';
	}

	static isTruthy(o) {
		return !Utils.isFalsey(o);
	}


	static wordCount(s) {
		return s.split(' ').length;
	}

	static trimToEmpty(s) {
		if (!s) s = '';
		if (typeof s === 'string')
			s = s.trim();
		return s;
	}

	static emptyIfNull(s) {
		if (s === undefined || s === null) s = '';
		return s;
	}

	static hadithBookTitle(book) {
		var titleEn = Utils.trimToEmpty(book?.name_en || book?.shortName_en || book?.alias);
		var titleAr = Utils.trimToEmpty(book?.title || book?.shortName || '');
		return ['Hadith |', titleEn, titleAr].filter(Boolean).join(' ');
	}

	static markdownToHtml(markdown) {
		markdown = Utils.emptyIfNull(markdown);
		if (markdown === '')
			return '';
		return marked.parse(markdown).replace(/<br>/g, '</p><p>').trim();
	}

	static escSQL(s) {
		if (s) {
			s = s.trim().replace(/(['"])/g, '\\$1');
			s = s.replace(/\n/, '\\n');
		}
		return s;
	}

	static reverse(s) {
		return s.split("").reverse().join("");
	}

	static toTSV(arr, keyNames) {
		var out = '';
		if (keyNames) {
			for (var i = 0; i < keyNames.length; i++) {
				out += keyNames[i];
				if (i < keyNames.length - 1)
					out += '\t';
			}
		} else
			keyNames = Object.keys(arr[0]);
		out += '\n';
		for (i = 0; i < arr.length; i++) {
			for (var j = 0; j < keyNames.length; j++) {
				var val = arr[i][keyNames[j]];
				if (!val) val = 'null';
				out += val.toString().replace(/[\r\n]/g, ' ');
				if (j < keyNames.length - 1)
					out += '\t';
			}
			out += '\n';
		}
		return out;
	}

	static sendJsonDownload(res, filename, content) {
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.end(JSON.stringify(content, null, 2));
	}

	static sendEpubDownload(res, filename, book, results) {
		res.setHeader('Content-Type', 'application/epub+zip');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.end(Utils.toEpub(book, results));
	}

	static safeFilename(s) {
		s = Utils.trimToEmpty(s).toLowerCase();
		s = s.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
		return s || 'download';
	}

	static toEpub(book, results) {
		var zip = new AdmZip();
		var document = results && Array.isArray(results.chapters) ? results : null;
		var title = Utils.trimToEmpty(document?.book?.title?.en || book?.name_en || book?.shortName_en || book?.alias || results?.[0]?.book_name_en || results?.[0]?.book_shortName_en);
		var titleAr = Utils.trimToEmpty(document?.book?.title?.ar || book?.name || book?.shortName || results?.[0]?.book_name || results?.[0]?.book_shortName);
		var author = Utils.trimToEmpty(document?.book?.author?.en || document?.book?.author?.ar || book?.author_en || book?.author || results?.[0]?.book_author);
		var language = 'en';
		var identifier = `hadithunlocked-${Utils.safeFilename(book?.alias || results?.[0]?.book_alias || title)}`;
		var chapters = document ? document.chapters : Utils.epubChapters(results);
		var spineItems = [];
		var manifestItems = [];
		var navItems = [];

		zip.addFile('mimetype', Buffer.from('application/epub+zip'));
		zip.getEntry('mimetype').header.method = 0;
		zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`));

		for (var i = 0; i < chapters.length; i++) {
			var id = `chapter-${i + 1}`;
			var href = `${id}.xhtml`;
			spineItems.push(`<itemref idref="${id}"/>`);
			manifestItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
			navItems.push(`<li><a href="${href}">${Utils.escXml(Utils.epubTitleText(chapters[i]))}</a></li>`);
			zip.addFile(`EPUB/${href}`, Buffer.from(Utils.epubChapterXhtml(chapters[i], title)));
		}
		var fontManifest = Utils.addEpubFonts(zip);

		zip.addFile('EPUB/nav.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}">
<head><title>${Utils.escXml(title)}</title><meta charset="utf-8"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${Utils.escXml(title)}</h1>
    <ol>${navItems.join('')}</ol>
  </nav>
</body>
</html>`));
		zip.addFile('EPUB/package.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${Utils.escXml(identifier)}</dc:identifier>
    <dc:title>${Utils.escXml(title)}</dc:title>
    ${titleAr ? `<dc:title xml:lang="ar">${Utils.escXml(titleAr)}</dc:title>` : ''}
    ${author ? `<dc:creator>${Utils.escXml(author)}</dc:creator>` : ''}
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${fontManifest.join('\n    ')}
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`));
		return zip.toBuffer();
	}

	static epubChapters(results) {
		var chapterMap = new Map();
		for (var i = 0; i < results.length; i++) {
			var row = results[i];
			var chapterKey = row.h1 || 'book';
			if (!chapterMap.has(chapterKey)) {
				chapterMap.set(chapterKey, {
					title: Utils.trimToEmpty(row.h1_title_en || row.h1_title || row.book_name_en || row.book_shortName_en || row.book_alias || 'Book'),
					titleAr: Utils.trimToEmpty(row.h1_title || ''),
					items: []
				});
			}
			chapterMap.get(chapterKey).items.push(row);
		}
		return Array.from(chapterMap.values());
	}

	static epubChapterXhtml(chapter, bookTitle) {
		var body = Utils.epubGroupBody(chapter, 2);
		var chapterTitle = Utils.epubTitleText(chapter);
		var chapterTitleAr = Utils.trimToEmpty(chapter.titleAr || chapter.title?.ar || '');
		return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <title>${Utils.escXml(chapterTitle)} - ${Utils.escXml(bookTitle)}</title>
  <meta charset="utf-8"/>
  <style>
    @font-face { font-family: Kitab; src: url("fonts/kitab-base.woff2"); }
    @font-face { font-family: QuranV1; src: url("fonts/DigitalKhattV1.otf"); }
    body { font-family: serif; line-height: 1.6; }
    article { margin: 0 0 2em; }
    section { margin: 1.5em 0; }
    [dir="rtl"] { font-family: Kitab, serif; text-align: right; }
    .quran-text { font-family: QuranV1, serif; line-height: 2; }
    .item-title { margin-bottom: 0.25em; }
    .item-meta { color: #555; font-style: italic; }
    .footnotes { border-top: 1px solid #ddd; margin-top: 1em; padding-top: 0.5em; font-size: 0.9em; }
    .footnote-ref { font-size: 0.75em; vertical-align: super; }
  </style>
</head>
<body>
  <h1>${Utils.escXml(chapterTitle)}</h1>
  ${chapterTitleAr && chapterTitleAr !== chapterTitle ? `<p dir="rtl" lang="ar">${Utils.escXml(chapterTitleAr)}</p>` : ''}
  ${body}
</body>
</html>`;
	}

	static epubTitleText(group) {
		return Utils.trimToEmpty(group?.title?.en || group?.title || group?.title?.ar || group?.ref || group?.number || 'Chapter');
	}

	static epubGroupBody(group, level) {
		var output = [];
		output.push(Utils.epubLocalizedParagraphs(group.intro));
		(group.items || []).forEach(item => output.push(Utils.epubItemXhtml(item)));
		(group.sections || []).forEach(section => output.push(Utils.epubNestedGroupXhtml(section, level)));
		(group.subsections || []).forEach(subsection => output.push(Utils.epubNestedGroupXhtml(subsection, level)));
		return output.filter(Boolean).join('\n');
	}

	static epubNestedGroupXhtml(group, level) {
		var headingLevel = Math.min(Math.max(level, 2), 6);
		var title = Utils.trimToEmpty(group.title?.en || group.title || group.title?.ar || '');
		var titleAr = Utils.trimToEmpty(group.title?.ar || '');
		return `<section>
  <h${headingLevel}>${Utils.escXml([group.number, title].filter(Boolean).join('. '))}</h${headingLevel}>
  ${titleAr && titleAr !== title ? `<p dir="rtl" lang="ar"><strong>${Utils.escXml(titleAr)}</strong></p>` : ''}
  ${Utils.epubGroupBody(group, headingLevel + 1)}
</section>`;
	}

	static epubItemXhtml(item) {
		var title = Utils.trimToEmpty(item.title?.en || item.title?.ar || item.ref || item.number || '');
		var titleAr = Utils.trimToEmpty(item.title?.ar || '');
		var meta = Utils.trimToEmpty(item.grade?.en || item.grade?.ar || '');
		var footnoteContext = Utils.epubFootnoteContext(item);
		return `<article>
  <h3 class="item-title">${Utils.escXml(Utils.epubItemTitle(item, title))}</h3>
  ${titleAr && titleAr !== title ? `<p dir="rtl" lang="ar"><strong>${Utils.escXml(titleAr)}</strong></p>` : ''}
  ${meta ? `<p class="item-meta">${Utils.escXml(meta)}</p>` : ''}
  ${Utils.epubLocalizedParagraphs(item.chain)}
  ${Utils.epubLocalizedParagraphs(item.quran?.text, true)}
  ${Utils.epubLocalizedParagraphs(item.text, item.quranText, footnoteContext)}
  ${Utils.epubFootnoteAsides(footnoteContext)}
</article>`;
	}

	static epubItemTitle(item, title) {
		var ref = Utils.trimToEmpty(item.ref || '');
		title = Utils.trimToEmpty(title);
		if (!ref)
			return title;
		if (!title)
			return ref;
		var normalizedRefTitle = ref.replace(/^quran:/i, 'Quran ').replace(/:/g, ':');
		if (title.toLowerCase() === normalizedRefTitle.toLowerCase())
			return title;
		return [ref, title].filter(Boolean).join(' - ');
	}

	static epubLocalizedParagraphs(value, quranText, footnoteContext) {
		if (!value)
			return '';
		return [
			Utils.epubMarkdownBlock(value.en, '', 'en', false, footnoteContext),
			Utils.epubMarkdownBlock(value.ar, 'rtl', 'ar', quranText, footnoteContext)
		].join('');
	}

	static epubMarkdownBlock(text, dir, lang, quranText, footnoteContext) {
		text = Utils.trimToEmpty(text);
		if (!text)
			return '';
		var html = Utils.epubMarkdownToXhtml(Utils.epubTextWithFootnoteRefs(text, lang, footnoteContext));
		var attrs = [
			dir ? `dir="${dir}"` : '',
			lang ? `lang="${lang}"` : '',
			quranText ? 'class="quran-text"' : ''
		].filter(Boolean).join(' ');
		return `<div${attrs ? ` ${attrs}` : ''}>${html}</div>`;
	}

	static epubFootnoteContext(item) {
		var base = Utils.safeFilename(item.ref || item.id || item.number || 'item');
		var enNotes = Utils.epubParseFootnotes(item.footnotes?.en, 'en', base, true);
		var arNotes = Utils.epubParseFootnotes(item.footnotes?.ar, 'ar', base, true);
		Utils.epubMergeFootnotes(enNotes, Utils.epubParseFootnotes(item.text?.en, 'en', base, false));
		Utils.epubMergeFootnotes(arNotes, Utils.epubParseFootnotes(item.text?.ar, 'ar', base, false));
		return {
			base: base || 'item',
			notes: {
				en: enNotes,
				ar: arNotes
			},
			inlineCounters: { en: enNotes.size, ar: arNotes.size },
			used: new Set()
		};
	}

	static epubParseFootnotes(value, lang, base, fallback) {
		if (Array.isArray(value)) {
			var arrayNotes = new Map();
			value.forEach((note, index) => {
				var key = Utils.trimToEmpty(note?.key || note?.id || (index + 1).toString());
				var text = Utils.trimToEmpty(note?.text || note?.body || note);
				if (key && text)
					arrayNotes.set(key, { key, text, id: Utils.epubFootnoteId(base, lang, key) });
			});
			return arrayNotes;
		}
		value = Utils.trimToEmpty(value);
		if (!value)
			return new Map();
		var notes = new Map();
		var pattern = /\[\^([^\]]+)\]:\s*([\s\S]*?)(?=\n\[\^[^\]]+\]:|$)/g;
		var match;
		while ((match = pattern.exec(value)) !== null) {
			var key = Utils.trimToEmpty(match[1]);
			var text = Utils.trimToEmpty(match[2]).replace(/\s+/g, ' ');
			if (key && text)
				notes.set(key, { key, text, id: Utils.epubFootnoteId(base, lang, key) });
		}
		if (notes.size === 0 && fallback)
			notes.set('1', { key: '1', text: value.replace(/\s+/g, ' '), id: Utils.epubFootnoteId(base, lang, '1') });
		return notes;
	}

	static epubMergeFootnotes(target, source) {
		source.forEach((note, key) => {
			if (!target.has(key))
				target.set(key, note);
		});
		return target;
	}

	static epubTextWithFootnoteRefs(text, lang, footnoteContext) {
		text = Utils.trimToEmpty(text);
		if (!footnoteContext || !footnoteContext.notes || !footnoteContext.notes[lang])
			return text;
		var notes = footnoteContext.notes[lang];
		text = text.replace(/\[\^([^\]]+)\]:\s*[\s\S]*?(?=\n\[\^[^\]]+\]:|$)/g, '').trim();
		text = text.replace(/\[\^([^\]]+)\]/g, function (marker, key) {
			var note = notes.get(key);
			if (!note)
				return marker;
			footnoteContext.used.add(`${lang}:${key}`);
			return `<a epub:type="noteref" class="footnote-ref" href="#${note.id}" id="${note.id}-ref">[${Utils.escXml(key)}]</a>`;
		});
		text = text.replace(/(?:\\\[|\[)(?:\\\[|\[)([\s\S]*?)(?:\\\]|\])(?:\\\]|\])/g, function (marker, noteText) {
			noteText = Utils.trimToEmpty(noteText).replace(/\s+/g, ' ');
			if (!noteText)
				return '';
			footnoteContext.inlineCounters[lang] = (Number(footnoteContext.inlineCounters[lang]) || 0) + 1;
			var key = footnoteContext.inlineCounters[lang].toString();
			while (notes.has(key)) {
				footnoteContext.inlineCounters[lang] += 1;
				key = footnoteContext.inlineCounters[lang].toString();
			}
			var note = { key, text: noteText, id: Utils.epubFootnoteId(footnoteContext.base, lang, key) };
			notes.set(key, note);
			footnoteContext.used.add(`${lang}:${key}`);
			return `<a epub:type="noteref" class="footnote-ref" href="#${note.id}" id="${note.id}-ref">[${Utils.escXml(key)}]</a>`;
		});
		return text;
	}

	static epubFootnoteAsides(footnoteContext) {
		if (!footnoteContext || !footnoteContext.notes)
			return '';
		var output = [];
		Object.keys(footnoteContext.notes).forEach(lang => {
			footnoteContext.notes[lang].forEach(note => {
				if (!footnoteContext.used.has(`${lang}:${note.key}`))
					return;
				var dir = lang === 'ar' ? ' dir="rtl"' : '';
				output.push(`<aside epub:type="footnote" role="doc-footnote" id="${note.id}"${dir} lang="${lang}">
    <p><a href="#${note.id}-ref">[${Utils.escXml(note.key)}]</a> ${Utils.epubMarkdownInlineToXhtml(note.text)}</p>
  </aside>`);
			});
		});
		return output.length ? `<section class="footnotes">\n  ${output.join('\n  ')}\n</section>` : '';
	}

	static epubMarkdownToXhtml(markdown) {
		markdown = Utils.trimToEmpty(markdown);
		if (!markdown)
			return '';
		return Utils.epubNormalizeXhtml(marked.parse(markdown));
	}

	static epubMarkdownInlineToXhtml(markdown) {
		markdown = Utils.trimToEmpty(markdown);
		if (!markdown)
			return '';
		return Utils.epubNormalizeXhtml(marked.parseInline(markdown));
	}

	static epubNormalizeXhtml(html) {
		return Utils.trimToEmpty(html)
			.replace(/<br>/g, '<br/>')
			.replace(/<hr>/g, '<hr/>')
			.replace(/&nbsp;/g, '&#160;');
	}

	static epubFootnoteId(base, lang, key) {
		return `fn-${Utils.safeFilename(base || 'item')}-${Utils.safeFilename(lang || 'note')}-${Utils.safeFilename(key || '1')}`;
	}

	static addEpubFonts(zip) {
		var fonts = [
			{ id: 'font-kitab', href: 'fonts/kitab-base.woff2', media: 'font/woff2', file: `${__dirname}/../public/fonts/kitab-base.woff2` },
			{ id: 'font-quran-v1', href: 'fonts/DigitalKhattV1.otf', media: 'font/otf', file: `${__dirname}/../public/fonts/DigitalKhattV1.otf` }
		];
		var manifest = [];
		fonts.forEach(font => {
			if (!fsSync.existsSync(font.file))
				return;
			zip.addFile(`EPUB/${font.href}`, fsSync.readFileSync(font.file));
			manifest.push(`<item id="${font.id}" href="${font.href}" media-type="${font.media}"/>`);
		});
		return manifest;
	}

	static escXml(s) {
		return Utils.emptyIfNull(s).toString()
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');
	}

	static jsonLd(data) {
		return JSON.stringify(data, null, 2)
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029');
	}

	static jsonLdScript(data) {
		return `<script type="application/ld+json">\n${Utils.jsonLd(data)}\n</script>`;
	}

	static toMarkdown(results) {
		var out = '';
		for (var i = 0; i < results.length; i++) {
			out +=
`
**Hadith: ${results[i].title}**
- ~~«${results[i].body}» ([${results[0].book_shortName} ${results[0].ar.num}](https://hadithunlocked.com/${results[0].ref}) ${results[0].grade_grade})~~
> ${results[i].body_en}
`;
		}
		return out;
	}

	static lettersToNumber(s) {
		s = s.toUpperCase();
		var out = 0, len = s.length;
		for (var pos = 0; pos < len; pos++) {
			out += (s.charCodeAt(pos) - 64) * Math.pow(26, len - pos - 1);
		}
		return out;
	}

	static sql(s) {
		if (s)
			return s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
		return s;
	}

	static regexExtract(s, re) {
		var arr = re.exec(s);
		if (arr)
			return arr[1];
		return null;
	}

	static sleep(n) {
		Utils.msleep(n * 1000);
	}

	static msleep(n) {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
	}

	static getOpenAIModel(model) {
		if (Utils.isTruthy(model))
			return Utils.trimToEmpty(model);
		if (Utils.isTruthy(process.env.OPENAI_MODEL))
			return Utils.trimToEmpty(process.env.OPENAI_MODEL);
		if (global.settings?.openAI && Utils.isTruthy(global.settings.openAI.model))
			return Utils.trimToEmpty(global.settings.openAI.model);
		return 'gpt-5.2-chat-latest';
	}

	static async openai(model, prompt) {
		if (prompt === undefined) {
			prompt = model;
			model = null;
		}
		model = Utils.getOpenAIModel(model);
		if (prompt.constructor != Array)
			prompt = [prompt];
		var data = {
			model: model,
			messages: []
		};
		for (var p of prompt)
			data.messages.push({
				role: 'user',
				content: p
			});
		var res = null;
		const t0 = Date.now();
		try {
			debug(`OpenAI chat start model=${model} prompts=${prompt.length}`);
			res = await axios.post(`https://api.openai.com/v1/chat/completions`, JSON.stringify(data), {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${global.settings.openAI.key}`
				}
			});
			const elapsedMs = Date.now() - t0;
			debug.slow('OpenAI chat completions', elapsedMs, `model=${model} prompts=${prompt.length}`);
			debug(`OpenAI ${model} ${prompt}:\n${res.data.choices[0].message.content}`);
		} catch (e) {
			debug.error(`OpenAI chat failed model=${model} prompts=${prompt.length} elapsedMs=${Date.now() - t0} status=${e.response?.status || 'n/a'}: ${e.response?.statusText || e.message}\n${e.stack || ''}`);
			throw e;
		}
		return res.data.choices[0].message.content;
	}

	static replacePBUH(s) {
		s = s.replace(/[\[\(]]PBUH[\]\)]/g, ' ﷺ ');
		s = s.replace(/[\[\(]SAW[\]\)]/g, ' ﷺ ');
		s = s.replace(/[\[\(]peace be upon him[\]\)]/g, ' ﷺ ');
		s = s.replace(/peace be upon him/g, ' ﷺ ');
		s = s.replace(/[\[\(]pbuh[\]\)]/g, ' ﷺ ');
		s = s.replace(/, peace be upon him, /g, ' ﷺ ');
		s = s.replace(/[\[\(]ﷺ[\]\)]/g, ' ﷺ ');
		s = s.replace(/صلى الله عليه وسلم/g, ' ﷺ ');
		return s;
	}

	static reqToFilename(req) {
		return Utils.cacheReqToFilename(req);
	}

	static cacheReqToFilename(req, options) {
		options = options || {};
		var url = req.url || '';
		if (options.includeBaseUrl)
			url = `${req.baseUrl || ''}${url}`;
		var parts = url.split('?');
		if (parts.length > 1) {
			var params = new URLSearchParams(parts[1]);
			params.delete('flush');
			if (params.get('o') === '0')
				params.delete('o');
			var query = params.toString();
			url = query ? `${parts[0]}?${query}` : parts[0];
		}
		return url.replace(/\//g, '_');
	}

	static cacheSuffix() {
		return Utils.CACHE_SUFFIX_SLUG;
	}

	static assetVersionSuffix() {
		return Utils.cacheSuffix().replace(/^\./, '');
	}

	static cacheFileFromFilename(filename, extension) {
		extension = extension || 'html';
		return `${homedir}/.hadithdb/cache/${filename}${Utils.cacheSuffix()}.${extension}`;
	}

	static htmlCacheFile(req, options) {
		return Utils.cacheFileFromFilename(Utils.cacheReqToFilename(req, options), 'html');
	}

	static htmlCacheFragmentDir() {
		return `${homedir}/.hadithdb/cache/fragments`;
	}

	static htmlCacheFragmentMarker(kind, filename) {
		return `<!--hadithdb-cache-fragment:${kind}:${filename}-->`;
	}

	static htmlCacheFragmentPattern(kind) {
		return new RegExp(`<!--hadithdb-cache:${kind}:start-->[\\s\\S]*?<!--hadithdb-cache:${kind}:end-->`, 'g');
	}

	static cacheHtmlFragment(kind, html) {
		var fragment = Utils.normalizedCacheFragmentHtml(kind, html);
		var hash = crypto.createHash('sha256').update(fragment).digest('hex').substring(0, 16);
		var filename = `${kind}-${hash}${Utils.cacheSuffix()}.html`;
		var fragmentDir = Utils.htmlCacheFragmentDir();
		var fragmentFile = `${fragmentDir}/${filename}`;
		fsSync.mkdirSync(fragmentDir, { recursive: true });
		if (!fsSync.existsSync(fragmentFile))
			fsSync.writeFileSync(fragmentFile, fragment);
		return Utils.htmlCacheFragmentMarker(kind, filename);
	}

	static normalizedCacheFragmentHtml(kind, html) {
		var fragment = html.toString();
		if (kind === 'top-menu')
			fragment = fragment.replace(/\s*<li class="nav-item edit-gear">[\s\S]*?<\/li>/g, '');
		if (kind === 'left-rail')
			fragment = fragment
				.replace(/\s*<li class="edit-gear"><hr><\/li>/g, '')
				.replace(/\s*<li class="nav-item edit-gear">[\s\S]*?<\/li>/g, '');
		if (kind === 'header')
			fragment = fragment.replace(/\s*<li class="nav-item edit-gear">[\s\S]*?<\/li>/g, '');
		return fragment;
	}

	static splitCachedHtmlFragments(html) {
		if (!html)
			return html;
		var shell = html.toString();
		for (const kind of ['top-menu', 'left-rail', 'footer', 'header']) {
			shell = shell.replace(Utils.htmlCacheFragmentPattern(kind), function (fragment) {
				return Utils.cacheHtmlFragment(kind, fragment);
			});
		}
		return shell;
	}

	static composeCachedHtmlFragments(html, seen) {
		if (!html)
			return html;
		seen = seen || new Set();
		return html.toString().replace(/<!--hadithdb-cache-fragment:([a-z-]+):([^>]+)-->/g, function (marker, kind, filename) {
			if (seen.has(filename))
				return marker;
			var fragmentFile = `${Utils.htmlCacheFragmentDir()}/${filename}`;
			if (!fsSync.existsSync(fragmentFile))
				return marker;
			seen.add(filename);
			var fragment = fsSync.readFileSync(fragmentFile, 'utf8');
			return Utils.composeCachedHtmlFragments(fragment, seen);
		});
	}

	static writeCachedHtml(cachedFile, html) {
		fsSync.writeFileSync(cachedFile, Utils.splitCachedHtmlFragments(html));
	}

	static readCachedHtml(cachedFile, req) {
		var html = fsSync.readFileSync(cachedFile, 'utf8');
		html = Utils.composeCachedHtmlFragments(html);
		return Utils.injectCachedAdminControls(html, req);
	}

	static versionedCacheName(baseName) {
		return `${baseName}${Utils.cacheSuffix()}`;
	}

	static shouldFlushCache(req) {
		return Boolean(req && req.query && 'flush' in req.query);
	}

	static escapeAttribute(value) {
		return Utils.emptyIfNull(value).toString()
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	static injectCachedHeaderSearchAction(html, req) {
		if (!html)
			return html;
		var action = Utils.escapeAttribute(Utils.globalSearchBaseUrl(req));
		return html.toString()
			.replace(/<form action="[^"]*">(\s*<input role="search" type="text" class="form-control search-click" name="q")/g, `<form action="${action}">$1`)
			.replace(/<form action="[^"]*">(\s*<input role="search" type="text" class="form-control mb-2" name="q")/g, `<form action="${action}">$1`);
	}

	static scriptAssetVersion() {
		return Utils.assetVersionSuffix();
	}

	static styleAssetVersion() {
		return Utils.assetVersionSuffix();
	}

	static injectCachedAssetVersions(html) {
		if (!html)
			return html;
		return html.toString()
			.replace(
				/(<link\s+rel="stylesheet"\s+href="\/stylesheets\/style\.css)(?:\?v=[^"]*)?("\s+rel="stylesheet">)/g,
				`$1?v=${Utils.styleAssetVersion()}$2`
			)
			.replace(
				/(<script\s+src="\/javascripts\/script\.js)(?:\?v=[^"]*)?("><\/script>)/g,
				`$1?v=${Utils.scriptAssetVersion()}$2`
			);
	}

	static injectCachedMenuIconMarkup(html) {
		if (!html)
			return html;
		return html.toString()
			.replace(/<i class="bi bi-book"><\/i> Quran/g, '<img class="app-menu-icon app-menu-icon-img" src="/quran-icon.svg" alt="" aria-hidden="true"> Quran')
			.replace(/<i class="bi bi-translate"><\/i> Translations/g, '<i class="app-menu-icon bi bi-translate" aria-hidden="true"></i> Translations')
			.replace(/<i class="bi bi-book"><\/i> Tafsir/g, '<i class="app-menu-icon bi bi-book-half" aria-hidden="true"></i> Tafsir')
			.replace(/<i class="bi bi-book"><\/i> Hadith/g, '<i class="app-menu-icon bi bi-book" aria-hidden="true"></i> Hadith')
			.replace(/<i class="bi bi-journals"><\/i> Books/g, '<img class="app-menu-icon app-menu-icon-img" src="/books-icon.svg" alt="" aria-hidden="true"> Books')
			.replace(/<i class="bi bi-text-paragraph"><\/i> Blog/g, '<i class="app-menu-icon bi bi-text-paragraph" aria-hidden="true"></i> Blog')
			.replace(/<i class="bi bi-gear"><\/i> My Settings/g, '<i class="app-menu-icon bi bi-gear" aria-hidden="true"></i> My Settings')
			.replace(/<i class="bi bi-bookmark"><\/i> My Bookmarks/g, '<i class="app-menu-icon bi bi-bookmark" aria-hidden="true"></i> My Bookmarks')
			.replace(/<i class="bi bi-heart"><\/i> Liked/g, '<i class="app-menu-icon bi bi-heart" aria-hidden="true"></i> Liked')
			.replace(/<i class="bi bi-chat-right-text"><\/i> Latest Reflections/g, '<i class="app-menu-icon bi bi-chat-right-text" aria-hidden="true"></i> Latest Reflections')
			.replace(/<i class="bi bi-star"><\/i> Highlighted/g, '<i class="app-menu-icon bi bi-star" aria-hidden="true"></i> Highlighted')
			.replace(/<i class="bi bi-card-heading"><\/i> Titled/g, '<i class="app-menu-icon bi bi-card-heading" aria-hidden="true"></i> Titled');
	}

	static adminGearHtml(editMode, mobile) {
		var icon = editMode ? 'bi-gear-fill' : 'bi-gear';
		var label = editMode ? 'View' : 'Edit';
		var title = editMode ? 'Turn off admin mode' : 'Turn on admin mode';
		var onclick = "var editMode=(document.cookie ? document.cookie.match(/(?:^|; )editMode=1(?:;|$)/) : false); if (window.setHadithAdminMode) { setHadithAdminMode(!editMode); } else { try { localStorage.setItem('hadithdb_edit_mode', editMode ? '0' : '1'); } catch (err) {} if (editMode) { document.cookie='editMode=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT'; if (window.HADITH_COOKIE_DOMAIN) document.cookie='editMode=;path=/;domain='+window.HADITH_COOKIE_DOMAIN+';expires=Thu, 01 Jan 1970 00:00:00 GMT'; } else { var domain=window.HADITH_COOKIE_DOMAIN ? ';domain='+window.HADITH_COOKIE_DOMAIN : ''; document.cookie='editMode=1;path=/;max-age=7776000;samesite=lax'+domain; } location.reload(); }";
		if (mobile)
			return `<li class="nav-item edit-gear"><a class="nav-link" role="button" onclick="${onclick}"><i class="app-menu-icon bi ${icon}" aria-hidden="true"></i> <strong>${label}</strong></a></li>`;
		return `<li class="nav-item edit-gear"><a class="nav-link" role="button" title="${title}" aria-label="${title}" onclick="${onclick}"><i class="bi ${icon}"></i></a></li>`;
	}

	static injectCachedAdminControls(html, req) {
		html = Utils.injectCachedHeaderSearchAction(html, req);
		html = Utils.injectCachedAssetVersions(html);
		html = Utils.injectCachedMenuIconMarkup(html);
		if (!html || !req || !req.admin)
			return html;
		html = html.toString();
		if (html.indexOf('<li class="nav-item edit-gear"') >= 0)
			return html;

		var editMode = req.editMode;
		var desktopGear = Utils.adminGearHtml(editMode, false);
		var mobileGear = `<li class="edit-gear"><hr></li>\n              ${Utils.adminGearHtml(editMode, true)}`;

		html = html.replace(
			/(\s*)<li class="nav-item search-click-toggle">/,
			`$1${desktopGear}$1<li class="nav-item search-click-toggle">`
		);
		html = html.replace(
			/(\s*)<ul class="col-5 nav flex-column offcanvas-col2">/,
			`\n              ${mobileGear}$1<ul class="col-5 nav flex-column offcanvas-col2">`
		);
		return html;
	}

	static quranBaseUrl(req) {
		var site = global.settings && global.settings.site ? global.settings.site : {};
		if (Utils.isLocalhostRequest(req))
			return Utils.requestOrigin(req) || '';
		if (Utils.isLocalTldRequest(req) && site.quranUrlLocal)
			return Utils.withRequestPort(req, site.quranUrlLocal);
		return site.quranUrl || '';
	}

	static hadithBaseUrl(req) {
		var site = global.settings && global.settings.site ? global.settings.site : {};
		if (Utils.isLocalhostRequest(req))
			return Utils.requestOrigin(req) || '';
		if (Utils.isLocalTldRequest(req) && site.urlLocal)
			return Utils.withRequestPort(req, site.urlLocal);
		return site.url || '';
	}

	static globalSearchBaseUrl(req) {
		var site = global.settings && global.settings.site ? global.settings.site : {};
		if (Utils.isLocalhostRequest(req))
			return Utils.requestOrigin(req) || '/';
		var useLocal = site.urlLocal && (
			Utils.isLocalTldRequest(req)
			|| Utils.isLocalhostRequest(req)
			|| Utils.requestMatchesBaseUrl(req, site.urlLocal)
			|| Utils.requestMatchesBaseUrl(req, site.quranUrlLocal)
		);
		var baseUrl = useLocal ? site.urlLocal : site.url;
		if (!baseUrl)
			return '/';
		return useLocal ? Utils.withRequestPort(req, baseUrl) : baseUrl;
	}

	static requestMatchesBaseUrl(req, baseUrl) {
		if (!baseUrl)
			return false;
		try {
			return Utils.requestHostname(req) === new URL(baseUrl).hostname.toLowerCase();
		} catch (err) {
			return false;
		}
	}

	static requestHostname(req) {
		if (req && req.hostname)
			return req.hostname.toString().toLowerCase();
		var host = '';
		if (req && typeof req.get === 'function')
			host = req.get('host') || '';
		if (!host && req && req.headers)
			host = req.headers.host || '';
		host = host.toString().trim().toLowerCase();
		return host.replace(/:\d+$/, '');
	}

	static requestOrigin(req) {
		var host = '';
		if (req && typeof req.get === 'function')
			host = req.get('host') || '';
		if (!host && req && req.headers)
			host = req.headers.host || '';
		host = host.toString().trim();
		if (!host)
			return '';
		var protocol = (req && req.protocol ? req.protocol : 'http').toString().replace(/:$/, '');
		return `${protocol}://${host}`;
	}

	static withRequestPort(req, baseUrl) {
		var port = Utils.requestPort(req);
		if (!port)
			return baseUrl;
		try {
			var url = new URL(baseUrl);
			url.port = port;
			return url.origin;
		} catch (err) {
			return baseUrl;
		}
	}

	static requestPort(req) {
		var host = '';
		if (req && typeof req.get === 'function')
			host = req.get('host') || '';
		if (!host && req && req.headers)
			host = req.headers.host || '';
		host = host.toString().trim();
		var match = host.match(/:(\d+)$/);
		if (!match || match[1] === '80' || match[1] === '443')
			return '';
		return match[1];
	}

	static isLocalTldRequest(req) {
		var env = (process.env.ENV || '').toString().trim().toLowerCase();
		if (env === 'prod' || env === 'production')
			return false;
		var hostname = (req && req.hostname ? req.hostname : '').toString().toLowerCase();
		return hostname.endsWith('.local');
	}

	static isLocalhostRequest(req) {
		var hostname = (req && req.hostname ? req.hostname : '').toString().toLowerCase();
		return hostname === 'localhost'
			|| hostname.endsWith('.localhost')
			|| hostname === '127.0.0.1'
			|| hostname === '::1'
			|| hostname === '[::1]';
	}

	static isQuranSubdomainRequest(req) {
		var hostname = (req && req.hostname ? req.hostname : '').toString().toLowerCase();
		return hostname.split('.')[0] === 'quran';
	}

	static quranPath(path) {
		if (!path)
			return path;
		path = path.toString();
		if (/^https?:\/\//i.test(path))
			return path;
		var match = path.match(/^([^?#]*)(.*)$/);
		var pathname = match ? match[1] : path;
		var suffix = match ? match[2] : '';
		if (pathname.charAt(0) !== '/')
			pathname = '/' + pathname;
		if (pathname === '/quran' || pathname.indexOf('/quran/') === 0 || pathname.indexOf('/quran:') === 0)
			return pathname + suffix;
		if (/^\/\d/.test(pathname) || /^\/[a-z][a-z0-9_-]*[:/]/i.test(pathname))
			return `/quran${pathname}${suffix}`;
		return pathname + suffix;
	}

	static isQuranUrlPath(path) {
		if (!path)
			return false;
		path = path.toString();
		path = path.split(/[?#]/)[0];
		return path === '/quran'
			|| path === 'quran'
			|| path.indexOf('/quran/') === 0
			|| path.indexOf('quran/') === 0
			|| path.indexOf('/quran:') === 0
			|| path.indexOf('quran:') === 0;
	}

	static quranUrl(req, path) {
		if (/^https?:\/\//i.test((path || '').toString()))
			return path;
		var quranPath = Utils.quranPath(path);
		if (!Utils.isLocalhostRequest(req))
			return Utils.quranBaseUrl(req) + quranPath;
		if (Utils.isQuranSubdomainRequest(req))
			return quranPath;
		return path;
	}

	static urlFor(req, path) {
		if (Utils.isQuranUrlPath(path))
			return Utils.quranUrl(req, path);
		if (!Utils.isLocalhostRequest(req) && Utils.isQuranSubdomainRequest(req)) {
			path = (path || '').toString();
			if (/^https?:\/\//i.test(path))
				return path;
			if (path.charAt(0) !== '/')
				path = '/' + path;
			return Utils.hadithBaseUrl(req) + path;
		}
		return path;
	}

	static async setupCacheIndex() {
		if (Utils.CACHENDX === undefined) {
			debug(`initializing cache index`);
			const db = new sqlite3.Database(`${homedir}/.hadithdb/cachendx.db`);
			db.runAsync = util.promisify(db.run.bind(db));
			db.allAsync = util.promisify(db.all.bind(db));
			Utils.CACHENDX = db;
			await Utils.ensureCacheIndexSchema(db);
		}
		return Utils.CACHENDX;
	}

	static async ensureCacheIndexSchema(db) {
		await db.runAsync('CREATE TABLE IF NOT EXISTS cachendx (id TEXT NOT NULL, filename TEXT NOT NULL, PRIMARY KEY(id, filename));');
		const columns = await db.allAsync('PRAGMA table_info(cachendx);');
		const idColumn = columns.find(column => column.name === 'id');
		const filenameColumn = columns.find(column => column.name === 'filename');
		if (idColumn?.pk && !filenameColumn?.pk) {
			debug('migrating cache index schema to many-to-many refs');
			await db.runAsync('DROP TABLE IF EXISTS cachendx_legacy;');
			await db.runAsync('ALTER TABLE cachendx RENAME TO cachendx_legacy;');
			await db.runAsync('CREATE TABLE cachendx (id TEXT NOT NULL, filename TEXT NOT NULL, PRIMARY KEY(id, filename));');
			await db.runAsync('INSERT OR IGNORE INTO cachendx(id, filename) SELECT id, filename FROM cachendx_legacy WHERE id IS NOT NULL AND filename IS NOT NULL;');
			await db.runAsync('DROP TABLE cachendx_legacy;');
		}
		await db.runAsync('CREATE INDEX IF NOT EXISTS cachendx_filename ON cachendx(filename);');
	}

	static async indexCachedItem(keys, value) {
		const cachedb = await Utils.setupCacheIndex();
		keys = Array.from(new Set((keys || []).filter(Boolean).map(key => key.toString())));
		if (!value || keys.length < 1)
			return;
		await cachedb.runAsync(`DELETE FROM cachendx WHERE filename=?;`, [value]);
		for (const key of keys)
			await cachedb.runAsync(`INSERT OR IGNORE INTO cachendx(id, filename) VALUES (?, ?);`, [key, value]);
	}

	static async flushCachedFile(filename) {
		let deleted = false;
		try {
			const stats = await fs.stat(filename);
			if (stats.isFile()) {
				await fs.unlink(filename);
				debug(`deleted file: ${filename}`);
				deleted = true;
			}
		} catch (error) {
			if (error && error.code !== 'ENOENT')
				debug('unable to flush cache:', error);
		}
		try {
			const cachedb = await Utils.setupCacheIndex();
			await cachedb.runAsync(`DELETE FROM cachendx WHERE filename=?;`, [filename]);
		} catch (error) {
			debug('unable to clear cache index filename:', error);
		}
		return deleted;
	}

	static async flushCacheContaining(key) {
		const cachedb = await Utils.setupCacheIndex();
		debug(`flushing cache containing '${key}'`);
		try {
			var rows = await cachedb.allAsync(`SELECT DISTINCT filename FROM cachendx WHERE id=?;`, [key]);
			if (rows) {
				for (const row of rows)
					await Utils.flushCachedFile(row.filename);
				await cachedb.runAsync(`DELETE FROM cachendx WHERE id=?;`, [key]);
				debug('cache flush complete');
			}
		} catch (error) {
			debug('unable to flush cache:', error);
		}
	}

}

module.exports = Utils;
