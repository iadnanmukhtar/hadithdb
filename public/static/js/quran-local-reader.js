/* Public reader documents are assembled from the same EJS reading templates as the server. */
const QuranLocalReader = (() => {
	const trim = value => String(value ?? '').trim();
	const latin = value => String(value ?? '').replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
	function pathFor(heading, alias) {
		const path = '/quran' + (/^[\w-]+$/.test(alias || '') ? '/' + alias : '');
		const surah = Number(heading?.surah ?? heading?.h1 ?? heading?.number);
		if (!Number.isInteger(surah) || surah < 1 || surah > 114) return path;
		const section = Number(heading.section ?? heading.h2);
		if (!Number.isInteger(section) || section < 1) return path + '/' + surah;
		const subsection = Number(heading.subsection ?? heading.h3);
		return path + '/' + surah + '/' + section + (Number.isInteger(subsection) && subsection > 0 ? '/' + subsection : '');
	}
	const markdown = value => renderClientMarkdown(value);
	const plain = value => quranAudioTranslationPlainText(value || '');
	function excerpt(text) {
		const characters = Array.from(plain(text));
		if (characters.length <= 360) return characters.join('');
		return characters.slice(0,360).join('').replace(/\s+\S*$/, '').trimEnd() + '…';
	}
	function translationParts(html, nextNoteNumber = 1) {
		const body = document.createElement('div');
		body.innerHTML = html;
		namespaceQuranTranslationFootnotes(body, document.createElement('span'), '');
		const notes = document.createElement('div');
		for (const node of body.querySelectorAll('.footnotes-sep,.footnotes,.footnote'))
			if (body.contains(node)) notes.append(node);
		for (const list of notes.querySelectorAll('.footnotes-list')) {
			list.start = nextNoteNumber;
			for (const item of list.querySelectorAll('.footnote-item')) {
				item.value = nextNoteNumber;
				for (const ref of body.querySelectorAll('a[href^="#"]')) if (ref.hash === '#' + item.id) ref.textContent = '[' + nextNoteNumber + ']';
				nextNoteNumber++;
			}
		}
		const wrapper = body.firstElementChild;
		if (body.children.length === 1 && wrapper.matches('section.content-markdown')) wrapper.replaceWith(...wrapper.childNodes);
		return { body: body.innerHTML, notes: notes.innerHTML, nextNoteNumber };
	}

	function environment(index, url) {
		const identity = { ...ContentLabels, body: item => plain(item.en?.body), description: (label, items, fallback) =>
			excerpt(items.filter(Boolean).length ? label + ': ' + items.join(' ') : fallback),
			quranReaderTitle: ({surah, reference, heading, section, selectionCount, author}) =>
				ContentLabels.join(selectionCount ? ['Surah ' + surah + ' ' + reference, selectionCount > 1 ? '§' + section + ' ' + heading : heading]
					: ['Surah ' + surah + ' §' + section, author, heading], ' | ') };
		const defaultBook = quranDefaultTranslationBook(index.translations) || {};
		const utils = {
			scriptAssetVersion: () => new URL(document.querySelector('script[src*="/static/js/script.js"]').src).searchParams.get('v'),
			quranUrl: (_, path) => quranUrl(path), urlFor: (_, path) => quranUrl(path),
			emptyIfNull: value => value ?? '', trimToEmpty: trim, markdownToHtml: markdown,
			quranDisplayMarkdownToHtml: renderQuranHeroMarkdown, quranDisplayText: plain, heroReadingText: plain,
			quranTranslationBookLabel, englishAuthorSurname: book => book?.surname || '',
			defaultQuranTranslationBook: () => defaultBook, defaultQuranTranslationLabel: () => quranTranslationBookLabel(defaultBook),
			socialMetadata: () => identity, pageFreshness: () => ({ readers: () => undefined }),
			quranPassageTranslationParts: translationParts, quranStudySectionPath: pathFor,
			quranSurahNameLigature: num => 'surah' + String(num).padStart(3, '0'),
			quranSurahHeaderSvgPath: num => '/static/img/quran/surah-header/names/' + Number(num) + '.svg',
			quranSurahBreadcrumbLabel: (num, title) => num + ' ' + trim(title).replace(/^(?:surat|surah)\s+/i, ''),
			quranSurahBreadcrumbLabelAr: (num, title) => toArabicDigits(num) + ' ' + trim(title).replace(/^س[\u064B-\u065F\u0670]*و[\u064B-\u065F\u0670]*ر[\u064B-\u065F\u0670]*ة[\u064B-\u065F\u0670]*\s+/u, ''),
			notebookIntroTitle: heading => heading.title_en || heading.title, truncate: (str, n) => trim(str).slice(0, n)
		};
		return { global: { surahs: index.surahs, commentaries: index.translations, settings: { site: {} } },
			req: { path: url.pathname, originalUrl: url.pathname + url.search, query: Object.fromEntries(url.searchParams) },
			arabic: { toLatinDigits: latin, toArabicDigits }, utils, Tafsir: {
				visibleTranslationsSync: () => index.translations, renderCommentaryText: markdown
			} };
	}

	function render(name, locals, onHead) {
		name = name.replace(/^sub-views\//, '').replace(/\.ejs$/, '');
		if (name === 'head') { onHead?.(locals.page); return ''; }
		if (['header', 'page_end', 'mobile_navigation'].includes(name)) return '';
		return window.quranStudyViews[name](locals, undefined, (child, args) => render(child, { ...locals, ...args }, onHead));
	}

	function head(doc, page) {
		const canonicalBase = document.querySelector('link[rel=canonical]')?.href || location.origin;
		const canonical = new URL(page.canonical, canonicalBase).href;
		const title = page.title_en;
		const links = [{ rel: 'canonical', href: canonical }];
		for (const rel of ['prev', 'next']) if (page[rel]) links.push({ rel, href: page[rel] });
		const shared = [...document.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"]')]
			.filter(node => !/(title|url|description)$/.test(node.name || node.getAttribute('property')))
			.map(node => ({ name: node.name, property: node.getAttribute('property'), content: node.content }));
		const siteUrl = new URL(canonical).origin;
		const bookUrl = siteUrl + '/quran', chapter = page.context.chapter, section = page.context.section;
		const chapterUrl = bookUrl + '/' + chapter.h1, translation = page.context.quranCommentaryBook;
		const image = document.querySelector('meta[property="og:image"]')?.content;
		const breadcrumbs = [['Quran', bookUrl], [chapter.h1 + ' ' + trim(chapter.title_en).replace(/^(Surah|Surat)\s+/i,''), chapterUrl]];
		if (section) breadcrumbs.push(['Passage ' + section.h2, chapterUrl + '/' + section.h2]);
		const schema = window.quranPageSchema({page, title, description: page.description_en, image, url: canonical,
			siteName: 'Quran Unlocked', siteUrl, logo: new URL('/static/img/pwa/quran-512.png', siteUrl).href,
			breadcrumbs: breadcrumbs.map(([name,item],i) => ({'@type':'ListItem',position:i+1,name,item})), bookUrl, chapterUrl,
			commentaryUrl: translation && bookUrl + '/' + translation.slug});
		mushafPageHead(doc, { title, links, meta: [...shared,
			{ name: 'description', content: page.description_en }, { property: 'og:url', content: canonical },
			{ property: 'og:title', content: title }, { property: 'og:description', content: page.description_en },
			{ name: 'twitter:title', content: title }, { name: 'twitter:description', content: page.description_en }
		], schema: schema.map(data => ({ data, page: data['@id'] === canonical })) });
	}
	const indexData = () => bookReaderCache.read('quran', '/quran/study-index');
	function parse(url) {
		const path = url.pathname;
		const ref = path.match(/^\/(?:quran\/([\w-]+)\/)?quran:(\d+):(\d+)(?:-(\d+))?$/);
		const passage = path.match(/^\/quran\/(?:(?!page\/)([a-z][\w-]*)\/)?(\d+)\/(\d+)\/?$/i);
		if (!ref && !passage) return null;
		const m = ref || passage;
		return { surah: Number(m[2]), alias: m[1] || url.searchParams.get('translation'), section: passage && Number(m[3]),
			start: ref && Number(m[3]), end: ref && Number(m[4] || m[3]) };
	}
	async function related(ref, translation, kind) {
		const index = await bookReaderCache.read('quran', '/quran/relationships');
		const items = new Map();
		function item(target) {
			if (!items.has(target)) items.set(target, (async () => {
				const [s,a] = target.split(':').map(Number);
				const verse = await localQuranReaderAyah(s,a);
				if (translation?.source === 'local') {
					const data = await fetchQuranLocalTranslation(translation,s,a);
					if (data.entries[0]) verse.en.body = data.entries[0].html;
				}
				return verse;
			})());
			return items.get(target);
		}
		if (kind === 'similar') return Promise.all((index.similar[ref] || []).map(async match =>
			({ ...await item(match.target), ...match })));
		return Promise.all((index.byVerse[ref] || []).map(async id => {
			const phrase = index.phrases[id];
			const matches = await Promise.all(Object.entries(phrase.ranges).filter(([other]) => other !== ref)
				.map(async ([other,ranges]) => ({item: await item(other), ranges})));
			return {...phrase, sourceRanges: phrase.ranges[ref], matches};
		}));
	}
	// Related text can span dozens of surahs. Resolve those verses when the disclosure opens.
	document.addEventListener('toggle', async event => {
		const details = event.target;
		if (!details.open || !details.dataset.relatedRef || details.hasAttribute('aria-busy')) return;
		const {relatedKind: kind, relatedRef: ref, relatedBook: book} = details.dataset;
		const list = details.querySelector(':scope > div');
		details.setAttribute('aria-busy','true');
		list.textContent = 'Loading matching ayat…';
		try {
			const index = await indexData();
			const translation = index.translations.find(row => row.alias === book);
			const rows = await related(ref, translation, kind);
			const env = environment(index, new URL(location.href));
			const [surah] = ref.split(':').map(Number);
			const html = kind === 'similar'
				? render('quran_similar_ayahs', {...env, similarAyahs: rows})
				: render('quran_mutashabihat', {...env, phrases: rows, selectedAyah: {
					ar: {body: (await quranTextPart('uthmani',surah)).ayahsByRef[ref]}
				}});
			const template = document.createElement('template');
			template.innerHTML = html.trim();
			list.replaceChildren(...template.content.querySelector('details > div').childNodes);
			delete details.dataset.relatedRef;
			initQuranScriptPreference(list).catch(console.warn);
		} catch (_) {
			list.textContent = 'Matching ayat could not load. Close and reopen to retry.';
		} finally {
			details.removeAttribute('aria-busy');
		}
	}, true);
	async function study(href, headOnly = false) {
		const url = new URL(href, location.origin), target = parse(url);
		if (!target || [...url.searchParams.keys()].some(key => !['translation','script'].includes(key))) return null;
		const { surah, start, end } = target;
		const alias = target.alias || document.body.dataset.quranSelectedTranslationAlias ||
			storedQuranSelectedTranslationAlias() || QuranReaderLinks.defaultTranslationAlias;
		const [index, part, outlines] = await Promise.all([indexData(), quranTextPart('uthmani', surah),
			headOnly ? null : bookReaderCache.read('quran', '/quran/page-outlines/' + surah), templates()]);
		const chapter = index.chapters[surah];
		if (!chapter) return null;
		const book = { alias: 'quran', name_en: 'The Holy Quran', shortName_en: 'Quran', shortName: 'القرآن', title: 'القرآن الكريم' };
		const translation = alias && index.translations.find(b => b.alias === alias || b.slug === alias);
		if (alias && !['local','default'].includes(translation?.source)) return null;
		const range = h => Number(String(h.start).split(':')[1]);
		const sections = chapter.sections.filter(h => target.section ? h.h2 === target.section : range(h) <= end && range(h) + h.count > start);
		if (!sections.length) return null;
		const section = { ...sections[0], book, book_alias: 'quran' };
		const list = Object.values(index.chapters).flatMap(c => c.sections);
		section.prev = list[list.findIndex(h => h.path === section.path) - 1];
		section.next = list[list.findIndex(h => h.path === sections.at(-1).path) + 1];
		let translated;
		if (translation?.source === 'local') translated = await bookReaderCache.read(translation.alias, quranTranslationPath(translation, surah));
		const results = [];
		for (let n = range(section); n < range(sections.at(-1)) + sections.at(-1).count; n++) {
			const num = surah + ':' + n, verse = part.records[num];
			if (!verse) continue;
			const en = translated ? translated.entries.find(e => e.ayahs_start <= n && Number(e.ayahs_start) + Number(e.count) >= n)?.html || 'Content is not available for this ayah.' : verse.translation;
			results.push({ id: verse.id, num, ref: 'quran:' + num, numInChapter: n, body_en: en, body: part.ayahsByRef[num],
				ar: { num: toArabicDigits(num), body: part.ayahsByRef[num], body_alt: verse.display, chain: verse.chain },
				en: { num, body: en, footnote: verse.footnotes, chain: verse.chain_en }, quranTranslationAlias: translated ? alias : '' });
		}
		if (!results.length) return null;
		const selected = target.section ? [] : results.filter(v => v.numInChapter >= start && v.numInChapter <= end);
		if (!target.section && selected.length !== end - start + 1) return null;
		if (selected.length) {
			selected[0].prev_ref = (await localQuranReaderAyah(surah, start)).prev_ref;
			selected.at(-1).next_ref = (await localQuranReaderAyah(surah, end)).next_ref;
		}
		const env = environment(index, url);
		Object.assign(env.req, { quranSelectedTranslationAlias: translation?.alias || '', quranSelectedTranslationSlug: alias || '',
			quranServerRenderedTranslationAlias: translation?.alias || '', quranTranslationCanonicalPath: url.pathname });
		const refIndex = !headOnly && selected.length === 1 ? await bookReaderCache.read('quran', '/quran/relationships') : null;
		const selectedRef = selected[0]?.num;
		const intros = !headOnly && translation?.source === 'local' ? await bookReaderCache.read(translation.alias, '/quran/introductions/' + translation.alias) : null;
		let metadata, html = '';
		const stopAtHead = {};
		const locals = { ...env, section, chapter: { ...chapter, book }, results, selectedAyahs: selected,
			relatedRef: selectedRef, relatedBook: translation?.alias || '',
			similarAyahs: refIndex?.similar[selectedRef] || [], mutashabihatPhrases: refIndex?.byVerse[selectedRef] || [],
			commentarySurahHeading: intros?.chapters.find(c => Number(c.h1) === surah), commentaryIntroductionArticles: intros?.articles,
			quranSubsections: sections.flatMap(s => s.subsections), quranHeadingOutlines: outlines, quranCommentaryBook: translation };
		try {
			html = render('section_quran', locals, page => {
				metadata = page;
				if (headOnly) throw stopAtHead;
			});
		} catch (error) {
			if (error !== stopAtHead) throw error;
		}
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const ref = selected[0]?.num || results[0].num;
		appendQuranModeBar(doc, ref, part.records[ref].page, alias || '');
		head(doc, metadata);
		return doc;
	}

	async function corpus(path, script) {
		const match = new URL(path, location.origin).pathname.match(/corpus\/(\d+)\/(\d+)/);
		if (!match) return bookReaderCache.read('quran', path);
		const surah = Number(match[1]);
		const [words, index, part] = await Promise.all([bookReaderCache.read('quran', '/quran/corpus-chapter/' + surah),
			indexData(), script === 'uthmani' ? null : quranTextPart(script, surah)]);
		const wordsByAyah = { ...words }, juzStartsByAyah = {};
		if (part) for (const ref of Object.keys(words)) {
			const source = part.wordsByAyah[ref];
			if (source) wordsByAyah[ref] = source.filter((w,i) => !(script === 'indo-pak' && i === source.length-1 && /[\uE000-\uF8FF]/u.test(w.text)))
				.map((word,i) => ({ ...words[ref][i], ...word }));
		}
		for (const juz of index.juz) if (juz.start?.startsWith(surah + ':'))
			juzStartsByAyah[juz.start] = { ...juz, wordCount: Math.max(1, trim(juz.title).split(/\s+/).length) };
		return { wordsByAyah, juzStartsByAyah };
	}

	let templateRequest;
	function templates() {
		if (window.quranStudyViews) return Promise.resolve();
		if (!templateRequest) templateRequest = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.onload = resolve; script.onerror = reject;
			script.src = quranApiPath('/quran/study-templates.js') + new URL(document.querySelector('script[src*="/static/js/script.js"]').src).search;
			document.head.append(script);
		}).catch(error => { templateRequest = null; throw error; });
		return templateRequest;
	}
	async function mount(shell) {
		const mushaf = shell.dataset.readerShell === 'mushaf';
		const number = Number(shell.dataset.page);
		const doc = mushaf ? await publicMushafPage(number) : await study(location.href);
		if (!doc) throw Error('Unknown Quran passage');
		if (mushaf) {
			const article = doc.querySelector('[data-quran-mushaf-page]');
			shell.replaceWith(article);
			const first = article.querySelector('.quran-corpus-word[data-quran-ref]')?.dataset.quranRef;
			if (first) {
				const [s, a] = first.split(':');
				const [index, outline] = await Promise.all([indexData(), bookReaderCache.read('quran', '/quran/page-outlines/' + s), templates()]);
				article.closest('main').insertAdjacentHTML('afterend', render('quran_heading_toc', { ...environment(index, new URL(location.href)),
					quranHeadingOutlines: outline, quranHeadingInitialSurah: Number(s), quranHeadingInitialAyah: Number(a) }));
				const slider = document.querySelector('#mushaf-book input[type=range]');
				if (slider) slider.dataset.juzStarts = JSON.stringify(index.juz.map(j => [j.startPage, j.num]));
			}
			highlightQuranMushafSelection(article);
		} else {
			document.body.dataset.quranSelectedTranslationAlias = doc.body.dataset.quranSelectedTranslationAlias || '';
			const layout = doc.querySelector('.quran-heading-layout-study');
			shell.replaceWith(layout);
			for (const section of layout.querySelectorAll('.reflection-section')) executeInlineScripts(section);
		}
		const bar = document.querySelector('[data-quran-bar]');
		const source = doc.querySelector('[data-quran-bar]');
		if (bar && source) {
			Object.assign(bar.dataset, source.dataset);
			copyQuranReaderModeHrefs(doc, bar);
			updateQuranReaderModeHrefs(bar);
		}
		rememberReaderHead(doc, doc);
		updateLazyReaderHead(doc);
	}
	return { study, mount, parse, corpus };
})();
