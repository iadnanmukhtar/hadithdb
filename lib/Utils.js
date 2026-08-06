'use strict';

const debug = require('./Debug')('hadithdb:Utils');
const axios = require("axios");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
const zlib = require("zlib");
const path = require("path");
const { homedir } = require('os');
const util = require('util');
const sqlite3 = require('sqlite3');
const { marked } = require('marked');
const cheerio = require('cheerio');
const Arabic = require('./Arabic');
const GoogleAnalytics = require('./GoogleAnalytics');

marked.setOptions({
	gfm: true,
	breaks: true
});

class Utils {

	static CACHENDX;
	static DEFAULT_QURAN_BASE_URL = 'https://quran.islamunlocked.com';
	static DEFAULT_HADITH_BASE_URL = 'https://hadithunlocked.com';
	static CACHE_SUFFIX_SLUG = '.v370';
	static SCRIPT_ASSET_SUFFIX_SLUG = '.v372';
	static CRC32_TABLE;
	static CACHE_GZIP_SUFFIX = '.gz';
	static DEFAULT_CACHE_MAX_AGE_DAYS = 3;

	static diskCacheEnabled() {
		const value = (process.env.CACHE_DISK || '').toString().trim().toLowerCase();
		if (!value)
			return true;
		return !['0', 'false', 'no', 'off'].includes(value);
	}

	static cacheMaxAgeMs() {
		const configured = Number(global.settings?.cache?.maxAgeDays);
		const days = Number.isFinite(configured) && configured > 0
			? configured
			: Utils.DEFAULT_CACHE_MAX_AGE_DAYS;
		return days * 24 * 60 * 60 * 1000;
	}

	static isCacheFileFresh(filename) {
		if (!Utils.diskCacheEnabled())
			return false;
		try {
			const maxAgeMs = Utils.cacheMaxAgeMs();
			return Date.now() - fsSync.statSync(filename).birthtimeMs < maxAgeMs;
		} catch (error) {
			return false;
		}
	}

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

	static quranSurahNameLigature(surahNumber) {
		surahNumber = parseInt(Arabic.toLatinDigits(Utils.emptyIfNull(surahNumber).toString()), 10);
		if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114)
			return '';
		return `surah${surahNumber.toString().padStart(3, '0')}`;
	}

	static quranQcfSurahHeaderGlyph(surahNumber) {
		surahNumber = parseInt(Arabic.toLatinDigits(Utils.emptyIfNull(surahNumber).toString()), 10);
		if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114)
			return '';
		const glyphs = 'ﱅﱆﱇﱊﱋﱎﱏﱑﱒﱓﱕﱖﱘﱚﱛﱜﱝﱞﱡﱢﱤﭑﭒﭔﭕﭗﭘﭚﭛﭝﭞﭠﭡﭣﭤﭦﭧﭩﭪﭬﭭﭯﭰﭲﭳﭵﭶﭸﭹﭻﭼﭾﭿﮁﮂﮄﮅﮇﮈﮊﮋﮍﮎﮐﮑﮓﮔﮖﮗﮙﮚﮜﮝﮟﮠﮢﮣﮥﮦﮨﮩﮫﮬﮮﮯﮱ﮲﮴﮵﮷﮸﮺﮻﮽﮾﯀﯁ﯓﯔﯖﯗﯙﯚﯜﯝﯟﯠﯢﯣﯥﯦﯨﯩﯫ';
		return Array.from(glyphs)[surahNumber - 1] || '';
	}

	static hadithBookTitle(book) {
		var titleEn = Utils.trimToEmpty(book?.name_en || book?.shortName_en || book?.alias);
		var authorEn = Utils.trimToEmpty(book?.author_en || book?.author || '');
		return [titleEn, authorEn].filter(Boolean).join(' | ');
	}

	static englishAuthorSurname(book) {
		var shortName = Utils.trimToEmpty(book?.shortName_en || '');
		if (shortName)
			return shortName;
		var author = Utils.trimToEmpty(book?.author_en || book?.author || '');
		if (!author)
			return '';
		author = author.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
		var parts = author.split(' ').filter(Boolean);
		return parts.length ? parts[parts.length - 1].replace(/[.,;:]+$/g, '') : '';
	}

	static markdownToHtml(markdown) {
		markdown = Utils.normalizeMarkdownForRendering(markdown);
		if (markdown === '')
			return '';
		return marked.parse(markdown).replace(/<br>/g, '</p><p>').trim();
	}

	static normalizeMarkdownForRendering(markdown) {
		return Utils.emptyIfNull(markdown)
			.replace(/(^|[^\*])\*\*([^\n*]*?\S)[ \t]+\*\*(?!\*)/g, '$1**$2**')
			.replace(/(^|[^\*])\*([^\n*]*?\S)[ \t]+\*(?!\*)/g, '$1*$2*')
			.replace(/(^|[^_])__([^\n_]*?\S)[ \t]+__(?!_)/g, '$1__$2__')
			.replace(/(^|[^_])_([^\n_]*?\S)[ \t]+_(?!_)/g, '$1_$2_');
	}

	static htmlToMarkdown(html) {
		html = Utils.emptyIfNull(html);
		if (!/<[a-z][\s\S]*>/i.test(html))
			return Utils.normalizeMarkdownSource(html);
		const $ = cheerio.load(html, { decodeEntities: true }, false);
		const blocks = [];
		const rootNodes = $('body').length ? $('body').contents().toArray() : $.root().contents().toArray();
		for (const node of rootNodes)
			Utils.collectMarkdownBlocks($, node, blocks);
		return Utils.normalizeMarkdownSource(blocks.map(block => block.trim()).filter(Boolean).join('\n\n'));
	}

	static normalizeMarkdownSource(text) {
		return Utils.emptyIfNull(text)
			.replace(/\r\n?/g, '\n')
			.replace(/\u00a0/g, ' ')
			.split(/\n{2,}/)
			.map(block => block.split('\n').map(line => line.trim()).join('\n').trim())
			.filter(Boolean)
			.join('\n\n');
	}

	static collectMarkdownBlocks($, node, blocks) {
		if (!node)
			return;
		if (node.type === 'text') {
			const text = Utils.normalizeMarkdownSource(node.data || '')
				.split('\n\n')
				.map(Utils.escapeMarkdownLiterals)
				.join('\n\n');
			if (text)
				blocks.push(text);
			return;
		}
		const name = (node.name || '').toLowerCase();
		if (name === 'p') {
			const text = Utils.renderMarkdownInline($, $(node).contents().toArray()).trim();
			if (text)
				blocks.push(text);
			return;
		}
		const heading = /^h([1-6])$/.exec(name);
		if (heading) {
			const text = Utils.renderMarkdownInline($, $(node).contents().toArray()).trim();
			if (text)
				blocks.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
			return;
		}
		if (name === 'blockquote') {
			const inner = [];
			$(node).contents().toArray().forEach(child => Utils.collectMarkdownBlocks($, child, inner));
			const text = inner.join('\n\n').split('\n').map(line => `> ${line}`).join('\n').trim();
			if (text)
				blocks.push(text);
			return;
		}
		if (name === 'ul' || name === 'ol') {
			const items = [];
			$(node).children('li').each(function (index) {
				const text = Utils.renderMarkdownInline($, $(this).contents().toArray()).trim();
				if (text)
					items.push(`${name === 'ol' ? `${index + 1}.` : '-'} ${text}`);
			});
			if (items.length)
				blocks.push(items.join('\n'));
			return;
		}
		if (name === 'br') {
			blocks.push('');
			return;
		}
		for (const child of $(node).contents().toArray())
			Utils.collectMarkdownBlocks($, child, blocks);
	}

	static renderMarkdownInline($, nodes) {
		return nodes.map(node => {
			if (node.type === 'text')
				return Utils.escapeMarkdownLiterals(node.data || '');
			const name = (node.name || '').toLowerCase();
			if (name === 'br')
				return '\n';
			const content = Utils.renderMarkdownInline($, $(node).contents().toArray());
			if ((name === 'b' || name === 'strong') && content.trim())
				return `**${content.trim()}**`;
			if ((name === 'i' || name === 'em') && content.trim())
				return `*${content.trim()}*`;
			if (name === 'code' && content.trim())
				return `\`${content.trim().replace(/`/g, '\\`')}\``;
			if (name === 'a' && content.trim()) {
				const href = Utils.emptyIfNull($(node).attr('href'));
				return href ? `[${content.trim()}](${href})` : content;
			}
			return content;
		}).join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
	}

	static escapeMarkdownLiterals(text) {
		return Utils.emptyIfNull(text).replace(/([`*[\]])/g, '\\$1');
	}

	static escapeMarkdownText(text) {
		return Utils.emptyIfNull(text).toString().replace(/([\\()[\]_*`~>#+\-=|{}.!])/g, '\\$1');
	}

	static stripQuranDisplayFootnotes(value) {
		value = Utils.emptyIfNull(value).toString();
		if (!value)
			return '';
		return value
			.replace(/\r\n?/g, '\n')
			.replace(/(?:^|\n)[ \t]*\[\^[^\]\n]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/g, '\n')
			.replace(/\[\^[^\]\n]+\]/g, '')
			.replace(/(?:\\\[|\[)(?:\\\[|\[)([\s\S]*?)(?:\\\]|\])(?:\\\]|\])/g, '')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	}

	static stripQuranDisplayFootnoteHtml(html) {
		html = Utils.emptyIfNull(html).toString();
		if (!html)
			return '';
		return html
			.replace(/<sup\b(?=[^>]*class=["'][^"']*\bfootnote-ref\b[^"']*["'])[^>]*>[\s\S]*?<\/sup>/gi, '')
			.replace(/<a\b(?=[^>]*href=["']#[^"']*fn[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi, '')
			.replace(/<hr\b(?=[^>]*class=["'][^"']*\bfootnotes-sep\b[^"']*["'])[^>]*>/gi, '')
			.replace(/<section\b(?=[^>]*class=["'][^"']*\bfootnotes\b[^"']*["'])[^>]*>[\s\S]*?<\/section>/gi, '')
			.replace(/<(?:footer|div)\b(?=[^>]*class=["'][^"']*\bfootnote\b[^"']*["'])[^>]*>[\s\S]*?<\/(?:footer|div)>/gi, '')
			.trim();
	}

	static quranDisplayMarkdownToHtml(markdown) {
		markdown = Utils.stripQuranDisplayFootnotes(markdown);
		if (!markdown)
			return '';
		return Utils.stripQuranDisplayFootnoteHtml(Utils.markdownToHtml(markdown));
	}

	static quranDisplayText(value) {
		value = Utils.stripQuranDisplayFootnotes(value);
		if (!value)
			return '';
		return Utils.stripQuranDisplayFootnoteHtml(value)
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim();
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
		s = Utils.trimToEmpty(s).toString().toLowerCase();
		s = s.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
		return s || 'download';
	}

	static toEpub(book, results) {
		var files = [];
		var document = results && Array.isArray(results.chapters) ? results : null;
		var title = Utils.trimToEmpty(document?.book?.title?.en || book?.name_en || book?.shortName_en || book?.alias || results?.[0]?.book_name_en || results?.[0]?.book_shortName_en);
		var titleAr = Utils.trimToEmpty(document?.book?.title?.ar || book?.name || book?.shortName || results?.[0]?.book_name || results?.[0]?.book_shortName);
		var author = Utils.trimToEmpty(document?.book?.author?.en || document?.book?.author?.ar || book?.author_en || book?.author || results?.[0]?.book_author);
		var sourceMetadata = Utils.epubSourceMetadata(document, book);
		var language = 'en';
		if (!title)
			title = 'Book';
		var identifier = `hadithunlocked-${Utils.safeFilename(book?.alias || results?.[0]?.book_alias || title)}`;
		var chapters = Utils.epubEnsureChapters(document ? document.chapters : Utils.epubChapters(results), document, book, title, titleAr);
		var spineItems = [];
		var manifestItems = [];
		var navItems = [];

		Utils.addEpubFile(files, 'mimetype', 'application/epub+zip', { store: true });
		Utils.addEpubFile(files, 'META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

		for (var i = 0; i < chapters.length; i++) {
			var id = `chapter-${i + 1}`;
			var href = `${id}.xhtml`;
			Utils.epubAssignGroupAnchors(chapters[i]);
			spineItems.push(`<itemref idref="${id}"/>`);
			manifestItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
			navItems.push(Utils.epubNavItem(chapters[i], href));
			Utils.addEpubFile(files, `EPUB/${href}`, Utils.epubChapterXhtml(chapters[i], title, document, book));
		}
		var fontManifest = Utils.addEpubFonts(files);

		Utils.addEpubFile(files, 'EPUB/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}">
<head><title>${Utils.escXml(title)}</title><meta charset="utf-8"/></head>
<body>
  <nav epub:type="toc" role="doc-toc" id="toc">
    <h1>${Utils.escXml(title)}</h1>
    <ol>${navItems.join('')}</ol>
  </nav>
</body>
</html>`);
		Utils.addEpubFile(files, 'EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="schema: http://schema.org/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${Utils.escXml(identifier)}</dc:identifier>
    <dc:title>${Utils.escXml(title)}</dc:title>
    ${titleAr ? `<dc:title xml:lang="ar">${Utils.escXml(titleAr)}</dc:title>` : ''}
    ${author ? `<dc:creator>${Utils.escXml(author)}</dc:creator>` : ''}
    <dc:publisher>${Utils.escXml(sourceMetadata.publisher)}</dc:publisher>
    <dc:source>${Utils.escXml(sourceMetadata.url)}</dc:source>
    <dc:description>${Utils.escXml(sourceMetadata.description)}</dc:description>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
    <meta property="schema:provider">${Utils.escXml(sourceMetadata.publisher)}</meta>
    <meta property="schema:url">${Utils.escXml(sourceMetadata.primaryUrl || sourceMetadata.url)}</meta>
    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessibilityFeature">readingOrder</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityFeature">tableOfContents</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessibilitySummary">This EPUB contains structured textual content with table of contents navigation and semantic footnotes where notes are present.</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${fontManifest.join('\n    ')}
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`);
		return Utils.zipFiles(files);
	}

	static epubSourceMetadata(document, book) {
		var documentSource = document?.metadata?.source || document?.source || {};
		if (!documentSource || typeof documentSource !== 'object' || Array.isArray(documentSource))
			documentSource = {};
		var sourceMetadata = Utils.exportSourceMetadata(book || document?.book);
		return {
			...sourceMetadata,
			...documentSource,
			name: documentSource.name || documentSource.publisher || sourceMetadata.name,
			publisher: documentSource.publisher || documentSource.name || sourceMetadata.publisher,
			url: documentSource.url || sourceMetadata.url,
			quranUrl: documentSource.quranUrl || sourceMetadata.quranUrl,
			primaryUrl: documentSource.primaryUrl || sourceMetadata.primaryUrl,
			description: documentSource.description || sourceMetadata.description
		};
	}

	static exportSourceMetadata(book) {
		var site = global.settings && global.settings.site ? global.settings.site : {};
		var publisher = 'Hadith Unlocked';
		var url = Utils.trimToEmpty(site.url || 'https://hadithunlocked.com');
		var quranUrl = Utils.trimToEmpty(site.quranUrl || 'https://quran.islamunlocked.com');
		var type = Utils.trimToEmpty(book?.type || book?.book_type || book?.book_model || '');
		var primaryUrl = (type === 'tafsir' || type === 'trans' || book?.alias === 'quran') ? quranUrl : url;
		var appDescription = Utils.trimToEmpty(site.desc || '');
		var description = appDescription
			? `${publisher}: ${appDescription}`
			: `${publisher} is a searchable hadith and Quran reference app. This download was generated by ${publisher}.`;
		return { name: publisher, publisher, url, quranUrl, primaryUrl, description };
	}

	static epubChapters(results) {
		results = Array.isArray(results) ? results : [];
		var chapterMap = new Map();
		for (var i = 0; i < results.length; i++) {
			var row = results[i];
			var chapterKey = row.h1 || 'book';
			if (!chapterMap.has(chapterKey)) {
				chapterMap.set(chapterKey, {
					number: row.h1,
					title: {
						en: Utils.trimToEmpty(row.h1_title_en || row.book_name_en || row.book_shortName_en || row.book_alias || 'Book'),
						ar: Utils.trimToEmpty(row.h1_title || '')
					},
					titleAr: Utils.trimToEmpty(row.h1_title || ''),
					intro: {
						en: row.h1_intro_en,
						ar: row.h1_intro
					},
					sections: [],
					items: []
				});
			}
			var chapter = chapterMap.get(chapterKey);
			var sectionKey = row.h2 !== undefined && row.h2 !== null && row.h2 !== '' ? row.h2.toString() : '';
			if (!sectionKey) {
				chapter.items.push(row);
				continue;
			}
			if (!chapter._sections)
				chapter._sections = new Map();
			if (!chapter._sections.has(sectionKey)) {
				var section = {
					number: row.h2,
					title: {
						en: Utils.trimToEmpty(row.h2_title_en || 'Section'),
						ar: Utils.trimToEmpty(row.h2_title || '')
					},
					path: Utils.epubRawGroupPath(row, 'section'),
					intro: {
						en: row.h2_intro_en,
						ar: row.h2_intro
					},
					subsections: [],
					items: []
				};
				chapter._sections.set(sectionKey, section);
				chapter.sections.push(section);
			}
			var section = chapter._sections.get(sectionKey);
			var subsectionKey = row.h3 !== undefined && row.h3 !== null && row.h3 !== '' ? row.h3.toString() : '';
			if (!subsectionKey) {
				section.items.push(row);
				continue;
			}
			if (!section._subsections)
				section._subsections = new Map();
			if (!section._subsections.has(subsectionKey)) {
				var subsection = {
					number: row.h3,
					title: {
						en: Utils.trimToEmpty(row.h3_title_en || 'Section'),
						ar: Utils.trimToEmpty(row.h3_title || '')
					},
					path: Utils.epubRawGroupPath(row, 'subsection'),
					intro: {
						en: row.h3_intro_en,
						ar: row.h3_intro
					},
					items: []
				};
				section._subsections.set(subsectionKey, subsection);
				section.subsections.push(subsection);
			}
			section._subsections.get(subsectionKey).items.push(row);
		}
		return Array.from(chapterMap.values()).map(group => Utils.epubFinalizeRawGroup(group));
	}

	static epubEnsureChapters(chapters, document, book, title, titleAr) {
		if (Array.isArray(chapters) && chapters.length)
			return chapters;
		title = Utils.trimToEmpty(title || document?.book?.title?.en || book?.name_en || book?.shortName_en || book?.alias || 'Content');
		titleAr = Utils.trimToEmpty(titleAr || document?.book?.title?.ar || book?.name || book?.shortName || '');
		return [{
			title: {
				en: title,
				ar: titleAr
			},
			titleAr: titleAr,
			intro: document?.intro,
			sections: [],
			items: []
		}];
	}

	static epubRawGroupPath(row, level) {
		var path = Utils.trimToEmpty(row?.path || '');
		if (level === 'section' && path && row?.h3 !== undefined && row?.h3 !== null && row?.h3 !== '')
			path = Utils.epubTrimPathSegments(path, 3);
		if (path)
			return path;
		if (row?.book_alias && row?.h1 !== undefined && row?.h1 !== null && row?.h2 !== undefined && row?.h2 !== null && row?.h2 !== '') {
			var base = `${row.book_alias}/${row.h1}/${row.h2}`;
			if (level === 'subsection' && row?.h3 !== undefined && row?.h3 !== null && row?.h3 !== '')
				return `${base}/${row.h3}`;
			return base;
		}
		return '';
	}

	static epubTrimPathSegments(value, count) {
		value = Utils.trimToEmpty(value);
		if (!value || /^https?:\/\//i.test(value))
			return value;
		var match = value.match(/^([^?#]*)(.*)$/);
		var pathname = match ? match[1] : value;
		var suffix = match ? match[2] : '';
		var prefix = pathname.charAt(0) === '/' ? '/' : '';
		var segments = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
		return `${prefix}${segments.slice(0, count).join('/')}${suffix}`;
	}

	static epubFinalizeRawGroup(group) {
		delete group._sections;
		delete group._subsections;
		(group.sections || []).forEach(section => Utils.epubFinalizeRawGroup(section));
		(group.subsections || []).forEach(subsection => Utils.epubFinalizeRawGroup(subsection));
		return group;
	}

	static epubChapterXhtml(chapter, bookTitle, document, book) {
		var bookType = Utils.trimToEmpty(document?.book?.type || book?.type || book?.book_type || book?.book_model || (book?.alias === 'quran' ? 'quran' : 'hadith'));
		var options = {
			hadithBook: bookType === 'hadith',
			translationBook: bookType === 'trans',
			sectionPageBreak: bookType !== 'trans' && bookType !== 'quran'
		};
		var body = Utils.epubGroupBody(chapter, 2, options);
		var chapterTitle = Utils.epubGroupHeadingText(chapter);
		var chapterTitleAr = Utils.trimToEmpty(chapter.titleAr || chapter.title?.ar || '');
		var chapterTitleArText = Utils.epubArabicGroupHeadingText(chapter, chapterTitleAr);
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
    section.section-page { break-before: page; page-break-before: always; }
    [dir="rtl"] { font-family: Kitab, serif; text-align: right; }
    .quran-text { font-family: QuranV1, serif; line-height: 2; }
    .tafsir-entry-quran-range { font-size: 1.45em; line-height: 2.15; margin: 0.35em 0 0.85em; }
    .quran-ayah-end-marker { font-family: QuranV1, serif; white-space: nowrap; }
    .quran-translation-passage .translation-passage { margin-top: 1em; }
    .quran-translation-ayah-marker { color: #666; font-weight: 700; white-space: nowrap; }
    .hadith-reference { font-weight: 700; white-space: nowrap; }
    .hadith-source-line { margin-bottom: 0.25em; }
    .item-title { margin-bottom: 0.25em; }
    .item-meta { color: #555; font-style: italic; }
    .chapter-title-ar { font-size: 1.8em; font-weight: 700; line-height: 1.5; margin: 0 0 1em; }
    .footnotes { border-top: 1px solid #ddd; margin-top: 1em; padding-top: 0.5em; font-size: 0.9em; }
    .footnote-ref { font-size: 0.75em; vertical-align: super; }
  </style>
</head>
<body>
  <h1>${Utils.escXml(chapterTitle)}</h1>
  ${chapterTitleArText && chapterTitleArText !== chapterTitle ? `<p class="chapter-title-ar" dir="rtl" lang="ar">${Utils.escXml(chapterTitleArText)}</p>` : ''}
  ${body}
</body>
</html>`;
	}

	static epubAssignGroupAnchors(group) {
		function assign(parent, path) {
			var children = (parent?.sections || []).concat(parent?.subsections || []);
			children.forEach((child, index) => {
				var childPath = path.concat(index + 1);
				child._epubAnchorId = `section-${childPath.join('-')}`;
				assign(child, childPath);
			});
		}
		assign(group, []);
	}

	static epubNavItem(group, href) {
		var label = Utils.epubGroupHeadingText(group);
		var children = Utils.epubNavChildItems(group, href);
		return `<li><a href="${Utils.escXml(href)}">${Utils.escXml(label)}</a>${children ? `<ol>${children}</ol>` : ''}</li>`;
	}

	static epubNavChildItems(group, chapterHref) {
		var items = [];
		var append = child => {
			var anchor = Utils.trimToEmpty(child?._epubAnchorId || '');
			var href = anchor ? `${chapterHref}#${anchor}` : chapterHref;
			items.push(Utils.epubNavItem(child, href));
		};
		(group?.sections || []).forEach(append);
		(group?.subsections || []).forEach(append);
		return items.join('');
	}

	static epubGroupHeadingText(group) {
		var title = Utils.epubTitleText(group);
		var number = Utils.trimToEmpty(group?.number);
		if (!number || title.indexOf(`${number}.`) === 0)
			return title;
		return `${number}. ${title}`;
	}

	static epubArabicGroupHeadingText(group, titleAr) {
		titleAr = Utils.trimToEmpty(titleAr);
		if (!titleAr)
			return '';
		var number = Utils.trimToEmpty(group?.number);
		if (!number)
			return titleAr;
		var numberAr = Arabic.toArabicDigits(number.toString());
		return titleAr.indexOf(`${numberAr}.`) === 0 ? titleAr : `${numberAr}. ${titleAr}`;
	}

	static epubTitleText(group) {
		return Utils.epubGroupTitleText(group) || Utils.trimToEmpty(group?.ref || group?.number || 'Chapter').toString();
	}

	static epubGroupTitleText(group) {
		var title = group?.title;
		if (title && typeof title === 'object' && !Array.isArray(title))
			title = title.en || title.ar;
		return Utils.trimToEmpty(title).toString();
	}

	static epubGroupBody(group, level, options) {
		var output = [];
		output.push(Utils.epubLocalizedParagraphs(group.intro, false, null, { hadithText: options?.hadithBook }));
		if (Utils.epubShouldRenderTranslationPassage(group, options))
			output.push(Utils.epubTranslationPassageXhtml(group.items));
		else
			(group.items || []).forEach(item => output.push(Utils.epubItemXhtml(item)));
		(group.sections || []).forEach(section => output.push(Utils.epubNestedGroupXhtml(section, level, options)));
		(group.subsections || []).forEach(subsection => output.push(Utils.epubNestedGroupXhtml(subsection, level, options)));
		return output.filter(Boolean).join('\n');
	}

	static epubNestedGroupXhtml(group, level, options) {
		var headingLevel = Math.min(Math.max(level, 2), 6);
		var title = Utils.epubGroupTitleText(group);
		var attrs = [
			group?._epubAnchorId ? `id="${Utils.escXml(group._epubAnchorId)}"` : '',
			options?.sectionPageBreak ? 'class="section-page"' : ''
		].filter(Boolean).join(' ');
		return `<section${attrs ? ` ${attrs}` : ''}>
  <h${headingLevel}>${Utils.epubGroupHeadingLink(group, [group.number, title].filter(Boolean).join('. '))}</h${headingLevel}>
  ${Utils.epubGroupBody(group, headingLevel + 1, options)}
</section>`;
	}

	static epubGroupHeadingLink(group, text) {
		text = Utils.escXml(text);
		var href = Utils.trimToEmpty(group?.path || group?.url || '');
		if (!href)
			return text;
		return `<a href="${Utils.escXml(Utils.epubNormalizeHref(href))}">${text}</a>`;
	}

	static epubItemXhtml(item) {
		item = Utils.epubNormalizeItem(item);
		var title = Utils.trimToEmpty(item.title?.en || item.title?.ar || '').toString();
		var titleAr = Utils.trimToEmpty(item.title?.ar || '').toString();
		var meta = Utils.trimToEmpty(item.grade?.en || item.grade?.ar || '');
		var footnoteContext = Utils.epubFootnoteContext(item);
		var showTitleAr = titleAr && titleAr !== title && !Utils.epubIsQuranItem(item);
		var itemTitle = Utils.epubItemTitle(item, title);
		var itemText = Utils.epubItemText(item);
		var hadithSourceLines = Utils.epubHadithSourceLines(item);
		var chain = hadithSourceLines ? undefined : item.chain;
		var showMeta = meta && (Utils.epubIsQuranItem(item) || !Utils.epubIsHadithItem(item));
		return `<article>
  ${itemTitle ? `<h3 class="item-title">${Utils.escXml(itemTitle)}</h3>` : ''}
  ${showTitleAr ? `<p dir="rtl" lang="ar"><strong>${Utils.escXml(titleAr)}</strong></p>` : ''}
  ${showMeta ? `<p class="item-meta">${Utils.escXml(meta)}</p>` : ''}
  ${hadithSourceLines}
  ${Utils.epubLocalizedParagraphs(chain)}
  ${Utils.epubLocalizedParagraphs(Utils.epubQuranContextText(item), true, null, { className: Utils.epubIsTafsirItem(item) ? 'tafsir-entry-quran-range' : '' })}
  ${Utils.epubLocalizedParagraphs(itemText, item.quranText, footnoteContext, { hadithText: Utils.epubIsHadithItem(item) })}
  ${Utils.epubFootnoteAsides(footnoteContext)}
</article>`;
	}

	static epubNormalizeItem(item) {
		if (!item || (item.text && typeof item.text === 'object' && !Array.isArray(item.text)))
			return item || {};
		return {
			...item,
			id: item.hId || item.id,
			ref: item.ref || item.path || item.num,
			number: item.number || item.num,
			book: {
				en: item.book_shortName_en || item.book_name_en || item.book_alias,
				ar: item.book_shortName || item.book_name || item.book_alias
			},
			title: {
				en: item.title_en || item.part_en,
				ar: item.title || item.part
			},
			chain: {
				en: item.chain_en,
				ar: item.chain
			},
			text: {
				en: item.body_en || item.text,
				ar: item.body || item.text_en
			},
			footnotes: {
				en: item.footnote_en,
				ar: item.footnote
			},
			grade: {
				en: item.grade_grade_en || item.grade_grades,
				ar: item.grade_grade
			},
			grader: {
				en: item.grader_shortName_en || item.grader_name_en,
				ar: item.grader_shortName || item.grader_name
			},
			source: {
				ref: item.ref_ref || (item.book_alias_ref && item.num_ref ? `${item.book_alias_ref}:${item.num_ref}` : undefined),
				path: item.path_ref,
				book: {
					en: item.book_shortName_en_ref || item.book_name_en_ref,
					ar: item.book_shortName_ref || item.book_name_ref
				},
				number: item.num_ref
			}
		};
	}

	static epubIsQuranItem(item) {
		return /^quran:/i.test(Utils.trimToEmpty(item?.ref || ''));
	}

	static epubIsHadithItem(item) {
		return !item?.quranText && !Utils.epubIsQuranItem(item) && Boolean(item?.text?.en || item?.text?.ar);
	}

	static epubIsTafsirItem(item) {
		return Boolean(item?.quran) && !item?.quranText;
	}

	static epubItemTitle(item, title) {
		var ref = Utils.trimToEmpty(item.ref || '').toString();
		title = Utils.trimToEmpty(title).toString();
		if (Utils.epubIsQuranItem(item) && /^Quran\s+\d+:\d+(?:-\d+)?$/i.test(title))
			return '';
		if (Utils.epubIsHadithItem(item))
			return title;
		if (!ref)
			return title;
		if (!title)
			return ref;
		var normalizedRefTitle = ref.replace(/^quran:/i, 'Quran ').replace(/:/g, ':');
		if (title.toLowerCase() === normalizedRefTitle.toLowerCase())
			return title;
		return [ref, title].filter(Boolean).join(' - ');
	}

	static epubItemText(item) {
		if (!item?.quranText)
			return Utils.epubHadithTextWithNumbers(item);
		return {
			...item.text,
			ar: Utils.epubArabicAyahWithMarker(item.text.ar, item)
		};
	}

	static epubHadithTextWithNumbers(item) {
		if (Utils.epubIsQuranItem(item))
			return item.text;
		var attribution = Utils.epubHadithAttribution(item);
		return {
			...item.text,
			en: Utils.epubAppendInlineAttribution(item.text?.en, attribution?.en),
			ar: Utils.epubAppendInlineAttribution(item.text?.ar, attribution?.ar)
		};
	}

	static epubHadithSourceLines(item) {
		if (!Utils.epubIsHadithItem(item) && !(item?.chain?.en || item?.chain?.ar))
			return '';
		return [
			Utils.epubHadithSourceLine(item, 'en'),
			Utils.epubHadithSourceLine(item, 'ar')
		].filter(Boolean).join('');
	}

	static epubHadithSourceLine(item, lang) {
		var ref = Utils.epubHadithReference(item)?.[lang] || '';
		var chain = Utils.trimToEmpty(item?.chain?.[lang] || '');
		if (!ref && !chain)
			return '';
		var virtualNumber = Utils.epubHadithVirtualNumber(item, lang);
		var prefix = [virtualNumber ? `(${virtualNumber})` : '', ref ? Utils.epubHadithReferenceLink(item, ref) : ''].filter(Boolean).join(' ');
		var content = [prefix, Utils.epubMarkdownInlineToXhtml(chain)].filter(Boolean).join(chain && prefix ? ' – ' : '');
		var dir = lang === 'ar' ? ' dir="rtl"' : '';
		return `<div lang="${lang}"${dir} class="hadith-source-line"><p>${content}</p></div>`;
	}

	static epubHadithReferenceLink(item, label) {
		var href = Utils.epubHadithHref(item);
		if (!href)
			return `<span class="hadith-reference">${Utils.escXml(label)}</span>`;
		return `<a class="hadith-reference" href="${Utils.escXml(href)}">${Utils.escXml(label)}</a>`;
	}

	static epubHadithHref(item) {
		var href = Utils.trimToEmpty(item?.source?.ref || item?.ref || '');
		if (!href)
			href = Utils.trimToEmpty(item?.source?.path || item?.path || '');
		if (!href)
			return '';
		if (/^https?:\/\//i.test(href))
			return href;
		var site = global.settings && global.settings.site ? global.settings.site : {};
		var baseUrl = Utils.trimToEmpty(site.url || 'https://hadithunlocked.com').replace(/\/+$/, '');
		return `${baseUrl}/${href.replace(/^\/+/, '')}`;
	}

	static epubHadithVirtualNumber(item, lang) {
		var number = item?.source?.ref ? Utils.trimToEmpty(item?.number || '') : '';
		return lang === 'ar' ? Arabic.toArabicDigits(number) : number;
	}

	static epubHadithReference(item) {
		var sourceRef = Utils.trimToEmpty(item?.source?.ref || '');
		var ref = sourceRef || Utils.trimToEmpty(item?.ref || '');
		if (!ref) {
			var bookAlias = Utils.trimToEmpty(item?.book_alias || '');
			var number = Utils.trimToEmpty(item?.number || item?.num || '');
			ref = bookAlias && number ? `${bookAlias}:${number}` : number;
		}
		if (!ref)
			return null;
		return {
			en: ref,
			ar: Utils.hadithReferenceArabic(ref, item)
		};
	}

	static epubHadithAttribution(item) {
		var gradeEn = Utils.trimToEmpty(item?.grade?.en || '');
		var gradeAr = Utils.trimToEmpty(item?.grade?.ar || '');
		var graderEn = Utils.trimToEmpty(item?.grader?.en || '');
		var graderAr = Utils.trimToEmpty(item?.grader?.ar || '');
		return {
			en: Utils.epubGradeWithGrader(gradeEn, graderEn),
			ar: Utils.epubGradeWithGrader(gradeAr, graderAr)
		};
	}

	static epubGradeWithGrader(grade, grader) {
		grade = Utils.trimToEmpty(grade);
		grader = Utils.trimToEmpty(grader);
		if (!grade)
			return '';
		return grader ? `${grade} (${grader})` : grade;
	}

	static hadithReferenceArabic(ref, item) {
		ref = Utils.trimToEmpty(ref);
		var match = ref.match(/^([^:]+):(.*)$/);
		var book = Utils.trimToEmpty(item?.source?.book?.ar || item?.book?.ar || (match ? match[1] : ''));
		var number = match ? match[2] : ref;
		return [book, Arabic.toArabicDigits(number)].filter(Boolean).join(':');
	}

	static epubPrefixText(text, ref) {
		text = Utils.trimToEmpty(text);
		ref = Utils.trimToEmpty(ref);
		if (!text || !ref)
			return text;
		var escaped = Utils.escXml(ref);
		if (new RegExp(`^(?:<[^>]+>)*${escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))
			return text;
		return `<span class="hadith-reference">${escaped}</span>. ${text}`;
	}

	static epubAppendInlineAttribution(text, attribution) {
		text = Utils.trimToEmpty(text);
		attribution = Utils.trimToEmpty(attribution);
		if (!text || !attribution)
			return text;
		return `${text} <span class="hadith-attribution">– ${Utils.escXml(attribution)}</span>`;
	}

	static epubQuranContextText(item) {
		if (!item?.quran)
			return undefined;
		if (!Array.isArray(item.quran.ayahs) || item.quran.ayahs.length === 0)
			return item.quran.text;
		return {
			...item.quran.text,
			ar: item.quran.ayahs.map(ayah => {
				return `${Utils.trimToEmpty(ayah?.text?.ar)} ${Utils.epubAyahMarker({ range: { from: ayah?.ayah, to: ayah?.ayah } })}`.trim();
			}).filter(Boolean).join(' ')
		};
	}

	static epubArabicAyahWithMarker(text, item) {
		text = Utils.trimToEmpty(text);
		if (!text)
			return '';
		var marker = Utils.epubAyahMarker(item);
		return marker ? `${text} ${marker}` : text;
	}

	static epubAyahMarker(item) {
		if (item?.display?.prefatoryBasmalah)
			return '';
		var ayah = item?.range?.to || item?.range?.from || Utils.trimToEmpty(item?.number || '').split(/[:-]/).pop();
		ayah = Utils.trimToEmpty(ayah);
		if (!ayah)
			return '';
		return `<span class="quran-ayah-end-marker">۝${Arabic.toArabicDigits(ayah.toString())}</span>`;
	}

	static epubShouldRenderTranslationPassage(group, options) {
		return !!options?.translationBook
			&& Array.isArray(group?.items)
			&& group.items.length > 1
			&& group.items.every(item => item?.quranText && Utils.epubIsQuranItem(item));
	}

	static epubTranslationPassageXhtml(items) {
		var footnoteContexts = [];
		var arabic = items.map(item => {
			return `${Utils.escXml(Utils.trimToEmpty(item.text?.ar))} ${Utils.epubAyahMarker(item)}`.trim();
		}).filter(Boolean).join(' ');
		var translation = items.map((item, index) => {
			var context = Utils.epubFootnoteContext(item);
			footnoteContexts.push(context);
			var marker = Utils.epubTranslationAyahMarker(item, index === 0);
			var text = Utils.epubMarkdownInlineToXhtml(Utils.epubTextWithFootnoteRefs(item.text?.en, 'en', context));
			return [marker, text].filter(Boolean).join(' ');
		}).filter(Boolean).join(' ');
		var footnotes = footnoteContexts.map(context => Utils.epubFootnoteAsides(context)).filter(Boolean).join('\n');
		return `<article class="quran-translation-passage">
  ${arabic ? `<div dir="rtl" lang="ar" class="quran-text"><p>${arabic}</p></div>` : ''}
  ${translation ? `<div lang="en" class="translation-passage"><p>${translation}</p></div>` : ''}
  ${footnotes}
</article>`;
	}

	static epubTranslationAyahMarker(item, includeSurah) {
		if (item?.display?.prefatoryBasmalah)
			return '';
		var range = item?.range || {};
		var surah = Utils.trimToEmpty(range.surah);
		var ayah = Utils.trimToEmpty(range.from || range.to);
		if (!surah || !ayah) {
			var number = Utils.trimToEmpty(item?.number || '').match(/^(\d+):(\d+)/);
			if (number) {
				surah = surah || number[1];
				ayah = ayah || number[2];
			}
		}
		if (!surah || !ayah) {
			var ref = Utils.trimToEmpty(item?.ref || '').match(/^quran:(\d+):(\d+)/i);
			if (ref) {
				surah = surah || ref[1];
				ayah = ayah || ref[2];
			}
		}
		if (!ayah)
			return '';
		var marker = includeSurah && surah ? `${surah}:${ayah}` : ayah;
		return `<span class="quran-translation-ayah-marker">${Utils.escXml(marker)}</span>`;
	}

	static epubLocalizedParagraphs(value, quranText, footnoteContext, options) {
		if (!value)
			return '';
		return [
			Utils.epubMarkdownBlock(value.en, '', 'en', false, footnoteContext, options),
			Utils.epubMarkdownBlock(value.ar, 'rtl', 'ar', quranText, footnoteContext, options)
		].join('');
	}

	static epubMarkdownBlock(text, dir, lang, quranText, footnoteContext, options) {
		text = Utils.trimToEmpty(text);
		if (!text)
			return '';
		var html = Utils.epubMarkdownToXhtml(Utils.epubTextWithFootnoteRefs(text, lang, footnoteContext));
		if (options?.hadithText)
			html = Utils.epubHadithEmphasisToStrong(html);
		var attrs = [
			dir ? `dir="${dir}"` : '',
			lang ? `lang="${lang}"` : '',
			Utils.epubClassAttr([quranText ? 'quran-text' : '', options?.className])
		].filter(Boolean).join(' ');
		return `<div${attrs ? ` ${attrs}` : ''}>${html}</div>`;
	}

	static epubClassAttr(classes) {
		classes = (Array.isArray(classes) ? classes : [classes])
			.map(value => Utils.trimToEmpty(value))
			.filter(Boolean);
		return classes.length ? `class="${Utils.escXml(classes.join(' '))}"` : '';
	}

	static epubHadithEmphasisToStrong(html) {
		return Utils.trimToEmpty(html)
			.replace(/<em>/g, '<strong>')
			.replace(/<\/em>/g, '</strong>');
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
			return `<a epub:type="noteref" role="doc-noteref" class="footnote-ref" href="#${note.id}" id="${note.id}-ref">[${Utils.escXml(key)}]</a>`;
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
			return `<a epub:type="noteref" role="doc-noteref" class="footnote-ref" href="#${note.id}" id="${note.id}-ref">[${Utils.escXml(key)}]</a>`;
		});
		var appendedRefs = [];
		notes.forEach((note, key) => {
			if (footnoteContext.used.has(`${lang}:${key}`))
				return;
			footnoteContext.used.add(`${lang}:${key}`);
			appendedRefs.push(`<a epub:type="noteref" role="doc-noteref" class="footnote-ref" href="#${note.id}" id="${note.id}-ref">[${Utils.escXml(key)}]</a>`);
		});
		if (appendedRefs.length > 0)
			text = `${text}${appendedRefs.join('')}`;
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
			.replace(/&nbsp;/g, '&#160;')
			.replace(/\shref=(["'])(.*?)\1/g, function (match, quote, href) {
				var normalized = Utils.epubNormalizeHref(href);
				return normalized === href ? match : ` href=${quote}${Utils.escXml(normalized)}${quote}`;
			});
	}

	static epubNormalizeHref(href) {
		href = Utils.trimToEmpty(href);
		if (!href || href.charAt(0) === '#' || /^[a-z][a-z0-9+.-]*:\/\//i.test(href))
			return href;
		var site = global.settings && global.settings.site ? global.settings.site : {};
		var quranBaseUrl = Utils.trimToEmpty(site.quranUrl || 'https://quran.islamunlocked.com').replace(/\/+$/, '');
		var hadithBaseUrl = Utils.trimToEmpty(site.url || 'https://hadithunlocked.com').replace(/\/+$/, '');
		if (Utils.isQuranUrlPath(href))
			return `${quranBaseUrl}${Utils.quranPath(href)}`;
		if (href.charAt(0) === '/')
			return `${hadithBaseUrl}${href}`;
		if (/^[a-z][a-z0-9_-]*\/\d/i.test(href))
			return `${hadithBaseUrl}/${href}`;
		if (/^[a-z][a-z0-9_-]*:\d/i.test(href))
			return `${hadithBaseUrl}/${href}`;
		return href;
	}

	static epubFootnoteId(base, lang, key) {
		return `fn-${Utils.safeFilename(base || 'item')}-${Utils.safeFilename(lang || 'note')}-${Utils.safeFilename(key || '1')}`;
	}

	static addEpubFonts(files) {
		var fonts = [
			{ id: 'font-kitab', href: 'fonts/kitab-base.woff2', media: 'font/woff2', file: `${__dirname}/../public/fonts/kitab-base.woff2` },
			{ id: 'font-quran-v1', href: 'fonts/DigitalKhattV1.otf', media: 'font/otf', file: `${__dirname}/../public/fonts/DigitalKhattV1.otf` }
		];
		var manifest = [];
		fonts.forEach(font => {
			if (!fsSync.existsSync(font.file))
				return;
			Utils.addEpubFile(files, `EPUB/${font.href}`, fsSync.readFileSync(font.file));
			manifest.push(`<item id="${font.id}" href="${font.href}" media-type="${font.media}"/>`);
		});
		return manifest;
	}

	static addEpubFile(files, name, data, options) {
		files.push({
			name,
			data: Buffer.isBuffer(data) ? data : Buffer.from(Utils.emptyIfNull(data).toString(), 'utf8'),
			store: Boolean(options?.store)
		});
	}

	static zipFiles(files) {
		var chunks = [];
		var centralDirectory = [];
		var offset = 0;
		var dosTime = 0;
		var dosDate = (1 << 5) | 1;

		files.forEach(file => {
			var fileName = Buffer.from(file.name, 'utf8');
			var data = file.data;
			var crc = Utils.crc32(data);
			var compressed = file.store ? data : zlib.deflateRawSync(data);
			var method = file.store ? 0 : 8;
			var localHeader = Buffer.alloc(30);

			localHeader.writeUInt32LE(0x04034b50, 0);
			localHeader.writeUInt16LE(20, 4);
			localHeader.writeUInt16LE(0, 6);
			localHeader.writeUInt16LE(method, 8);
			localHeader.writeUInt16LE(dosTime, 10);
			localHeader.writeUInt16LE(dosDate, 12);
			localHeader.writeUInt32LE(crc, 14);
			localHeader.writeUInt32LE(compressed.length, 18);
			localHeader.writeUInt32LE(data.length, 22);
			localHeader.writeUInt16LE(fileName.length, 26);
			localHeader.writeUInt16LE(0, 28);

			chunks.push(localHeader, fileName, compressed);

			var centralHeader = Buffer.alloc(46);
			centralHeader.writeUInt32LE(0x02014b50, 0);
			centralHeader.writeUInt16LE(20, 4);
			centralHeader.writeUInt16LE(20, 6);
			centralHeader.writeUInt16LE(0, 8);
			centralHeader.writeUInt16LE(method, 10);
			centralHeader.writeUInt16LE(dosTime, 12);
			centralHeader.writeUInt16LE(dosDate, 14);
			centralHeader.writeUInt32LE(crc, 16);
			centralHeader.writeUInt32LE(compressed.length, 20);
			centralHeader.writeUInt32LE(data.length, 24);
			centralHeader.writeUInt16LE(fileName.length, 28);
			centralHeader.writeUInt16LE(0, 30);
			centralHeader.writeUInt16LE(0, 32);
			centralHeader.writeUInt16LE(0, 34);
			centralHeader.writeUInt16LE(0, 36);
			centralHeader.writeUInt32LE(0, 38);
			centralHeader.writeUInt32LE(offset, 42);
			centralDirectory.push(centralHeader, fileName);

			offset += localHeader.length + fileName.length + compressed.length;
		});

		var centralDirectorySize = centralDirectory.reduce((sum, chunk) => sum + chunk.length, 0);
		var endRecord = Buffer.alloc(22);
		endRecord.writeUInt32LE(0x06054b50, 0);
		endRecord.writeUInt16LE(0, 4);
		endRecord.writeUInt16LE(0, 6);
		endRecord.writeUInt16LE(files.length, 8);
		endRecord.writeUInt16LE(files.length, 10);
		endRecord.writeUInt32LE(centralDirectorySize, 12);
		endRecord.writeUInt32LE(offset, 16);
		endRecord.writeUInt16LE(0, 20);

		return Buffer.concat(chunks.concat(centralDirectory, endRecord));
	}

	static crc32(buffer) {
		if (!Utils.CRC32_TABLE) {
			Utils.CRC32_TABLE = new Uint32Array(256);
			for (var i = 0; i < 256; i++) {
				var value = i;
				for (var j = 0; j < 8; j++)
					value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
				Utils.CRC32_TABLE[i] = value >>> 0;
			}
		}
		var crc = 0xffffffff;
		for (var k = 0; k < buffer.length; k++)
			crc = Utils.CRC32_TABLE[(crc ^ buffer[k]) & 0xff] ^ (crc >>> 8);
		return (crc ^ 0xffffffff) >>> 0;
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
**Hadith: ${Utils.escapeMarkdownText(results[i].title)}**
- ~~«${Utils.escapeMarkdownText(results[i].body)}» ([${Utils.escapeMarkdownText(results[0].book_shortName)} ${Utils.escapeMarkdownText(results[0].ar.num)}](https://hadithunlocked.com/${results[0].ref}) ${Utils.escapeMarkdownText(results[0].grade_grade)})~~
> ${Utils.escapeMarkdownText(results[i].body_en)}
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
		if (global.settings?.openAI && Utils.isTruthy(global.settings.openAI.model))
			return Utils.trimToEmpty(global.settings.openAI.model);
		throw new Error('settings.openAI.model is required');
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
		const arabicMark = '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]*';
		const pbuhArabic = new RegExp(
			`ص${arabicMark}ل${arabicMark}[ىي]${arabicMark}\\s+` +
			`ا?لل${arabicMark}ه${arabicMark}\\s+` +
			`ع${arabicMark}ل${arabicMark}ي${arabicMark}ه${arabicMark}\\s+` +
			`و${arabicMark}س${arabicMark}ل${arabicMark}م${arabicMark}`,
			'g'
		);
		s = s.replace(/[\[\(]]PBUH[\]\)]/g, ' ﷺ ');
		s = s.replace(/[\[\(]SAW[\]\)]/g, ' ﷺ ');
		s = s.replace(/[\[\(]peace be upon him[\]\)]/g, ' ﷺ ');
		s = s.replace(/peace be upon him/g, ' ﷺ ');
		s = s.replace(/[\[\(]pbuh[\]\)]/g, ' ﷺ ');
		s = s.replace(/, peace be upon him, /g, ' ﷺ ');
		s = s.replace(/[\[\(]ﷺ[\]\)]/g, ' ﷺ ');
		s = s.replace(/صلى الله عليه وسلم/g, ' ﷺ ');
		s = s.replace(pbuhArabic, ' ﷺ ');
		return s;
	}

	static replaceRA(s) {
		if (Utils.isFalsey(s))
			return s;
		const arabicMark = '[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]*';
		const raArabic = new RegExp(
			`ر${arabicMark}ض${arabicMark}[ىي]${arabicMark}\\s+` +
			`ا?لل${arabicMark}ه${arabicMark}\\s+` +
			`(?:ت${arabicMark}ع${arabicMark}ا${arabicMark}ل${arabicMark}[ىي]${arabicMark}\\s+)?` +
			`ع${arabicMark}ن${arabicMark}(?:ه${arabicMark}م${arabicMark}ا${arabicMark}|ه${arabicMark}ا${arabicMark}|ه${arabicMark}م${arabicMark}|ه${arabicMark}ن${arabicMark}|ه${arabicMark}|ك${arabicMark}م${arabicMark}ا${arabicMark}|ك${arabicMark}م${arabicMark}|ك${arabicMark}ن${arabicMark})`,
			'g'
		);
		return s.replace(raArabic, ' ؓ ');
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
			var filteredParams = new URLSearchParams();
			var lang = params.get('lang');
			var offset = params.get('o');
			if (lang !== null && lang !== '')
				filteredParams.set('lang', lang);
			if (offset !== null) {
				var parsedOffset = parseInt(offset, 10);
				if (!Number.isNaN(parsedOffset) && parsedOffset !== 0)
					filteredParams.set('o', `${parsedOffset}`);
			}
			var query = filteredParams.toString();
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

	static cacheFileFromFilename(filename, extension, directory, directoryType) {
		extension = extension || 'html';
		const cacheDir = directory
			? Utils.cacheBookDirectory(directory, directoryType)
			: `${homedir}/.hadithdb/cache`;
		return directory
			? `${cacheDir}/${filename}.${extension}`
			: `${cacheDir}/${filename}${Utils.cacheSuffix()}.${extension}`;
	}

	static cacheBookDirectory(directory, directoryType) {
		directoryType = Utils.trimToEmpty(directoryType) || 'hadith';
		return `${homedir}/.hadithdb/cache/${Utils.safeFilename(directoryType)}${Utils.cacheSuffix()}/${Utils.safeFilename(directory)}`;
	}

	static cacheGzipFile(cachedFile) {
		return `${cachedFile}${Utils.CACHE_GZIP_SUFFIX}`;
	}

	static shouldUseGzipEncoding(req) {
		const acceptEncoding = (req && (req.get ? req.get('accept-encoding') : req.headers && req.headers['accept-encoding'])) || '';
		return String(acceptEncoding).toLowerCase().split(',').some((entry) => {
			const value = entry.trim();
			return value === 'gzip' || value.startsWith('gzip;');
		});
	}

	static isCachedGzipFresh(cachedFile) {
		const gzipFile = Utils.cacheGzipFile(cachedFile);
		try {
			const cachedStats = fsSync.statSync(cachedFile);
			const gzipStats = fsSync.statSync(gzipFile);
			return gzipStats.mtimeMs >= cachedStats.mtimeMs;
		} catch (error) {
			return false;
		}
	}

	static cachedHtmlPathForRead(cachedFile) {
		return Utils.cachedTextPathForRead(cachedFile);
	}

	static cachedTextPathForRead(cachedFile) {
		if (!Utils.diskCacheEnabled())
			return null;
		const gzipFile = Utils.cacheGzipFile(cachedFile);
		if (Utils.isCacheFileFresh(gzipFile) && (!fsSync.existsSync(cachedFile) || Utils.isCachedGzipFresh(cachedFile)))
			return gzipFile;
		if (Utils.isCacheFileFresh(cachedFile))
			return cachedFile;
		return null;
	}

	static htmlCacheFile(req, options) {
		const owner = Utils.cacheBookOwner(req);
		return Utils.cacheFileFromFilename(
			Utils.cacheReqToFilename(req, options),
			'html',
			owner.alias,
			owner.type
		);
	}

	static cacheBookAlias(req) {
		return Utils.cacheBookOwner(req).alias;
	}

	static cacheBookOwner(req) {
		const params = req && req.params ? req.params : {};
		const requestedAlias = params.tafsir || params.translationAlias || params.commentaryAlias || params.bookAlias || '';
		if (!requestedAlias)
			return { alias: null, type: null };
		const commentary = (global.commentaries || []).find((book) => book
			&& (book.alias === requestedAlias || book.slug === requestedAlias));
		if (params.tafsir || commentary && commentary.type === 'tafsir')
			return { alias: commentary && commentary.alias || requestedAlias, type: 'tafsir' };
		if (params.translationAlias || commentary && commentary.type === 'trans')
			return { alias: commentary && commentary.alias || requestedAlias, type: 'trans' };
		const book = (global.books || []).find((item) => item && item.alias === requestedAlias);
		if (requestedAlias === 'quran')
			return { alias: requestedAlias, type: 'quran' };
		if (book && (book.type === 'tafsir' || book.type === 'trans'))
			return { alias: requestedAlias, type: book.type };
		return { alias: requestedAlias, type: 'hadith' };
	}

	static htmlCacheFragmentDir() {
		return `${homedir}/.hadithdb/cache/fragments${Utils.cacheSuffix()}`;
	}

	static htmlCacheFragmentMarker(kind, filename) {
		return `<!--hadithdb-cache-fragment:${kind}:${filename}-->`;
	}

	static htmlCacheFragmentPattern(kind) {
		return new RegExp(`<!--hadithdb-cache:${kind}:start-->[\\s\\S]*?<!--hadithdb-cache:${kind}:end-->`, 'g');
	}

	static cacheHtmlFragment(kind, html) {
		var fragment = Utils.normalizedCacheFragmentHtml(kind, html);
		if (!Utils.diskCacheEnabled())
			return fragment;
		var hash = crypto.createHash('sha256').update(fragment).digest('hex').substring(0, 16);
		var filename = `${kind}-${hash}.html`;
		var fragmentDir = Utils.htmlCacheFragmentDir();
		var fragmentFile = `${fragmentDir}/${filename}`;
		fsSync.mkdirSync(fragmentDir, { recursive: true });
		if (!Utils.isCacheFileFresh(fragmentFile)) {
			try { fsSync.unlinkSync(fragmentFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
			fsSync.writeFileSync(fragmentFile, fragment);
		}
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
			if (!Utils.isCacheFileFresh(fragmentFile))
				return marker;
			seen.add(filename);
			var fragment = fsSync.readFileSync(fragmentFile, 'utf8');
			return Utils.composeCachedHtmlFragments(fragment, seen);
		});
	}

	static hasUnresolvedCachedHtmlFragments(html) {
		return /<!--hadithdb-cache-fragment:[a-z-]+:[^>]+-->/.test(String(html || ''));
	}

	static writeCachedHtml(cachedFile, html) {
		const rendered = Utils.splitCachedHtmlFragments(html);
		Utils.writeCachedTextFile(cachedFile, rendered);
	}

	static writeCachedTextFile(cachedFile, value) {
		if (!Utils.diskCacheEnabled())
			return;
		const rendered = Buffer.isBuffer(value) ? value : Buffer.from(Utils.emptyIfNull(value).toString(), 'utf8');
		fsSync.mkdirSync(path.dirname(cachedFile), { recursive: true });
		try { fsSync.unlinkSync(cachedFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
		fsSync.writeFileSync(cachedFile, rendered);
		if (!/\.(html|xml|txt|rss|atom|json)$/i.test(cachedFile))
			return;
		const gzFile = Utils.cacheGzipFile(cachedFile);
		try {
			const compressed = zlib.gzipSync(rendered);
			try { fsSync.unlinkSync(gzFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
			fsSync.writeFileSync(gzFile, compressed);
			try {
				fsSync.unlinkSync(cachedFile);
			} catch (unlinkError) {
				debug(`unable to delete uncompressed cache file: ${cachedFile}`, unlinkError);
			}
		} catch (error) {
			debug(`unable to write gzip cache file: ${cachedFile}`, error);
		}
	}

	static readCachedTextFile(cachedFile) {
		const cachedPath = Utils.cachedTextPathForRead(cachedFile);
		if (!cachedPath)
			return '';
		try {
			return cachedPath === Utils.cacheGzipFile(cachedFile)
				? zlib.gunzipSync(fsSync.readFileSync(cachedPath)).toString('utf8')
				: fsSync.readFileSync(cachedPath, 'utf8');
		} catch (error) {
			try {
				if (cachedPath === Utils.cacheGzipFile(cachedFile))
					return zlib.gunzipSync(fsSync.readFileSync(cachedPath)).toString('utf8');
				return fsSync.readFileSync(cachedFile, 'utf8');
			} catch (fallbackError) {
				return '';
			}
		}
	}

	static readCachedHtml(cachedFile, req) {
		let html = Utils.readCachedTextFile(cachedFile);
		html = Utils.composeCachedHtmlFragments(html);
		html = GoogleAnalytics.injectTagId(html, req);
		return Utils.injectCachedAdminControls(html, req);
	}

	static readCachedHtmlResponse(cachedFile, req) {
		const cachedPath = Utils.cachedTextPathForRead(cachedFile);
		if (!cachedPath)
			return { encoding: null, body: Buffer.from('', 'utf8'), complete: false };
		const shouldGzip = Utils.shouldUseGzipEncoding(req);
		const html = Utils.readCachedHtml(cachedFile, req);
		const complete = Boolean(html) && !Utils.hasUnresolvedCachedHtmlFragments(html);
		if (!shouldGzip)
			return { encoding: null, body: Buffer.from(String(html || ''), 'utf8'), complete: complete };
		try {
			return { encoding: 'gzip', body: zlib.gzipSync(Buffer.from(String(html || ''), 'utf8')), complete: complete };
		} catch (error) {
			debug('unable to gzip cached HTML response:', error);
			return { encoding: null, body: Buffer.from(String(html || ''), 'utf8'), complete: complete };
		}
	}

	static sendCachedHtml(res, req, cachedFile, contentType) {
		const payload = Utils.readCachedHtmlResponse(cachedFile, req);
		if (!payload.complete)
			return false;
		Utils.setCachedLastModified(res, cachedFile, true);
		if (req && req.fresh) {
			res.statusCode = 304;
			res.end();
			return true;
		}
		res.setHeader('Content-Type', contentType || 'text/html; charset=UTF-8');
		if (payload.encoding === 'gzip') {
			res.setHeader('Content-Encoding', 'gzip');
			res.setHeader('Vary', 'Accept-Encoding');
		}
		res.end(payload.body);
		return true;
	}

	static readCachedTextResponse(cachedFile, req) {
		const cachedPath = Utils.cachedTextPathForRead(cachedFile);
		if (!cachedPath)
			return { encoding: null, body: Buffer.from('', 'utf8') };
		const shouldGzip = Utils.shouldUseGzipEncoding(req);
		const cachedGzFile = Utils.cacheGzipFile(cachedFile);
		if (shouldGzip && cachedPath === cachedGzFile) {
			try {
				return { encoding: 'gzip', body: fsSync.readFileSync(cachedGzFile) };
			} catch (error) {
				debug('unable to read cached gzip payload:', error);
			}
		}
		const text = Utils.readCachedTextFile(cachedFile);
		if (!shouldGzip)
			return { encoding: null, body: Buffer.from(String(text || ''), 'utf8') };
		return { encoding: null, body: Buffer.from(String(text || ''), 'utf8') };
	}

	static sendCachedTextFile(res, req, cachedFile, contentType) {
		const payload = Utils.readCachedTextResponse(cachedFile, req);
		Utils.setCachedLastModified(res, cachedFile);
		if (req && req.fresh) {
			res.statusCode = 304;
			res.end();
			return;
		}
		res.setHeader('Content-Type', contentType || 'text/plain; charset=UTF-8');
		if (payload.encoding === 'gzip') {
			res.setHeader('Content-Encoding', 'gzip');
			res.setHeader('Vary', 'Accept-Encoding');
		}
		res.end(payload.body);
	}

	static setCachedLastModified(res, cachedFile, includeHtmlFragments) {
		const lastModified = Utils.cachedLastModified(cachedFile, includeHtmlFragments);
		if (lastModified)
			res.setHeader('Last-Modified', lastModified.toUTCString());
	}

	static cachedLastModified(cachedFile, includeHtmlFragments) {
		const cachedPath = Utils.cachedTextPathForRead(cachedFile);
		if (!cachedPath)
			return null;
		let latest;
		try {
			latest = fsSync.statSync(cachedPath).mtime;
		} catch (error) {
			debug('unable to read cached response modification time:', error);
			return null;
		}
		if (!includeHtmlFragments)
			return latest;

		const visited = new Set();
		const visitFragments = function (html) {
			const marker = /<!--hadithdb-cache-fragment:[a-z-]+:([^>]+)-->/g;
			let match;
			while ((match = marker.exec(String(html || ''))) !== null) {
				const filename = match[1];
				if (visited.has(filename) || !/^[A-Za-z0-9._-]+$/.test(filename))
					continue;
				visited.add(filename);
				const fragmentFile = `${Utils.htmlCacheFragmentDir()}/${filename}`;
				try {
					const stats = fsSync.statSync(fragmentFile);
					if (stats.mtime > latest)
						latest = stats.mtime;
					visitFragments(fsSync.readFileSync(fragmentFile, 'utf8'));
				} catch (error) {
					if (error.code !== 'ENOENT')
						debug('unable to read cached HTML fragment modification time:', error);
				}
			}
		};
		visitFragments(Utils.readCachedTextFile(cachedFile));
		return latest;
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
		return Utils.SCRIPT_ASSET_SUFFIX_SLUG.replace(/^\./, '');
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
			.replace(/<i class="bi bi-book"><\/i> Quran/g, '<img class="app-menu-icon app-menu-icon-img" src="/images/quran-icon.svg" alt="" aria-hidden="true"> Quran')
			.replace(/<i class="bi bi-translate"><\/i> Translations/g, '<i class="app-menu-icon bi bi-translate" aria-hidden="true"></i> Translations')
			.replace(/<i class="bi bi-book"><\/i> Tafsir/g, '<i class="app-menu-icon bi bi-book-half" aria-hidden="true"></i> Tafsir')
			.replace(/<i class="bi bi-book"><\/i> Hadith/g, '<i class="app-menu-icon bi bi-book" aria-hidden="true"></i> Hadith')
			.replace(/<i class="bi bi-journals"><\/i> Books/g, '<img class="app-menu-icon app-menu-icon-img" src="/images/books-icon.svg" alt="" aria-hidden="true"> Books')
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
		return site.quranUrl || Utils.DEFAULT_QURAN_BASE_URL;
	}

	static hadithBaseUrl(req) {
		var site = global.settings && global.settings.site ? global.settings.site : {};
		if (Utils.isLocalhostRequest(req))
			return Utils.requestOrigin(req) || '';
		if (Utils.isLocalTldRequest(req) && site.urlLocal)
			return Utils.withRequestPort(req, site.urlLocal);
		return site.url || Utils.DEFAULT_HADITH_BASE_URL;
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
		var octets = hostname.split('.');
		var isPrivateIpv4 = octets.length === 4
			&& octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
			&& (octets[0] === '10' || (octets[0] === '192' && octets[1] === '168'));
		return hostname === 'localhost'
			|| hostname.endsWith('.localhost')
			|| hostname === '127.0.0.1'
			|| isPrivateIpv4
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
		if (!Utils.diskCacheEnabled())
			return;
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
		const gzipFile = Utils.cacheGzipFile(filename);
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
			const gzipStats = await fs.stat(gzipFile);
			if (gzipStats.isFile()) {
				await fs.unlink(gzipFile);
				debug(`deleted file: ${gzipFile}`);
				deleted = true;
			}
		} catch (error) {
			if (error && error.code !== 'ENOENT')
				debug('unable to flush cache gzip:', error);
		}
		try {
			const cachedb = await Utils.setupCacheIndex();
			await cachedb.runAsync(`DELETE FROM cachendx WHERE filename=?;`, [filename]);
		} catch (error) {
			debug('unable to clear cache index filename:', error);
		}
		const fragmentDir = Utils.htmlCacheFragmentDir();
		try {
			const fragmentFiles = await fs.readdir(fragmentDir, { withFileTypes: true });
			for (const fragmentFile of fragmentFiles) {
				if (fragmentFile.isFile())
					await fs.unlink(`${fragmentDir}/${fragmentFile.name}`);
			}
		} catch (error) {
			if (error && error.code !== 'ENOENT')
				debug('unable to flush cached html fragments:', error);
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
