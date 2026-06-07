/* jslint esversion:8 */

$(function () {
	'use strict';

	if (window.marked && window.marked.setOptions) {
		window.marked.setOptions({
			gfm: true,
			breaks: true
		});
	}

	initHadithAdminGear();

	setDirection($('#search-bar'));

	$(window).scroll(function() {
		$('.site-navbar').toggleClass('shrink', $(document).scrollTop() > 50);
	});

	$('.site-navbar').toggleClass('shrink', $(document).scrollTop() > 50);

	if ($('.search .form-check input:checked').length > 0) {
		$('.search .btn i').removeClass('bi-book');
		$('.search .btn i').addClass('bi-book-fill');
	}
	$('.search .form-check input').on('click', function () {
		var checked = false;
		$('.search .form-check input').each(function () {
			if ($(this).prop('checked'))
				checked = true;
		});
		if (checked) {
			$('#search-bar + .btn i').removeClass('bi-book');
			$('#search-bar + .btn i').addClass('bi-book-fill');
		} else {
			$('#search-bar + .btn i').removeClass('bi-book-fill');
			$('#search-bar + .btn i').addClass('bi-book');
		}
	});

	$('.search-click-toggle a').click(function (event) {
		var toggle = $(this).closest('.search-click-toggle');
		event.preventDefault();
		$('.search-click-toggle').not(toggle).removeClass('is-open');
		toggle.toggleClass('is-open');
		if (toggle.hasClass('is-open'))
			toggle.find('input').focus();
	});

	$('.search-click-toggle input').on('blur', function () {
		var toggle = $(this).closest('.search-click-toggle');
		window.setTimeout(function () {
			toggle.removeClass('is-open');
		}, 100);
	});

	$(document).on('click', function (event) {
		if (!$(event.target).closest('.search-click-toggle').length)
			$('.search-click-toggle').removeClass('is-open');

		var tocMenu = document.getElementById('toc2');
		if (!tocMenu || !$(tocMenu).hasClass('show'))
			return;
		if ($(event.target).closest('#toc2, a[href="#toc2"], [data-bs-target="#toc2"]').length)
			return;
		if (window.bootstrap && window.bootstrap.Collapse) {
			window.bootstrap.Collapse.getOrCreateInstance(tocMenu).hide();
		} else {
			$(tocMenu).removeClass('show');
		}
	});

	$('[role=search]').on('input', function () {
		setDirection($(this));
	});

	initSearchAutocomplete();
	initQuranPassageNavigator();
	initBookNavScroller();

	$('#toc2').on('hidden.bs.collapse', function (event) {
		$('.toggle').removeClass('bi-toggle-on');
		$('.toggle').addClass('bi-toggle-off');
	});
	$('#toc2').on('shown.bs.collapse', function(event) {
		$('.toggle').removeClass('bi-toggle-off');
		$('.toggle').addClass('bi-toggle-on');
	});

	initMarkdownEditablePreviews(document);
	initHadithTranslateButtons(document);
	initHadithSharhLinks(document);
	initHadithShareModals(document);
	initQuranAyahHoverPairs(document);
	initQuranAyahSelector(document);
	initQuranAyahModals(document);
	initQuranPageKeyboardNavigation(document);
	initQuranPassageShareLinks(document);
	initQuranCorpusTooltips(document);
	initQuranCorpusTooltipDelay(document);
	initQuranTafsirTabs(document);
	initQuranTafsirFootnotePopups(document);
	initTocExpandCollapse(document);
	initTocInlineDescriptionExpanders(document);

});

function getHadithCookie(name) {
	const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
	return match ? decodeURIComponent(match[1]) : '';
}

function initBookNavScroller(scope) {
	(scope ? $(scope) : $(document)).find('.h-menu').each(function () {
		var menu = this;
		var current = $(menu).find('[data-current-book="true"]').get(0);
		if (!current)
			return;
		var targetLeft = current.offsetLeft - ((menu.clientWidth - current.offsetWidth) / 2);
		menu.scrollLeft = Math.max(0, targetLeft);
	});
}

function setHadithAdminMode(enabled) {
	document.cookie = `editMode=${enabled ? '1' : '0'};path=/;`;
	location.reload();
}

function renderHadithAdminGear() {
	if (window.hadithAdmin !== true)
		return;

	$('.edit-gear').show();

	const editMode = Boolean(document.cookie.match(/(?:^|; )editMode=1(?:;|$)/));
	const icon = editMode ? 'bi-gear-fill' : 'bi-gear';
	const desktopList = document.querySelector('.site-navbar menu.d-md-block ul.nav');
	if (desktopList && !desktopList.querySelector('.edit-gear')) {
		const searchItem = desktopList.querySelector('.search-click-toggle');
		const item = document.createElement('li');
		item.className = 'nav-item edit-gear';
		item.innerHTML = `<a class="nav-link" role="button" title="${editMode ? 'Turn off admin mode' : 'Turn on admin mode'}" aria-label="${editMode ? 'Turn off admin mode' : 'Turn on admin mode'}"><i class="bi ${icon}"></i></a>`;
		item.querySelector('a').addEventListener('click', () => setHadithAdminMode(!editMode));
		desktopList.insertBefore(item, searchItem || null);
	}

	const mobileList = document.querySelector('#offcanvas-topnav .offcanvas-col1');
	if (mobileList && !mobileList.querySelector('.edit-gear')) {
		const separator = document.createElement('li');
		separator.className = 'edit-gear';
		separator.innerHTML = '<hr>';

		const item = document.createElement('li');
		item.className = 'nav-item edit-gear';
		item.innerHTML = `<a class="nav-link" role="button"><i class="bi ${icon}"></i> <strong>${editMode ? 'View' : 'Edit'}</strong></a>`;
		item.querySelector('a').addEventListener('click', () => setHadithAdminMode(!editMode));

		mobileList.appendChild(separator);
		mobileList.appendChild(item);
	}
}

function hadithLoginPath(userId) {
	var encodedUserId = encodeURIComponent(userId);
	if (typeof isQuranSubdomainHost === 'function' && isQuranSubdomainHost(window.location.hostname))
		return `/quran/login/${encodedUserId}`;
	return `/login/${encodedUserId}`;
}

function waitForHadithAuth(timeoutMs) {
	timeoutMs = timeoutMs || 3000;
	return new Promise(function (resolve) {
		if (window.hadithAuth && window.hadithAuth.getToken)
			return resolve(window.hadithAuth);
		var start = Date.now();
		var timer = window.setInterval(function () {
			if (window.hadithAuth && window.hadithAuth.getToken) {
				window.clearInterval(timer);
				resolve(window.hadithAuth);
			} else if (Date.now() - start >= timeoutMs) {
				window.clearInterval(timer);
				resolve(null);
			}
		}, 50);
	});
}

async function syncHadithAdminForCachedPage() {
	const userId = getHadithCookie('userId');
	if (!userId || window.hadithAdmin === true)
		return;

	try {
		const auth = await waitForHadithAuth();
		const token = auth && auth.getToken ? await auth.getToken() : null;
		if (!token)
			return;
		const user = auth && auth.getUser ? await auth.getUser() : null;
		const loginUserId = user && user.email ? user.email : userId;
		const res = await fetch(hadithLoginPath(loginUserId), {
			method: 'GET',
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok)
			return;
		const data = await res.json();
		window.hadithAdmin = Boolean(data && data.admin);
		if (window.hadithAdmin)
			renderHadithAdminGear();
	} catch (err) {
		console.warn('Could not refresh admin mode for cached page', err);
	}
}

function initHadithAdminGear() {
	window.hadithAdmin = document.querySelector('.edit-gear') ? true : window.hadithAdmin;
	renderHadithAdminGear();
	syncHadithAdminForCachedPage();
}

function initTocExpandCollapse(root) {
	var scope = root || document;
	$(scope).find('[data-toc-toggle]').each(function () {
		var button = $(this);
		if (button.data('tocToggleBound'))
			return;
		button.data('tocToggleBound', true);
		button.on('click', function () {
			var targetId = button.attr('data-toc-toggle');
			var rows = $('[data-toc-parent="' + targetId + '"]');
			var expanded = button.attr('aria-expanded') === 'true';
			rows.toggleClass('d-none', expanded);
			button.attr('aria-expanded', expanded ? 'false' : 'true');
			button.attr('title', expanded ? 'Show sections' : 'Hide sections');
			button.find('.toc-expand-icon')
				.toggleClass('bi-chevron-right', expanded)
				.toggleClass('bi-chevron-down', !expanded);
		});
	});
}

function initTocInlineDescriptionExpanders(root) {
	var scope = root || document;
	$(scope).find('[data-toc-description-expand]').each(function () {
		var link = $(this);
		if (link.data('tocDescriptionExpandBound'))
			return;
		link.data('tocDescriptionExpandBound', true);
		link.on('click', function (event) {
			event.preventDefault();
			var target = link.attr('data-toc-description-expand');
			$(`[data-toc-description-summary="${target}"]`).addClass('d-none');
			$(`[data-toc-description-full="${target}"]`).removeClass('d-none');
			link.attr('aria-expanded', 'true');
		});
	});
}

function isLocalhostHost(hostname) {
	hostname = (hostname || '').toLowerCase();
	return hostname === 'localhost'
		|| hostname.endsWith('.localhost')
		|| hostname === '127.0.0.1'
		|| hostname === '::1'
		|| hostname === '[::1]';
}

function isQuranSubdomainHost(hostname) {
	hostname = (hostname || '').toLowerCase();
	return hostname.split('.')[0] === 'quran';
}

function quranPath(path) {
	path = (path || '').toString();
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

function quranUrl(path) {
	if (!isLocalhostHost(window.location.hostname))
		return 'https://quran.islamunlocked.com' + quranPath(path);
	if (isQuranSubdomainHost(window.location.hostname))
		return quranPath(path);
	return path;
}

function quranApiPath(path) {
	path = (path || '').toString();
	if (!isQuranSubdomainHost(window.location.hostname))
		return path;
	if (path.charAt(0) !== '/')
		path = '/' + path;
	if (path === '/quran' || path.indexOf('/quran/') === 0)
		return path;
	return '/quran' + path;
}

function setDirection(el) {
	if (el.length) {
		if (el.val().match(/^[\u0600-\u06ff]+/))
			el.css({ 'direction': 'rtl' });
		else
			el.css({ 'direction': 'ltr' });
	}
}

function initQuranPassageShareLinks(root) {
	var scope = root || document;
	$(scope).find('.quran-passage-share-btn').each(function () {
		var button = $(this);
		if (button.data('quranPassageShareBound'))
			return;
		button.data('quranPassageShareBound', true);
		button.on('click', async function () {
			var url = window.location.href.split('#')[0];
			if (/^#tafsir=[A-Za-z0-9_-]+$/.test(window.location.hash))
				url += window.location.hash;
			var copyError;
			var copyPromise = copyTextToClipboard(url).catch(function (err) {
				copyError = err;
			});
			try {
				if (navigator.share) {
					await navigator.share({
						title: document.title,
						url: url
					});
				}
				await copyPromise;
				if (copyError)
					throw copyError;
				if (window.toastr)
					toastr.success(navigator.share ? 'Passage URL copied and shared' : 'Passage URL copied');
			} catch (err) {
				await copyPromise;
				if (err && err.name === 'AbortError')
					return;
				if (window.toastr)
					toastr.error(err.message || 'Unable to share passage URL');
			}
		});
	});
}

function initQuranTafsirFootnotePopups(root) {
	var scope = root || document;
	var doc = scope.ownerDocument || document;
	if ($(doc).data('quranTafsirFootnotePopupsBound'))
		return;
	$(doc).data('quranTafsirFootnotePopupsBound', true);
	var popup = null;
	var removePopup = function () {
		if (popup) {
			popup.remove();
			popup = null;
		}
	};
	var footnoteContent = function (link) {
		var href = $(link).attr('href') || '';
		if (href.charAt(0) !== '#')
			return null;
		var target = doc.getElementById(href.slice(1));
		if (!target)
			return null;
		var content = $(target).clone();
		content.find('.footnote-backref').remove();
		if (!content.text().trim())
			return null;
		return content.children().length ? content.children() : content.contents();
	};
	var positionPopup = function (link) {
		if (!popup)
			return;
		var rect = link.getBoundingClientRect();
		var margin = 8;
		var width = popup.outerWidth();
		var height = popup.outerHeight();
		var top = rect.top - height - margin;
		if (top < margin)
			top = rect.bottom + margin;
		var left = rect.left + (rect.width / 2) - (width / 2);
		left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
		popup.css({ left: `${left}px`, top: `${top}px` });
	};
	var showPopup = function (link) {
		removePopup();
		var content = footnoteContent(link);
		if (!content)
			return;
		var tafsirText = $(link).closest('.quran-tafsir-text');
		popup = $('<aside>').addClass('quran-tafsir-footnote-popup').attr({
			role: 'tooltip',
			dir: tafsirText.attr('dir') || 'auto',
			lang: tafsirText.attr('lang') || ''
		}).appendTo(doc.body);
		popup.append(content);
		positionPopup(link);
	};
	$(doc).on('mouseenter focusin', '.quran-tafsir-text .footnote-ref a', function () {
		showPopup(this);
	});
	$(doc).on('mouseleave focusout', '.quran-tafsir-text .footnote-ref a', removePopup);
	$(window).on('scroll resize', removePopup);
}

function initQuranTafsirTabs(root) {
	var scope = root || document;
	$(scope).find('.quran-tafsirs').each(function () {
		var container = $(this);
		if (container.closest('.quran-ayah-modal-pane.d-none').length)
			return;
		if (container.data('quranTafsirsBound'))
			return;
		container.data('quranTafsirsBound', true);
		var surah = container.attr('data-surah');
		var ayahs = (container.attr('data-ayahs') || '').split(',').filter(Boolean);
		var selectedAyahs = (container.attr('data-selected-ayahs') || '').split(',').filter(Boolean).map(Number);
		var ayahText = JSON.parse(container.find('.quran-tafsir-ayah-data').text() || '{}');
		var activeLanguage = 'en';
		var selectedByLanguage = {};
		var selectedTafsirStorageKey = 'quranTafsirAlias';
		var getStoredTafsirAlias = function () {
			try {
				return window.sessionStorage.getItem(selectedTafsirStorageKey);
			} catch (_err) {
				return null;
			}
		};
		var storeTafsirAlias = function (alias) {
			try {
				window.sessionStorage.setItem(selectedTafsirStorageKey, alias);
			} catch (_err) {
				// The URL hash still preserves the selected tafsir on the current page.
			}
		};
		var toArabicDigits = function (value) {
			return value.toString().replace(/\d/g, function (digit) {
				return '٠١٢٣٤٥٦٧٨٩'[digit];
			});
		};
		var appendAyahHeading = function (entryElement, ayah, inline) {
			var heading = $('<h3>').addClass('quran-tafsir-ayah').attr({
				lang: 'ar',
				dir: 'rtl'
			}).appendTo(entryElement);
			if (inline)
				heading.addClass('quran-tafsir-ayah-inline');
			$('<span>').addClass('quran-tafsir-ayah-ref').attr('dir', 'ltr').text(`${surah}:${ayah}`).appendTo(heading);
			heading.append(document.createTextNode(' '));
			$('<span>').addClass('quran-tafsir-ayah-text').text(ayahText[ayah] || '').appendTo(heading);
			heading.append(document.createTextNode(' '));
			$('<span>').addClass('quran-ayah-end-marker').text(`۝${toArabicDigits(ayah)}`).appendTo(heading);
		};
		var footnoteIdPart = function (value) {
			return value.toString().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
		};
		var appendTextWithBracketedFootnotes = function (target, value, idPrefix) {
			var notes = [];
			var segments = [];
			var text = value.toString();
			var lastIndex = 0;
			text.replace(/(?:\\\[|\[)(?:\\\[|\[)([\s\S]*?)(?:\\\]|\])(?:\\\]|\])/g, function (match, note, offset) {
				if (offset > lastIndex)
					segments.push({ text: text.slice(lastIndex, offset) });
				note = note.trim();
				if (note) {
					notes.push(note);
					segments.push({ noteIndex: notes.length });
				}
				lastIndex = offset + match.length;
				return match;
			});
			if (lastIndex < text.length)
				segments.push({ text: text.slice(lastIndex) });
			if (!notes.length) {
				text.split(/\n+/).filter(Boolean).forEach(function (paragraph) {
					$('<p>').text(paragraph).appendTo(target);
				});
				return;
			}
			var paragraph = $('<p>').appendTo(target);
			segments.forEach(function (segment) {
				if (segment.text !== undefined) {
					segment.text.split(/(\n+)/).forEach(function (part) {
						if (!part)
							return;
						if (/^\n+$/.test(part)) {
							if (paragraph.text().trim() || paragraph.children().length)
								paragraph = $('<p>').appendTo(target);
							return;
						}
						paragraph.append(document.createTextNode(part));
					});
					return;
				}
				var refId = `${idPrefix}-fnref-${segment.noteIndex}`;
				var noteId = `${idPrefix}-fn-${segment.noteIndex}`;
				$('<sup>').addClass('footnote-ref')
					.append($('<a>').attr({ href: `#${noteId}`, id: refId }).text(`[${segment.noteIndex}]`))
					.appendTo(paragraph);
			});
			target.children('p').filter(function () {
				return !$(this).text().trim() && $(this).children().length < 1;
			}).remove();
			$('<hr>').addClass('footnotes-sep').appendTo(target);
			var section = $('<section>').addClass('footnotes').appendTo(target);
			var list = $('<ol>').addClass('footnotes-list').appendTo(section);
			notes.forEach(function (note, index) {
				var noteNumber = index + 1;
				var item = $('<li>').addClass('footnote-item').attr('id', `${idPrefix}-fn-${noteNumber}`).appendTo(list);
				var noteParagraphs = note.split(/\n+/).map(function (line) {
					return line.trim();
				}).filter(Boolean);
				if (noteParagraphs.length < 1)
					noteParagraphs = [''];
				noteParagraphs.forEach(function (line, paragraphIndex) {
					var noteParagraph = $('<p>').text(line).appendTo(item);
					if (paragraphIndex === noteParagraphs.length - 1) {
						noteParagraph.append(document.createTextNode(' '));
						$('<a>').addClass('footnote-backref').attr('href', `#${idPrefix}-fnref-${noteNumber}`).html('&#8617;&#xFE0E;').appendTo(noteParagraph);
					}
				});
			});
		};
		var overlapsSelectedAyahs = function (startAyah, endAyah) {
			return selectedAyahs.some(function (ayah) {
				return ayah >= startAyah && ayah <= endAyah;
			});
		};
		var scrollTafsirTabIntoView = function (tab) {
			if (!tab || !tab.length)
				return;
			window.requestAnimationFrame(function () {
				var tabElement = tab[0];
				var menuElement = tabElement.closest('.quran-tafsir-tabs');
				if (!menuElement)
					return;
				var menuRect = menuElement.getBoundingClientRect();
				var tabRect = tabElement.getBoundingClientRect();
				var offset = tabRect.left - menuRect.left - ((menuRect.width - tabRect.width) / 2);
				menuElement.scrollLeft += offset;
			});
		};
		var scrollActiveTafsirTabIntoView = function () {
			scrollTafsirTabIntoView(container.find('.quran-tafsir-tabs [role="tab"].active:visible').first());
		};
		container.data('scrollActiveTafsirTabIntoView', scrollActiveTafsirTabIntoView);
		var appendSourceHeader = function (panel, book) {
			var header = $('<header>').addClass('quran-tafsir-source row').appendTo(panel);
			var english = $('<section>').addClass('col-6 text-start').attr('lang', 'en').appendTo(header);
			var arabic = $('<section>').addClass('col-6 text-end').attr('lang', 'ar').appendTo(header);
			$('<strong>').text(book.name_en || book.shortName_en || book.alias).appendTo(english);
			$('<span>').text([book.author_en, book.death ? `${book.death} AH` : ''].filter(Boolean).join(', ')).appendTo(english);
			if (book.name || book.author) {
				$('<strong>').text(book.name || '').appendTo(arabic);
				$('<span>').text([book.author, book.death ? `${toArabicDigits(book.death)} هـ` : ''].filter(Boolean).join('، ')).appendTo(arabic);
			}
		};
		var addCatalogTab = function (book) {
			var panelId = `${container.attr('data-tafsir-instance') || 'passage'}-${container.attr('data-surah')}-${ayahs[0] || ''}-${book.lang}-${book.alias}`;
			var tabId = `quran-tafsirs-${panelId}-tab`;
			var targetId = `quran-tafsirs-${panelId}`;
			if (container.find(`#${cssEscape(tabId)}`).length)
				return;
			var tab = $('<button>').addClass('btn btn-outline-primary text-nowrap').attr({
				id: tabId,
				'data-bs-toggle': 'tab',
				'data-bs-target': `#${targetId}`,
				'data-tafsir-hash': book.alias,
				'data-tafsir-lang': book.lang,
				type: 'button',
				role: 'tab',
				'aria-controls': targetId,
				'aria-selected': 'false'
			}).text(book.shortName_en || book.shortName || book.author_en || book.alias);
			tab.toggleClass('d-none', book.lang !== activeLanguage).appendTo(container.find('.quran-tafsir-tabs'));
			var panel = $('<section>').addClass('tab-pane fade quran-tafsir-panel').attr({
				id: targetId,
				role: 'tabpanel',
				'aria-labelledby': tabId,
				tabindex: '0',
				'data-tafsir-src': book.alias,
				'data-tafsir-source': book.source,
				'data-tafsir-format': book.format || 'txt',
				'data-tafsir-lang': book.lang
			}).appendTo(container.find('.quran-tafsir-content'));
			appendSourceHeader(panel, book);
			$('<p>').addClass('quran-tafsir-status text-muted').text('Select this tab to load the tafsir.').appendTo(panel);
			$('<div>').addClass('quran-tafsir-text').attr({
				lang: book.lang,
				dir: book.lang === 'ar' ? 'rtl' : 'ltr'
			}).appendTo(panel);
		};
		var fetchPayload = async function (src, source, ayah, language) {
			var endpoint = quranApiPath(source === 'local' ? '/proxy/tafsir/local' : '/proxy/tafsir');
			var languageParam = source === 'local' && language ? `&lang=${encodeURIComponent(language)}` : '';
			var response = await fetch(`${endpoint}?src=${encodeURIComponent(src)}&s=${encodeURIComponent(surah)}&a=${encodeURIComponent(ayah)}&ver=1${languageParam}`);
			if (response.status === 404)
				return null;
			if (!response.ok)
				throw new Error('Unable to load tafsir.');
			return await response.json();
		};

		var loadPanel = async function (panel) {
			var src = panel.attr('data-tafsir-src');
			var source = panel.attr('data-tafsir-source') || 'tafsir.app';
			var format = panel.attr('data-tafsir-format') || 'txt';
			if (!src || panel.data('tafsirLoaded') || panel.data('tafsirLoading'))
				return;
			panel.data('tafsirLoading', true);
			var status = panel.find('.quran-tafsir-status');
			var text = panel.find('.quran-tafsir-text');
			status.text('Loading tafsir...');
			try {
				var payloads = await Promise.all(ayahs.map(async function (ayah) {
					return {
						ayah: ayah,
						payload: await fetchPayload(src, source, ayah, panel.attr('data-tafsir-lang'))
					};
				}));
				var seen = new Set();
				var entries = payloads.filter(function (entry) {
					if (!entry.payload)
						return false;
					var signature = `${entry.payload.ayahs_start || entry.ayah}:${entry.payload.count || 0}:${entry.payload.data || entry.payload.html || ''}`;
					if (seen.has(signature))
						return false;
					seen.add(signature);
					return true;
				});
				text.empty();
				entries.forEach(function (entry) {
					var startAyah = Number(entry.payload.ayahs_start || entry.ayah);
					var count = Number(entry.payload.count || 0);
					var endAyah = startAyah + count;
					var entryElement = $('<details>').addClass('quran-tafsir-entry').prop('open', overlapsSelectedAyahs(startAyah, endAyah)).appendTo(text);
					var summary = $('<summary>').appendTo(entryElement);
					var ayahHeadings = count > 0
						? $('<div>').addClass('quran-tafsir-ayah-range').attr({ lang: 'ar', dir: 'rtl' }).appendTo(summary)
						: summary;
					for (var ayah = startAyah; ayah <= endAyah; ayah++) {
						if (ayahText[ayah])
							appendAyahHeading(ayahHeadings, ayah, count > 0);
					}
					if (entry.payload.html !== undefined) {
						$('<div>').addClass('quran-tafsir-entry-body quran-tafsir-html').html(entry.payload.html).appendTo(entryElement);
					} else if (format === 'html') {
						$('<div>').addClass('quran-tafsir-entry-body quran-tafsir-html').html(entry.payload.data).appendTo(entryElement);
					} else {
						var entryBody = $('<div>').addClass('quran-tafsir-entry-body').appendTo(entryElement);
						if (panel.attr('data-tafsir-lang') === 'ar')
							appendTextWithBracketedFootnotes(entryBody, entry.payload.data, `tafsir-${footnoteIdPart(src)}-${startAyah}`);
						else
							entry.payload.data.toString().split(/\n+/).filter(Boolean).forEach(function (paragraph) {
								$('<p>').text(paragraph).appendTo(entryBody);
							});
					}
				});
				if (window.bindInlineEditors)
					window.bindInlineEditors(text[0]);
				status.toggleClass('d-none', entries.length > 0);
				if (entries.length < 1)
					status.text('No tafsir text is available for this passage.');
				panel.data('tafsirLoaded', true);
			} catch (err) {
				status.removeClass('d-none').text(err.message || 'Unable to load tafsir.');
			} finally {
				panel.data('tafsirLoading', false);
			}
		};
		var showLanguage = function (language, preferredAlias) {
			activeLanguage = language;
			container.find('[data-tafsir-language]').toggleClass('active', false)
				.filter(`[data-tafsir-language="${language}"]`).toggleClass('active', true);
			var tabs = container.find('[data-tafsir-lang]').filter(function () {
				return $(this).attr('role') === 'tab';
			});
			tabs.each(function () {
				$(this).toggleClass('d-none', $(this).attr('data-tafsir-lang') !== language);
			});
			var targetAlias = preferredAlias || selectedByLanguage[language];
			var target = targetAlias ? tabs.filter(function () {
				return $(this).attr('data-tafsir-hash') === targetAlias && $(this).attr('data-tafsir-lang') === language;
			}) : $();
			if (target.length !== 1)
				target = tabs.filter(function () {
					return $(this).attr('data-tafsir-lang') === language;
				}).first();
			if (target.length && window.bootstrap && window.bootstrap.Tab)
				window.bootstrap.Tab.getOrCreateInstance(target[0]).show();
		};

		container.on('shown.bs.tab', '[data-bs-toggle="tab"]', function (event) {
			var hash = $(event.target).attr('data-tafsir-hash');
			var language = $(event.target).attr('data-tafsir-lang');
			if (hash) {
				window.history.replaceState(null, '', `#tafsir=${encodeURIComponent(hash)}`);
				storeTafsirAlias(hash);
			}
			if (language) {
				activeLanguage = language;
				selectedByLanguage[language] = hash;
			}
			scrollTafsirTabIntoView($(event.target));
			loadPanel($($(event.target).attr('data-bs-target')));
		});
		container.find('[data-tafsir-language]').on('click', function () {
			showLanguage($(this).attr('data-tafsir-language'));
		});
		Promise.all([
			fetch(quranApiPath('/proxy/tafsir/books')).then(function (response) {
				if (!response.ok)
					throw new Error('Unable to load tafsir list.');
				return response.json();
			}),
			getQuranTafsirSettings()
		]).then(function (results) {
			var books = results[0];
			var settings = results[1];
			var disabledAliases = new Set((((settings || {}).tafsirs || {}).disabledAliases || []));
			var tafsirOrder = (((settings || {}).tafsirs || {}).order || {});
			var tafsirDeathYear = function (book) {
				var match = (book.death || '').toString().match(/\d+/);
				return match ? Number(match[0]) : NaN;
			};
			var defaultArabicOrder = [
				'en-tafsir-jalalayn',
				'en-tafsir-mokhtasar',
				'en-tafsir-ibn-kathir'
			];
			var visibleBooks = books.filter(function (book) {
				return !disabledAliases.has(book.alias);
			}).map(function (book, originalIndex) {
				return { book: book, originalIndex: originalIndex };
			}).sort(function (a, b) {
				var languageOrder = tafsirOrder[a.book.lang] || [];
				if (a.book.lang === 'ar' && b.book.lang === 'ar' && languageOrder.length < 1)
					languageOrder = defaultArabicOrder;
				var aIndex = languageOrder.indexOf(a.book.alias);
				var bIndex = languageOrder.indexOf(b.book.alias);
				aIndex = aIndex >= 0 ? aIndex : Number.MAX_SAFE_INTEGER;
				bIndex = bIndex >= 0 ? bIndex : Number.MAX_SAFE_INTEGER;
				if (a.book.lang === b.book.lang && aIndex !== bIndex)
					return aIndex - bIndex;
				if (a.book.lang === b.book.lang) {
					var aDeath = tafsirDeathYear(a.book);
					var bDeath = tafsirDeathYear(b.book);
					var aHasDeath = Number.isFinite(aDeath) && aDeath > 0;
					var bHasDeath = Number.isFinite(bDeath) && bDeath > 0;
					if (aHasDeath && bHasDeath && aDeath !== bDeath)
						return aDeath - bDeath;
					if (aHasDeath !== bHasDeath)
						return aHasDeath ? -1 : 1;
				}
				return a.originalIndex - b.originalIndex;
			}).map(function (entry) {
				return entry.book;
			});
			visibleBooks.forEach(addCatalogTab);
			if (visibleBooks.length < 1) {
				container.find('.quran-tafsir-content').html('<p class="text-muted">All tafsirs are disabled in My Settings.</p>');
				return;
			}
			var initialParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
			var initialHash = initialParams.get('tafsir') || initialParams.get('open-tafsir');
			var initialAlias = initialHash || getStoredTafsirAlias();
			var initialTab = container.find('[data-tafsir-hash]').filter(function () {
				return $(this).attr('data-tafsir-hash') === initialAlias;
			});
			if (initialTab.length)
				showLanguage(initialTab.first().attr('data-tafsir-lang'), initialAlias);
			else
				showLanguage(activeLanguage);
		}).catch(function (err) {
			container.find('.quran-tafsir-status').first().removeClass('d-none').text(err.message || 'Unable to load tafsir list.');
		});
	});
}

function getQuranTafsirSettings() {
	var waitForHadithAuth = function () {
		return new Promise(function (resolve) {
			if (window.hadithAuth && window.hadithAuth.getToken)
				return resolve(window.hadithAuth);
			var attempts = 0;
			var timer = window.setInterval(function () {
				attempts += 1;
				if (window.hadithAuth && window.hadithAuth.getToken) {
					window.clearInterval(timer);
					resolve(window.hadithAuth);
				} else if (attempts >= 50) {
					window.clearInterval(timer);
					resolve(null);
				}
			}, 100);
		});
	};
		var normalizeSettings = function (settings) {
			var source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
			var tafsirs = source.tafsirs && typeof source.tafsirs === 'object' && !Array.isArray(source.tafsirs) ? source.tafsirs : {};
			var order = tafsirs.order && typeof tafsirs.order === 'object' && !Array.isArray(tafsirs.order) ? tafsirs.order : {};
			return {
				tafsirs: {
					disabledAliases: Array.from(new Set((Array.isArray(tafsirs.disabledAliases) ? tafsirs.disabledAliases : [])
						.map(function (alias) { return (alias || '').toString().trim(); })
						.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias); }))),
					order: {
						en: Array.from(new Set((Array.isArray(order.en) ? order.en : [])
							.map(function (alias) { return (alias || '').toString().trim(); })
							.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias); }))),
						ar: Array.from(new Set((Array.isArray(order.ar) ? order.ar : [])
							.map(function (alias) { return (alias || '').toString().trim(); })
							.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias); })))
					}
				}
			};
		};
	return waitForHadithAuth().then(function (auth) {
		return auth && auth.getToken ? auth.getToken() : null;
	}).then(function (token) {
		if (!token)
			return normalizeSettings({});
		return fetch(quranApiPath('/user-settings'), {
			headers: { 'Authorization': `Bearer ${token}` }
		}).then(function (response) {
			if (!response.ok)
				return normalizeSettings({});
			return response.json();
		}).then(function (data) {
			return normalizeSettings(data.settings || {});
		}).catch(function () {
			return normalizeSettings({});
		});
	});
}

function initQuranAyahModals(root) {
	var scope = root || document;
	var modalStates = {};
	$(scope).find('.quran-ayah-modal').each(function () {
		var modal = $(this);
		var modalType = modal.attr('data-quran-ayah-modal-type') || 'tafsirs';
		if (modal.data('quranAyahModalBound')) {
			modalStates[modalType] = modal.data('quranAyahModalState');
			return;
		}
		modal.data('quranAyahModalBound', true);
		var panes = modal.find('[data-quran-ayah-modal-pane]');
		var modalBody = modal.find('.modal-body');
		var title = modal.find('.modal-title');
		var prevButton = modal.find('.quran-ayah-modal-prev');
		var nextButton = modal.find('.quran-ayah-modal-next');
		var activeIndex = 0;
		var shown = false;
		var paneAt = function (index) {
			return panes.filter(`[data-quran-ayah-modal-pane="${index}"]`);
		};
		var refHref = function (ref) {
			if (!ref)
				return '';
			var href = `/${ref.replace(/^\/+/, '')}`;
			if (modalType === 'tafsirs' && /^#tafsir(?:=|$)/.test(window.location.hash))
				href += window.location.hash;
			return href;
		};
		var boundaryHref = function (step) {
			var pane = paneAt(activeIndex);
			var attr = step < 0 ? 'data-quran-ayah-prev-ref' : 'data-quran-ayah-next-ref';
			return refHref(pane.attr(attr) || '');
		};
		var navigateToBoundary = function (step) {
			var href = boundaryHref(step);
			if (!href)
				return false;
			window.location.href = href;
			return true;
		};
		var scrollActiveTafsirTabs = function () {
			var pane = paneAt(activeIndex);
			pane.find('.quran-tafsirs').each(function () {
				var scrollActive = $(this).data('scrollActiveTafsirTabIntoView');
				if (scrollActive)
					scrollActive();
			});
		};
		var loadActiveCommentWidgets = function () {
			if (!shown || modalType !== 'reflections')
				return;
			paneAt(activeIndex).find('.comment-feed[data-lazy-load="1"]').each(function () {
				document.dispatchEvent(new CustomEvent('hadithCommentWidgetLoad', {
					detail: {
						widgetId: this.id,
						hadithId: this.getAttribute('data-target-id')
					}
				}));
			});
		};

		var showAyah = function (index) {
			if (!panes.length)
				return;
			activeIndex = Math.max(0, Math.min(Number(index) || 0, panes.length - 1));
			var pane = paneAt(activeIndex);
			panes.addClass('d-none');
			pane.removeClass('d-none');
			var ayahRef = pane.attr('data-quran-ayah-ref') || '';
			title.text(modalType === 'reflections' ? `Reflections on Quran ${ayahRef}` : `Tafsir of Quran ${ayahRef}`);
			prevButton.prop('disabled', activeIndex === 0 && !boundaryHref(-1));
			nextButton.prop('disabled', activeIndex === panes.length - 1 && !boundaryHref(1));
			modalBody.scrollTop(0);
			initQuranTafsirTabs(pane[0]);
			loadActiveCommentWidgets();
			scrollActiveTafsirTabs();
		};
		var openAyah = function (index) {
			showAyah(index);
			if (window.bootstrap && window.bootstrap.Modal)
				window.bootstrap.Modal.getOrCreateInstance(modal[0]).show();
		};
		var moveAyah = function (step) {
			var targetIndex = activeIndex + step;
			if (targetIndex < 0 || targetIndex >= panes.length)
				return navigateToBoundary(step);
			showAyah(targetIndex);
			return true;
		};
		var rotateTafsir = function (step) {
			var pane = panes.filter(`[data-quran-ayah-modal-pane="${activeIndex}"]`);
			var tabs = pane.find('.quran-tafsirs [role="tab"]').filter(function () {
				return !$(this).hasClass('d-none');
			});
			if (!tabs.length || !window.bootstrap || !window.bootstrap.Tab)
				return false;
			var current = tabs.index(tabs.filter('.active'));
			var next = current < 0 ? 0 : (current + step + tabs.length) % tabs.length;
			window.bootstrap.Tab.getOrCreateInstance(tabs[next]).show();
			return true;
		};

		prevButton.on('click', function () { moveAyah(-1); });
		nextButton.on('click', function () { moveAyah(1); });
		modal.find('.quran-ayah-modal-tafsir-prev').on('click', function () { rotateTafsir(-1); });
		modal.find('.quran-ayah-modal-tafsir-next').on('click', function () { rotateTafsir(1); });
		modal.on('shown.bs.modal', function () {
			shown = true;
			loadActiveCommentWidgets();
			scrollActiveTafsirTabs();
		});
		modal.on('hidden.bs.modal', function () { shown = false; });
		var modalState = {
			isShown: function () { return shown; },
			openAyah: openAyah,
			moveAyah: moveAyah,
			rotateTafsir: rotateTafsir
		};
		modal.data('quranAyahModalState', modalState);
		modalStates[modalType] = modalState;

		showAyah(0);
	});

	if ($(document).data('quranAyahModalHandlersBound'))
		return;
	$(document).data('quranAyahModalHandlersBound', true);
	var getModalState = function (type) {
		return modalStates[type] || modalStates.tafsirs;
	};
	var openAyah = function (index, type) {
		var state = getModalState(type);
		if (state)
			state.openAyah(index);
	};
	var openInitialAyahModalFromHash = function () {
		var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
		if (!params.has('open-tafsir'))
			return;
		var trigger = $('.quran-ayah-modal-trigger[data-quran-ayah-modal-type="tafsirs"]').first();
		var index = trigger.length ? trigger.attr('data-quran-ayah-modal-index') : 0;
		openAyah(index, 'tafsirs');
	};
	var getShownModalState = function () {
		var state = Object.values(modalStates).find(function (modalState) {
			return modalState.isShown();
		});
		if (state)
			return state;
		var shownModal = $('.quran-ayah-modal.show').first();
		if (!shownModal.length)
			return null;
		return shownModal.data('quranAyahModalState') || getModalState(shownModal.attr('data-quran-ayah-modal-type'));
	};
	document.addEventListener('keydown', function (event) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
			return;
		var state = getShownModalState();
		if (!state)
			return;
		if ($(event.target).is('input, textarea, select, [contenteditable="true"]'))
			return;
		var handled = event.key === 'ArrowLeft' ? state.moveAyah(-1) : state.moveAyah(1);
		if (handled) {
			event.preventDefault();
			event.stopPropagation();
		}
	}, true);

	$(document).on('keydown.quranAyahModal', function (event) {
			var state = getShownModalState();
			if (!state)
				return;
			if ($(event.target).is('input, textarea, select'))
				return;
			var handled = true;
			if (event.key === 'ArrowUp')
				handled = state.rotateTafsir(-1);
			else if (event.key === 'ArrowDown')
				handled = state.rotateTafsir(1);
			else
				return;
			if (handled)
				event.preventDefault();
		});

		$(document).on('click.quranAyahModal', '.quran-ayah-modal-trigger', function (event) {
			if ($('body').hasClass('quran-ayah-selecting'))
				return;
			event.preventDefault();
			event.stopPropagation();
			openAyah($(this).attr('data-quran-ayah-modal-index'), $(this).attr('data-quran-ayah-modal-type'));
		});

		var longPressTimer = null;
		var longPressOpened = false;
		var longPressStart = null;
		$(document).on('pointerdown.quranAyahModal', '.quran-passage-section .ayah[data-quran-ayah-modal-index]', function (event) {
			if (event.pointerType === 'mouse' || $('body').hasClass('quran-ayah-selecting'))
				return;
			var ayah = $(this);
			longPressOpened = false;
			longPressStart = { x: event.clientX, y: event.clientY };
			window.clearTimeout(longPressTimer);
			longPressTimer = window.setTimeout(function () {
				longPressOpened = true;
				openAyah(ayah.attr('data-quran-ayah-modal-index'));
			}, 550);
		});
		$(document).on('pointerup.quranAyahModal pointercancel.quranAyahModal', '.quran-passage-section .ayah[data-quran-ayah-modal-index]', function () {
			window.clearTimeout(longPressTimer);
			longPressStart = null;
		});
		$(document).on('pointermove.quranAyahModal', '.quran-passage-section .ayah[data-quran-ayah-modal-index]', function (event) {
			if (!longPressStart)
				return;
			var dx = event.clientX - longPressStart.x;
			var dy = event.clientY - longPressStart.y;
			if ((dx * dx) + (dy * dy) <= 144)
				return;
			window.clearTimeout(longPressTimer);
			longPressStart = null;
		});
		$(document).on('click.quranAyahModalLongPress', '.quran-passage-section .ayah[data-quran-ayah-modal-index] a', function (event) {
			if (!longPressOpened)
				return;
			event.preventDefault();
			event.stopPropagation();
			longPressOpened = false;
		});

		openInitialAyahModalFromHash();
}

function copyTextToClipboard(text) {
	if (navigator.clipboard && navigator.clipboard.writeText)
		return navigator.clipboard.writeText(text);
	var textArea = document.createElement('textarea');
	textArea.value = text;
	textArea.setAttribute('readonly', '');
	textArea.style.position = 'fixed';
	textArea.style.opacity = '0';
	document.body.appendChild(textArea);
	textArea.select();
	var copied = document.execCommand('copy');
	textArea.remove();
	return copied ? Promise.resolve() : Promise.reject(new Error('Unable to copy passage URL'));
}

function initQuranAyahHoverPairs(root) {
	var scope = root || document;
	$(scope).find('.quran-passage-section .body.passage .ayah [data-ayah-number]').each(function () {
		var ayah = $(this).closest('.ayah');
		if (ayah.data('quranHoverBound'))
			return;
		ayah.data('quranHoverBound', true);
		ayah.on('mouseenter focusin', function () {
			var link = $(this).find('[data-ayah-number]').first();
			var ayahNumber = normalizeQuranAyahNumber(link.attr('data-ayah-number'));
			if (!ayahNumber)
				return;
			var section = $(this).closest('.quran-passage-section');
			section.find('.body.passage .ayah').each(function () {
				var otherLink = $(this).find('[data-ayah-number]').first();
				$(this).toggleClass('ayah-hover-pair', normalizeQuranAyahNumber(otherLink.attr('data-ayah-number')) === ayahNumber);
			});
		});
		ayah.on('mouseleave focusout', function () {
			$(this).closest('.quran-passage-section').find('.ayah-hover-pair').removeClass('ayah-hover-pair');
		});
	});
}

function normalizeQuranAyahNumber(value) {
	if (value === undefined || value === null)
		return '';
	return value.toString()
		.replace(/[٠-٩]/g, function (digit) {
			return '٠١٢٣٤٥٦٧٨٩'.indexOf(digit).toString();
		})
		.replace(/[۰-۹]/g, function (digit) {
			return '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit).toString();
		})
		.replace(/^.*:/, '')
		.replace(/\D/g, '');
}

var quranCorpusPayloadCache = {};

function initQuranCorpusTooltips(root) {
	var scope = root || document;
	$(scope).find('[data-quran-corpus-url]').addBack('[data-quran-corpus-url]').each(function () {
		var container = $(this);
		if (container.data('quranCorpusBound'))
			return;
		container.data('quranCorpusBound', true);
		var url = container.attr('data-quran-corpus-url');
		if (!url)
			return;
		quranCorpusPayloadCache[url] = quranCorpusPayloadCache[url] || fetch(url, {
			credentials: 'same-origin',
			headers: { 'Accept': 'application/json' }
		}).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load Quran corpus words');
			return response.json();
		});
		quranCorpusPayloadCache[url]
			.then(function (payload) {
				annotateQuranCorpusWords(container, payload.wordsByAyah || {});
			})
			.catch(function () {
				container.removeData('quranCorpusBound');
			});
	});
}

function annotateQuranCorpusWords(container, wordsByAyah) {
	container.find('[data-quran-ref]').each(function () {
		var target = $(this);
		if (target.data('quranCorpusAnnotated'))
			return;
		var ref = target.attr('data-quran-ref');
		var words = wordsByAyah[ref];
		if (!words || words.length < 1)
			return;
		annotateExistingQuranText(target[0], words);
		target.data('quranCorpusAnnotated', true);
	});
}

function annotateExistingQuranText(root, words) {
	var wordIndex = 0;
	var pendingWord = null;
	var pendingParts = 0;
	var punctuationPattern = /^[\u061B\u061F\u060C\u06D6-\u06EDۖ-۩.,:;!?()[\]{}"'«»“”‘’…-]+$/;
	var wordPartCount = function (word) {
		return Math.max(1, ((word && word.text) || '').trim().split(/\s+/).filter(Boolean).length);
	};
	var nextCorpusWord = function (token) {
		if (!token || punctuationPattern.test(token))
			return null;
		if (pendingWord) {
			pendingParts -= 1;
			var word = pendingWord;
			if (pendingParts <= 0)
				pendingWord = null;
			return word;
		}
		if (wordIndex >= words.length)
			return null;
		var current = words[wordIndex];
		wordIndex += 1;
		var parts = wordPartCount(current);
		if (parts > 1) {
			pendingWord = current;
			pendingParts = parts - 1;
		}
		return current;
	};
	var annotateTextNode = function (node) {
		var parts = node.nodeValue.split(/(\s+)/);
		var fragment = document.createDocumentFragment();
		parts.forEach(function (part) {
			if (!part)
				return;
			if (/^\s+$/.test(part)) {
				fragment.appendChild(document.createTextNode(part));
				return;
			}
			var word = nextCorpusWord(part);
			fragment.appendChild(word
				? renderQuranCorpusTooltipWord(part, word)[0]
				: document.createTextNode(part));
		});
		node.parentNode.replaceChild(fragment, node);
	};
	var walk = function (node) {
		if (!node)
			return;
		if (node.nodeType === 3) {
			if (/\S/.test(node.nodeValue))
				annotateTextNode(node);
			return;
		}
		if (node.nodeType !== 1 || $(node).hasClass('quran-corpus-word'))
			return;
		Array.from(node.childNodes).forEach(walk);
	};
	walk(root);
}

function renderQuranCorpusTooltipWord(text, word) {
	var translation = (word.translation || '').toString();
	var grammar = (word.grammar || word.partsOfSpeech || '').toString();
	return $('<span>').addClass('quran-corpus-word').attr({
		'data-quran-word-translation': translation,
		'data-quran-word': text,
		'data-quran-word-number': word.word || '',
		'data-quran-word-grammar': grammar,
		tabindex: 0
	}).text(text);
}

function initQuranCorpusTooltipDelay(root) {
	var scope = root || document;
	var eventRoot = scope === document ? $(document) : $(scope);
	if (eventRoot.data('quranCorpusTooltipDelayBound'))
		return;
	eventRoot.data('quranCorpusTooltipDelayBound', true);
	var tooltip = $('<div class="quran-corpus-tooltip" role="tooltip" hidden></div>').appendTo(document.body);
	var hideTooltip = function (word) {
		window.clearTimeout(word.data('quranCorpusTooltipTimer'));
		word.removeData('quranCorpusTooltipTimer');
		word.removeClass('quran-corpus-word-tooltip-ready');
		tooltip.attr('hidden', true).text('');
	};
	var showTooltipNow = function (word) {
		var text = word.attr('data-quran-word-translation') || '';
		if (!text)
			return;
		var rect = word[0].getBoundingClientRect();
		tooltip.text(text).removeAttr('hidden');
		var tooltipRect = tooltip[0].getBoundingClientRect();
		var left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
		left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
		var top = rect.top - tooltipRect.height - 8;
		if (top < 8)
			top = rect.bottom + 8;
		tooltip.css({ left: left + 'px', top: top + 'px' });
		word.addClass('quran-corpus-word-tooltip-ready');
	};
	var showTooltip = function (word, delay) {
		window.clearTimeout(word.data('quranCorpusTooltipTimer'));
		word.data('quranCorpusTooltipTimer', window.setTimeout(function () {
			showTooltipNow(word);
		}, delay));
	};
	eventRoot.on('mouseenter focusin', '.quran-corpus-word', function () {
		showTooltip($(this), 750);
	});
	eventRoot.on('click', '.quran-corpus-word', function (event) {
		if ($(this).closest('.body.passage a[href]').length)
			return;
		event.preventDefault();
		event.stopPropagation();
		try {
			this.focus({ preventScroll: true });
		} catch (err) {
			this.focus();
		}
		showTooltip($(this), 0);
	});
	eventRoot.on('mouseleave focusout', '.quran-corpus-word', function () {
		hideTooltip($(this));
	});
	$(window).on('scroll resize', function () {
		tooltip.attr('hidden', true).text('');
	});
}

function initQuranAyahSelector(root) {
	var scope = root || document;
	$(scope).find('.quran-ayah-select-toolbar').each(function () {
		var toolbar = $(this);
		if (toolbar.data('quranSelectBound'))
			return;
		toolbar.data('quranSelectBound', true);
		var surah = toolbar.data('surah');
		var selected = new Set();
		var selecting = false;
		var toggleButton = toolbar.find('.quran-ayah-select-toggle');
		var openButton = toolbar.find('.quran-ayah-select-open');
		var clearButton = toolbar.find('.quran-ayah-select-clear');
		var liveLabel = toolbar.find('.quran-ayah-select-live');

		var ayahElements = () => $('.quran-passage-section .body.passage .ayah').filter(function () {
			return normalizeQuranAyahNumber($(this).find('[data-ayah-number]').first().attr('data-ayah-number'));
		});
		var sortedSelected = () => Array.from(selected).map(Number).sort(function (a, b) { return a - b; });
		var selectedPath = () => {
			var nums = sortedSelected();
			if (nums.length < 1)
				return '';
			var start = nums[0];
			var end = nums[nums.length - 1];
			return quranUrl(`/quran:${surah}:${start}${end > start ? '-' + end : ''}`);
		};
		var update = () => {
			ayahElements().each(function () {
				var ayahNumber = normalizeQuranAyahNumber($(this).find('[data-ayah-number]').first().attr('data-ayah-number'));
				$(this).toggleClass('ayah-multi-selected', selected.has(ayahNumber));
			});
			var nums = sortedSelected();
			var hasSelection = nums.length > 0;
			var label = '';
			if (hasSelection) {
				var start = nums[0];
				var end = nums[nums.length - 1];
				label = `Quran ${surah}:${start}${end > start ? '-' + end : ''}`;
			}
			openButton.prop('disabled', !hasSelection);
			if (clearButton.is('button'))
				clearButton.prop('disabled', !hasSelection);
			liveLabel.text(label);
		};
		toolbar.data('selected', selected);
		toolbar.data('update', update);
		var setSelecting = (enabled) => {
			$('.quran-ayah-select-toolbar').not(toolbar).data('selecting', false).removeClass('is-selecting')
				.find('.quran-ayah-select-toggle').removeClass('btn-secondary').addClass('btn-outline-secondary');
			selecting = enabled;
			toolbar.data('selecting', selecting);
			toolbar.toggleClass('is-selecting', selecting);
			toggleButton.toggleClass('btn-secondary', selecting);
			toggleButton.toggleClass('btn-outline-secondary', !selecting);
			$('body').toggleClass('quran-ayah-selecting', $('.quran-ayah-select-toolbar').filter(function () {
				return $(this).data('selecting') === true;
			}).length > 0);
		};

		toggleButton.on('click', function () {
			setSelecting(!selecting);
		});
		if (clearButton.is('button')) {
			clearButton.on('click', function () {
				selected.clear();
				setSelecting(false);
				update();
			});
		}
		openButton.on('click', function () {
			var path = selectedPath();
			if (path)
				window.location.href = path;
		});
		update();
	});
	$(document).off('click.quranAyahSelector').on('click.quranAyahSelector', '.quran-passage-section .body.passage .ayah', function (event) {
		var toolbar = $('.quran-ayah-select-toolbar').filter(function () {
			return $(this).data('selecting') === true;
		}).first();
		if (!toolbar.length)
			return;
		event.preventDefault();
		event.stopPropagation();
		var ayahNumber = normalizeQuranAyahNumber($(this).find('[data-ayah-number]').first().attr('data-ayah-number'));
		if (!ayahNumber)
			return;
		var selected = toolbar.data('selected');
		if (!selected)
			return;
		if (selected.has(ayahNumber))
			selected.delete(ayahNumber);
		else
			selected.add(ayahNumber);
		toolbar.data('update')();
	});
	}

	function initQuranPageKeyboardNavigation(root) {
		if ($(document).data('quranPageKeyboardNavigationBound'))
			return;
		$(document).data('quranPageKeyboardNavigationBound', true);
		$(document).on('keydown.quranPageKeyboardNavigation', function (event) {
			if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
				return;
			if ($('.modal.show').length)
				return;
			var targetInAyahHero = $(event.target).closest('.quran-ayah-hero').length > 0;
			if (!targetInAyahHero && $(event.target).closest('input, textarea, select, button, [contenteditable="true"], ._e').length)
				return;
			if (targetInAyahHero && $(event.target).closest('input, textarea, select, [contenteditable="true"], ._e').length)
				return;
			var href;
			if (event.key === 'ArrowLeft' || event.key === 'BrowserBack')
				href = $('.quran-ayah-hero-prev').first().attr('href') || $('.pagination a[rel="prev"]').first().attr('href');
			else if (event.key === 'ArrowRight' || event.key === 'BrowserForward')
				href = $('.quran-ayah-hero-next').first().attr('href') || $('.pagination a[rel="next"]').first().attr('href');
			else if (event.key === 'ArrowUp')
				href = $('.pagination a[rel="prev"]').first().attr('href');
			else if (event.key === 'ArrowDown')
				href = $('.pagination a[rel="next"]').first().attr('href');
			else
				return;
			if (!href)
				return;
			event.preventDefault();
			window.location.href = href;
		});
	}

	function initSearchAutocomplete() {
		if (!$.fn.autocomplete)
			return;
	$('input[role=search][name=q], .quran-passage-search').each(function () {
		var input = this;
		var $input = $(input);
		var suggestionOnly = $input.hasClass('quran-passage-search');
		var $appendTarget = $input.closest('.search-click-toggle, .input-group, .offcanvas-body');
		if (!$appendTarget.length)
			$appendTarget = $input.closest('form');
		if ($input.data('autocompleteBound'))
			return;
		$input.data('autocompleteBound', true);
		$input.on('keydown', function (event) {
			if (event.key !== 'Enter')
				return;
			event.preventDefault();
			var $widget = $input.autocomplete('widget');
			var activeItem = $widget.is(':visible') ? $widget.find('.ui-state-active').closest('li').data('ui-autocomplete-item') : null;
			if (activeItem && activeItem.url) {
				window.location.href = activeItem.is_quran ? quranUrl(activeItem.url) : activeItem.url;
				return;
			}
			if (suggestionOnly) {
				if ($input.val().trim())
					submitQuranPassageSearch($input);
				else if (!$widget.is(':visible'))
					$input.autocomplete('search', $input.val());
				return;
			}
			$input.autocomplete('close');
			$(input.form).trigger('submit');
		});
		$input.autocomplete({
			appendTo: $appendTarget,
			delay: 180,
			minLength: 2,
			source: function (request, response) {
				$.getJSON(quranApiPath('/autocomplete'), buildSearchAutocompleteParams($input, request.term))
					.done(response)
					.fail(function () {
						response([]);
					});
			},
			focus: function (event) {
				event.preventDefault();
			},
			select: function (event, ui) {
				event.preventDefault();
				if (ui.item.url)
					window.location.href = ui.item.is_quran ? quranUrl(ui.item.url) : ui.item.url;
				else if (!suggestionOnly)
					$input.closest('form').trigger('submit');
			},
			open: function () {
				var autocomplete = $input.autocomplete('widget');
				autocomplete.addClass('search-autocomplete-menu');
				autocomplete.css('width', $input.outerWidth());
				if ($input.css('direction') === 'rtl')
					autocomplete.attr('dir', 'rtl');
				else
					autocomplete.attr('dir', 'ltr');
			}
		}).autocomplete('instance')._renderItem = function (ul, item) {
			var $item = $('<li>');
			var $row = $('<div>').addClass('search-autocomplete-item');
			var isArabic = item.lang === 'ar';
			var fallbackText = item.label || '';
			if (item.is_quran && (item.type === 'Ayah' || item.type === 'Surah'))
				$row.addClass('search-autocomplete-quran');
			if (isArabic)
				$row.attr({ lang: 'ar', dir: 'rtl' }).addClass('search-autocomplete-ar');
			var $match = $('<div>').addClass('search-autocomplete-match');
			if (item.type === 'Book' || item.type === 'Surah')
				$match.addClass('search-autocomplete-name');
			$match.html(item.fragment || fallbackText).appendTo($row);
			if (item.metadata_en || item.metadata_ar) {
				var $meta = $('<div>').addClass('search-autocomplete-meta');
				if (item.lang === 'ar' && item.metadata_ar) {
					$('<span>').addClass('search-autocomplete-meta-ar').attr({ lang: 'ar', dir: 'rtl' }).text(item.metadata_ar).appendTo($meta);
					if (item.metadata_en)
						$('<span>').addClass('search-autocomplete-meta-en').attr({ lang: 'en', dir: 'ltr' }).text(item.metadata_en).appendTo($meta);
				} else if (item.metadata_en) {
					$('<span>').addClass('search-autocomplete-meta-en').attr({ lang: 'en', dir: 'ltr' }).text(item.metadata_en).appendTo($meta);
				}
				$meta.appendTo($row);
			}
			if (item.url) {
				$row.attr('role', 'link').on('mousedown click', function (event) {
					event.preventDefault();
					event.stopImmediatePropagation();
					window.location.href = item.is_quran ? quranUrl(item.url) : item.url;
				});
			}
			return $item.append($row).appendTo(ul);
		};
	});
}

function buildSearchAutocompleteParams($input, term) {
	var params = [
		{ name: 'q', value: term },
		{ name: 'limit', value: 10 }
	];
	var $filters = $input.closest('form').find('input[name=b]').filter(function () {
		return this.type === 'hidden' || this.checked;
	});
	$filters.each(function () {
		params.push({ name: 'b', value: this.value });
	});
	return $.param(params);
}

function submitQuranPassageSearch($input) {
	var term = ($input.val() || '').trim();
	if (!term)
		return false;
	$input.autocomplete('close');
	window.location.href = `/quran?${$.param([
		{ name: 'q', value: term },
		{ name: 'b', value: 'quran' },
		{ name: 'b', value: 'commentaries' }
	])}`;
	return true;
}

function initQuranPassageNavigator() {
	$('[data-quran-passage-navigator]').each(function () {
		var form = this;
		var $form = $(form);
		if ($form.data('quranNavigatorBound'))
			return;
		$form.data('quranNavigatorBound', true);
		var surahs = [];
		try {
			surahs = JSON.parse(form.dataset.surahs || '[]');
		} catch (err) {
			surahs = [];
		}
		var $surahInput = $form.find('.quran-passage-surah');
		var $ayahInput = $form.find('.quran-passage-ayah');
		var $searchInput = $form.find('.quran-passage-search');
		var toArabicDigits = function (value) {
			return String(value).replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[digit]);
		};
		var toLatinDigits = function (value) {
			return String(value)
				.replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
				.replace(/[۰-۹]/g, digit => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit));
		};
		var normalizeText = function (value) {
			return toLatinDigits(value || '').trim().toLowerCase();
		};
		var normalizeSearchText = function (value) {
			return normalizeText(value)
				.normalize('NFD')
				.replace(/\p{Diacritic}/gu, '')
				.replace(/[^\p{L}\p{M}\d]+/gu, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		};
		var surahLabel = function (surah) {
			return `${surah.num} ${surah.name_en}`;
		};
		var surahInputLabel = function (surah) {
			return `${surah.num}`;
		};
		var ayahLabel = function (ayah) {
			return `${ayah}`;
		};
		var surahMatches = function (surah, term) {
			var normalized = normalizeSearchText(term);
			if (!normalized)
				return true;
			var haystack = normalizeSearchText([
				surah.num,
				toArabicDigits(surah.num),
				surah.name_en,
				surah.name_ar
			].join(' '));
			return haystack.includes(normalized);
		};
		var findSurah = function (value) {
			var normalized = normalizeText(value);
			var leadingNumber = normalized.match(/^\d+/);
			if (leadingNumber) {
				var numberedSurah = surahs.find(item => Number(item.num) === Number(leadingNumber[0]));
				if (numberedSurah)
					return numberedSurah;
			}
			var searchable = normalizeSearchText(value);
			return surahs.find(function (surah) {
				return searchable && (
					searchable === normalizeSearchText(surah.name_en)
					|| searchable === normalizeSearchText(surah.name_ar)
					|| searchable === normalizeSearchText(toArabicDigits(surah.num))
					|| normalizeSearchText(surahLabel(surah)).includes(searchable)
				);
			});
		};
		var ayahNumber = function (value) {
			var match = normalizeText(value).match(/\d+/);
			return match ? Number(match[0]) : NaN;
		};
		var selectedSurah = function () {
			return findSurah($surahInput.val()) || surahs[0];
		};
		var clampAyah = function (surah, value) {
			var ayah = ayahNumber(value);
			var ayahCount = Number(surah && surah.ayahs) || 1;
			if (!Number.isInteger(ayah))
				ayah = 1;
			return Math.min(Math.max(ayah, 1), ayahCount);
		};
		var syncSurah = function () {
			var surah = findSurah($surahInput.val());
			if (!surah)
				return null;
			$surahInput.val(surahInputLabel(surah)).removeClass('is-invalid');
			$ayahInput.val(clampAyah(surah, $ayahInput.val())).removeClass('is-invalid');
			return surah;
		};
		var renderQuranSuggestion = function (ul, item) {
			var $item = $('<li>');
			var $row = $('<div>').addClass('search-autocomplete-item search-autocomplete-quran');
			$('<div>').addClass('search-autocomplete-match search-autocomplete-name').text(item.label).appendTo($row);
			return $item.append($row).appendTo(ul);
		};
			if ($.fn.autocomplete) {
				$surahInput.autocomplete({
				appendTo: $form,
				delay: 0,
				minLength: 0,
				source: function (request, response) {
					response(surahs
						.filter(surah => surahMatches(surah, request.term))
						.slice(0, 12)
						.map(surah => ({
							label: surahLabel(surah),
							value: surahInputLabel(surah),
							surah: surah
						})));
				},
				focus: function (event) {
					event.preventDefault();
				},
				select: function (event, ui) {
					event.preventDefault();
					$surahInput.val(ui.item.value).removeClass('is-invalid');
					$ayahInput.val(clampAyah(ui.item.surah, $ayahInput.val())).removeClass('is-invalid').focus();
				},
				open: function () {
					var autocomplete = $surahInput.autocomplete('widget');
					autocomplete.addClass('search-autocomplete-menu quran-passage-autocomplete-menu');
					autocomplete.css('width', $surahInput.outerWidth());
				}
			}).autocomplete('instance')._renderItem = function (ul, item) {
				return renderQuranSuggestion(ul, item);
			};
			$ayahInput.autocomplete({
				appendTo: $form,
				delay: 0,
				minLength: 0,
				source: function (request, response) {
					var surah = selectedSurah();
					var ayahCount = Number(surah && surah.ayahs) || 1;
					var normalized = normalizeText(request.term);
					var requestedNumber = ayahNumber(normalized);
					var items = [];
					for (var ayah = 1; ayah <= ayahCount; ayah++) {
						var label = ayahLabel(ayah);
						if (normalized && !label.includes(normalized) && ayah !== requestedNumber)
							continue;
						items.push({
							label: label,
							value: String(ayah),
							ayah: ayah
						});
						if (items.length >= 20)
							break;
					}
					response(items);
				},
				focus: function (event) {
					event.preventDefault();
				},
				select: function (event, ui) {
					event.preventDefault();
					$ayahInput.val(ui.item.value).removeClass('is-invalid');
				},
				open: function () {
					var autocomplete = $ayahInput.autocomplete('widget');
					autocomplete.addClass('search-autocomplete-menu quran-passage-autocomplete-menu');
					autocomplete.css('width', $ayahInput.outerWidth());
				}
				}).autocomplete('instance')._renderItem = function (ul, item) {
					return renderQuranSuggestion(ul, item);
				};
				$surahInput.add($ayahInput).on('focus click', function () {
					var $input = $(this);
					if (!$input.data('quranNavigatorPreviousValue'))
						$input.data('quranNavigatorPreviousValue', $input.val());
					$input.val('');
					$input.autocomplete('search', '');
				});
			}
			$surahInput.on('change blur', function () {
				if (!$surahInput.val())
					$surahInput.val($surahInput.data('quranNavigatorPreviousValue') || '');
				syncSurah();
				$surahInput.removeData('quranNavigatorPreviousValue');
			});
			$ayahInput.on('change blur', function () {
				if (!$ayahInput.val())
					$ayahInput.val($ayahInput.data('quranNavigatorPreviousValue') || '');
				var surah = selectedSurah();
				$ayahInput.val(clampAyah(surah, $ayahInput.val())).removeClass('is-invalid');
				$ayahInput.removeData('quranNavigatorPreviousValue');
			});
		$form.on('click', '.quran-passage-search-submit', function () {
			submitQuranPassageSearch($searchInput);
		});
		$form.on('submit', function (event) {
			event.preventDefault();
			var surah = syncSurah();
			var ayah = ayahNumber($ayahInput.val());
			if (!surah || !Number.isInteger(ayah) || ayah < 1 || ayah > Number(surah.ayahs)) {
				$surahInput.toggleClass('is-invalid', !surah);
				$ayahInput.toggleClass('is-invalid', !Number.isInteger(ayah) || ayah < 1 || (surah && ayah > Number(surah.ayahs)));
				return;
			}
			window.location.href = quranUrl(`/quran:${surah.num}:${ayah}`);
		});
	});
}

function cleanText(s) {
	s = s.toLowerCase();
	s = s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
	s = s.replace(/[ʿʾ`'\-]/g, '');
	s = s.replace(/[\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670]/g, '');
	s = s.replace(/[إأآ]/g, 'ا');
	s = s.replace(/ؤ/g, 'ء');
	s = s.replace(/ئ/g, 'ء');
	return s;
}

function isMarkdownBlockNode(node) {
	return node && node.nodeType === Node.ELEMENT_NODE && /^(p|div|ul|ol|blockquote)$/i.test(node.tagName);
}

function markdownNodesToText(nodes) {
	var text = '';
	Array.from(nodes || []).forEach(function (node, idx, arr) {
		var segment = markdownNodeToText(node);
		if (!segment)
			return;
		if (!text) {
			text = segment;
			return;
		}
		if (isMarkdownBlockNode(arr[idx - 1]) || isMarkdownBlockNode(node))
			text += '\n\n' + segment;
		else
			text += segment;
	});
	return text;
}

function markdownNodeToText(node) {
	if (!node)
		return '';
	if (node.nodeType === Node.TEXT_NODE)
		return node.nodeValue;
	if (node.nodeType !== Node.ELEMENT_NODE)
		return '';
	var tag = node.tagName.toLowerCase();
	var children = markdownNodesToText(node.childNodes);
	switch (tag) {
	case 'br':
		return '\n\n';
	case 'p':
	case 'div':
		return children;
	case 'strong':
	case 'b':
		return children ? '**' + children + '**' : '';
	case 'em':
	case 'i':
		return children ? '*' + children + '*' : '';
	case 'u':
		return children ? '__' + children + '__' : '';
	case 'a': {
		var href = node.getAttribute('href') || '';
		return href ? '[' + (children || href) + '](' + href + ')' : children;
	}
	case 'ul':
		return Array.from(node.children).map(function (li) {
			return '- ' + markdownNodeToText(li).trim();
		}).join('\n');
	case 'ol':
		return Array.from(node.children).map(function (li, idx) {
			return (idx + 1) + '. ' + markdownNodeToText(li).trim();
		}).join('\n');
	case 'li':
		return children;
	case 'blockquote':
		return children.split(/\n/).map(function (line) {
			return line ? '> ' + line : '>';
		}).join('\n');
	default:
		return children;
	}
}

function htmlToMarkdown(html) {
	if (!html)
		return '';
	var parser = new DOMParser();
	var doc = parser.parseFromString(html, 'text/html');
	return markdownNodesToText(doc.body.childNodes).replace(/\n{3,}/g, '\n\n').trim();
}

function renderMarkdownPreview(el, markdown) {
	var emptyHtml = el.getAttribute('data-markdown-empty-html') || '';
	el.dataset.markdownSource = markdown;
	el.classList.remove('markdown-editing');
	if (markdown) {
		if (window.marked && window.marked.parse)
			el.innerHTML = window.marked.parse(markdown).replace(/<br>/g, '</p><p>').trim();
		else
			el.textContent = markdown;
	} else {
		el.innerHTML = emptyHtml;
	}
}

function initMarkdownEditablePreviews(root) {
	var scope = root || document;
	scope.querySelectorAll('[contenteditable][data-markdown-source]:not(._e)').forEach(function (el) {
		if (el.dataset.markdownPreviewBound === 'true')
			return;
		el.dataset.markdownPreviewBound = 'true';
		el.addEventListener('focusin', function () {
			if (el.classList.contains('markdown-editing'))
				return;
			el.classList.add('markdown-editing');
			el.textContent = el.dataset.markdownSource || '';
		});
		el.addEventListener('blur', function () {
			renderMarkdownPreview(el, htmlToMarkdown(el.innerHTML).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' '));
		});
	});
}

function initHadithTranslateButtons(root) {
	var scope = root || document;
	scope.querySelectorAll('.hadith-translate-btn').forEach(function (button) {
		if (button.dataset.translateBound === 'true')
			return;
		button.dataset.translateBound = 'true';
		button.addEventListener('click', async function () {
			var hadithId = button.dataset.hadithId;
			var placeholder = button.closest('.cmd-tr');
			var originalHtml = button.innerHTML;
			if (!hadithId || button.disabled)
				return;

			button.disabled = true;
			button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Verifying';

			try {
				var captcha = await getTranslateCaptcha();
				if (!captcha) {
					button.disabled = false;
					button.innerHTML = originalHtml;
					return;
				}
				button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Translating';
				var res = await fetch(quranApiPath('/do/' + encodeURIComponent(hadithId) + '?cmd=tr'), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(captcha)
				});
				var data = await res.json();
				if (!res.ok)
					throw new Error(data.message || res.statusText || 'Translation failed');

				var body = document.querySelector('[data-id="' + cssEscape(hadithId) + '"][data-prop="hadith.body_en"]');
				if (body) {
					body.dataset.markdownSource = data.body_en || '';
					body.innerHTML = data.body_en_html || '';
				}
				document.querySelectorAll('.cmd-tr[data-hadith-id="' + cssEscape(hadithId) + '"]').forEach(function (el) {
					el.remove();
				});
				if (window.toastr)
					toastr.success(data.message || 'Translation complete');
			} catch (err) {
				button.disabled = false;
				button.innerHTML = originalHtml;
				if (window.toastr)
					toastr.error(err.message || 'Translation failed');
				else if (placeholder)
					placeholder.appendChild(document.createTextNode(' Translation failed.'));
			}
		});
	});
}

function initHadithSharhLinks(root) {
	var scope = root || document;
	scope.querySelectorAll('.hadith-sharh-link').forEach(function (link) {
		if (link.dataset.hadithSharhBound === 'true')
			return;
		link.dataset.hadithSharhBound = 'true';
		updateHadithSharhLink(link);
		link.addEventListener('click', function (event) {
			updateHadithSharhLink(link);
			if (!link.href || link.getAttribute('href') === '#')
				event.preventDefault();
		});
	});
}

function updateHadithSharhLink(link) {
	var body = link.dataset.hadithSharhBody || '';
	var query = firstHadithSharhWords(body, 25);
	if (!query) {
		link.setAttribute('href', '#');
		return;
	}
	link.href = `https://www.google.com/search?q=site%3Adorar.net%2Fhadith%2Fsharh+${encodeURIComponent(query)}`;
}

function firstHadithSharhWords(text, count) {
	return (text || '').toString()
		.replace(/<[^>]+>/g, ' ')
		.replace(/[ًٌٍَُِّْٰـ]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.slice(0, count)
		.join(' ');
}

function initHadithShareModals(root) {
	var scope = root || document;
	scope.querySelectorAll('.hadith-share-modal').forEach(function (modal) {
		if (modal.dataset.shareModalBound === 'true')
			return;
		modal.dataset.shareModalBound = 'true';

		var modalRoot = modal.closest('.modal') || modal;
		var card = modal.querySelector('[data-share-card]');
		var editButton = modal.querySelector('.hadith-share-edit');
		var arabicSwitch = modal.querySelector('.hadith-share-arabic');
		var languageToggle = arabicSwitch ? (arabicSwitch.dataset.shareLanguageToggle || 'arabic') : 'arabic';
		var sizeControls = modal.querySelectorAll('.hadith-share-size');
		var copyButton = modal.querySelector('.hadith-share-copy');
		var shareButton = modal.querySelector('.hadith-share-native');
		var resizeTimer = null;
		var handleViewportChange = function () {
			if (!modalRoot.classList.contains('show'))
				return;
			if (resizeTimer)
				window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(function () {
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			}, 80);
		};

		modalRoot.addEventListener('show.bs.modal', function () {
			if (arabicSwitch)
				arabicSwitch.checked = arabicSwitch.defaultChecked;
			updateHadithShareArabicState(modal, card, arabicSwitch, languageToggle);
			updateHadithShareSizeState(card, sizeControls);
		});

		modalRoot.addEventListener('shown.bs.modal', function () {
			window.addEventListener('resize', handleViewportChange);
			if (window.visualViewport)
				window.visualViewport.addEventListener('resize', handleViewportChange);
			updateHadithShareArabicState(modal, card, arabicSwitch, languageToggle);
			updateHadithShareSizeState(card, sizeControls);
			scheduleHadithShareCardFit(card);
			scheduleHadithShareRender(card);
		});

		modalRoot.addEventListener('hidden.bs.modal', function () {
			if (resizeTimer) {
				window.clearTimeout(resizeTimer);
				resizeTimer = null;
			}
			window.removeEventListener('resize', handleViewportChange);
			if (window.visualViewport)
				window.visualViewport.removeEventListener('resize', handleViewportChange);
			invalidateHadithShareRender(card);
		});

		if (editButton) {
			editButton.addEventListener('click', function () {
				var editing = editButton.getAttribute('aria-pressed') !== 'true';
				editButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
				editButton.classList.toggle('active', editing);
				editButton.title = editing ? 'Done editing' : 'Edit text';
				editButton.setAttribute('aria-label', editing ? 'Done editing' : 'Edit text');
				editButton.innerHTML = editing ? '<span class="bi bi-check2"></span>' : '<span class="bi bi-pencil"></span>';
				modal.querySelectorAll('.share-editable').forEach(function (el) {
					el.setAttribute('contenteditable', editing ? 'true' : 'false');
				});
				scheduleHadithShareCardFit(card);
				invalidateHadithShareRender(card);
			});
		}

		if (arabicSwitch) {
			arabicSwitch.addEventListener('change', function () {
				updateHadithShareArabicState(modal, card, arabicSwitch, languageToggle);
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			});
		}

		sizeControls.forEach(function (control) {
			control.addEventListener('input', function () {
				updateHadithShareSizeState(card, sizeControls);
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			});
		});

		modal.querySelectorAll('.share-editable').forEach(function (el) {
			el.addEventListener('input', function () {
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			});
		});

		if (copyButton) {
			copyButton.addEventListener('click', function () {
				exportHadithShareCard(card, 'copy', copyButton);
			});
		}

		if (shareButton) {
			card._shareButton = shareButton;
			shareButton.addEventListener('click', function () {
				exportHadithShareCard(card, 'share', shareButton);
			});
		}
	});
}

function scheduleHadithShareCardFit(card) {
	if (!card)
		return;
	fitHadithShareCard(card);
	window.requestAnimationFrame(function () {
		fitHadithShareCard(card);
		window.requestAnimationFrame(function () {
			fitHadithShareCard(card);
		});
	});
	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(function () {
			fitHadithShareCard(card);
			scheduleHadithShareRender(card);
		}).catch(function () {});
	}
}

function invalidateHadithShareRender(card) {
	if (!card)
		return;
	window.clearTimeout(card._shareRenderTimer);
	card._shareBlob = null;
	card._shareFile = null;
	card._shareRendering = false;
	card._shareRenderPromise = null;
	if (card._shareButton)
		card._shareButton.disabled = false;
}

function scheduleHadithShareRender(card) {
	if (!card || !window.html2canvas)
		return;
	window.clearTimeout(card._shareRenderTimer);
	card._shareRenderTimer = window.setTimeout(function () {
		renderHadithShareImage(card).catch(function (err) {
			console.warn('Unable to prepare share image', err);
		});
	}, 150);
}

async function renderHadithShareImage(card) {
	if (!card || !window.html2canvas)
		return null;
	if (card._shareRenderPromise)
		return card._shareRenderPromise;
	card._shareRendering = true;
	card._shareRenderPromise = (async function () {
		try {
			fitHadithShareCard(card);
			card.classList.add('is-exporting');
			var cardWidth = card.getBoundingClientRect().width || 540;
			var canvas = await window.html2canvas(card, {
				backgroundColor: null,
				scale: 1080 / cardWidth,
				useCORS: true
			});
			var blob = await canvasToBlob(canvas);
			var filename = getHadithShareFilename(card.dataset.shareRef);
			card._shareBlob = blob;
			card._shareFile = window.File ? new File([blob], filename, { type: 'image/png' }) : null;
			return blob;
		} finally {
			card.classList.remove('is-exporting');
			card._shareRendering = false;
			card._shareRenderPromise = null;
		}
	})();
	return card._shareRenderPromise;
}

function updateHadithShareArabicState(modal, card, arabicSwitch, languageToggle) {
	if (!modal || !card || !arabicSwitch)
		return;
	if (languageToggle === 'english') {
		var showEnglish = arabicSwitch.checked;
		modal.querySelectorAll('.quran-share-english-section').forEach(function (el) {
			el.classList.toggle('d-none', !showEnglish);
		});
		card.classList.toggle('quran-share-arabic-only', !showEnglish);
		return;
	}
	var showArabic = arabicSwitch.checked;
	modal.querySelectorAll('.hadith-share-arabic-section').forEach(function (el) {
		el.classList.toggle('d-none', !showArabic);
	});
	card.classList.toggle('hadith-share-english-only', !showArabic);
}

function updateHadithShareSizeState(card, controls) {
	if (!card)
		return;
	controls.forEach(function (control) {
		var prop = control.dataset.shareSizeVar;
		if (!prop)
			return;
		var value = Number(control.value);
		if (!Number.isFinite(value) || value <= 0)
			value = 100;
		card.style.setProperty(prop, (value / 100).toFixed(2));
	});
}

function fitHadithShareCard(card) {
	if (!card)
		return;
	var inner = card.querySelector('.hadith-share-card-inner');
	if (!inner)
		return;

	card.style.setProperty('--share-scale', '1');
	card.classList.remove('hadith-share-dense');
	var scale = 1;
	var isMobileShare = window.matchMedia && window.matchMedia('(max-width: 575.98px)').matches;
	var minScale = card.classList.contains('hadith-share-english-only') ? 0.38 : 0.32;
	if (isMobileShare)
		minScale = card.classList.contains('hadith-share-english-only') ? 0.42 : 0.34;
	while (scale > minScale && hadithShareCardOverflows(inner)) {
		scale -= 0.03;
		card.style.setProperty('--share-scale', scale.toFixed(2));
	}
	card.classList.toggle('hadith-share-dense', scale < 0.86);
}

function hadithShareCardOverflows(inner) {
	if (!inner)
		return false;
	return inner.scrollHeight > inner.clientHeight + 8;
}

async function exportHadithShareCard(card, mode, button) {
	if (!card)
		return;
	if (mode === 'share' && card._shareFile && navigator.share && navigator.canShare && navigator.canShare({ files: [card._shareFile] })) {
		try {
			await navigator.share({
				files: [card._shareFile],
				title: card.dataset.shareRef || 'Hadith share image'
			});
		} catch (err) {
			if (err && err.name === 'AbortError')
				return;
			if (card._shareBlob) {
				downloadBlob(card._shareBlob, card._shareFile.name);
				if (window.toastr)
					toastr.info('Image sharing is unavailable in this browser. Downloaded PNG instead.');
				return;
			}
			throw err;
		}
		return;
	}
	if (mode === 'share' && navigator.share && navigator.canShare && window.File && !card._shareFile) {
		scheduleHadithShareRender(card);
		if (window.toastr)
			toastr.info('Preparing the image. Tap share again in a moment.');
		return;
	}
	if (!window.html2canvas) {
		if (window.toastr)
			toastr.error('Image renderer is still loading. Try again in a moment.');
		return;
	}

	var originalHtml = button ? button.innerHTML : '';
	var originalDisabled = button ? button.disabled : false;
	if (button) {
		button.disabled = true;
		button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>';
	}

	try {
		if (document.activeElement && typeof document.activeElement.blur === 'function')
			document.activeElement.blur();
		var blob = await renderHadithShareImage(card);
		var filename = getHadithShareFilename(card.dataset.shareRef);
		if (mode === 'copy' && navigator.clipboard && window.ClipboardItem) {
			await navigator.clipboard.write([
				new ClipboardItem({
					'image/png': blob
				})
			]);
			if (window.toastr)
				toastr.success('Image copied to clipboard');
			return;
		}
		if (mode === 'share') {
			var file = window.File ? new File([blob], filename, { type: 'image/png' }) : null;
			if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
				await navigator.share({
					files: [file],
					title: card.dataset.shareRef || 'Hadith share image'
				});
				return;
			}
			downloadBlob(blob, filename);
			if (window.toastr)
				toastr.info('Image sharing is unavailable in this browser. Downloaded PNG instead.');
			return;
		}
		downloadBlob(blob, filename);
		if (mode === 'copy' && window.toastr)
			toastr.info('Clipboard image copy is unavailable in this browser. Downloaded PNG instead.');
	} catch (err) {
		if (err && err.name === 'AbortError')
			return;
		if (mode === 'share' && err && (err.name === 'NotAllowedError' || /not allowed|permission/i.test(err.message || ''))) {
			if (window.toastr)
				toastr.info('Image sharing was blocked by the browser. Try the copy button or tap Share again after the image finishes preparing.');
			return;
		}
		if (window.toastr)
			toastr.error(err.message || 'Unable to create image');
	} finally {
		card.classList.remove('is-exporting');
		if (button) {
			button.disabled = originalDisabled;
			button.innerHTML = originalHtml;
		}
	}
}

function canvasToBlob(canvas) {
	return new Promise(function (resolve, reject) {
		canvas.toBlob(function (blob) {
			if (!blob) {
				reject(new Error('Unable to render image.'));
				return;
			}
			resolve(blob);
		}, 'image/png');
	});
}

function getHadithShareFilename(ref) {
	var filename = (ref || 'hadith-share').replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '') || 'hadith-share';
	return filename + '.png';
}

function downloadBlob(blob, filename) {
	var link = document.createElement('a');
	link.download = filename;
	link.href = URL.createObjectURL(blob);
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(link.href);
}

async function getTranslateCaptcha() {
	var res = await fetch(quranApiPath('/captcha/translate'), {
		method: 'GET',
		headers: {
			'Accept': 'application/json'
		}
	});
	var data = await res.json();
	if (!res.ok)
		throw new Error(data.message || res.statusText || 'Unable to load CAPTCHA');
	var answer = window.prompt(data.question || 'Complete the CAPTCHA');
	if (answer === null)
		return null;
	var captcha = {
		captchaToken: data.token,
		captchaAnswer: answer
	};
	var verifyRes = await fetch(quranApiPath('/captcha/translate/verify'), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		},
		body: JSON.stringify(captcha)
	});
	var verifyData = await verifyRes.json();
	if (!verifyRes.ok || !verifyData.verified) {
		if (window.toastr)
			toastr.error(verifyData.message || 'Incorrect CAPTCHA answer.');
		return null;
	}
	return captcha;
}

function cssEscape(value) {
	if (window.CSS && window.CSS.escape)
		return window.CSS.escape(value);
	return value.toString().replace(/["\\]/g, '\\$&');
}
