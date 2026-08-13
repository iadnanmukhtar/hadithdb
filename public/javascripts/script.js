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
	initDropdownFilterSearch(document);
	initReadOnlyInlineEditorGuards(document);
	initSearchPlainTextPaste();
	initQuranSearchReturnMode();

	setDirection($('#search-bar'));

	$(window).scroll(function() {
		$('.site-navbar').toggleClass('shrink', $(document).scrollTop() > 50);
		updateFixedHeaderOffset();
	});

	$('.site-navbar').toggleClass('shrink', $(document).scrollTop() > 50);
	updateFixedHeaderOffset();
	$(window).on('resize', updateFixedHeaderOffset);

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
	initTafsirSearchFilterPills(document);
	initHomeQuranAnnouncement(document);
	initRandomTocItemLoader(document);
	initQuranPassageNavigator();
	initBookNavScroller();
	initBookCarouselFilters(document);
	initTafsirBookCarousels(document);
	initQuranCommentaryTocNavigation(document);
	initContentFontSizeControls(document);

	$('#toc2').on('show.bs.collapse', function(event) {
		updateFixedHeaderOffset(event.target.scrollHeight);
	});
	$('#toc2').on('hidden.bs.collapse', function (event) {
		$('.toggle').removeClass('bi-toggle-on');
		$('.toggle').addClass('bi-toggle-off');
		updateFixedHeaderOffset();
	});
	$('#toc2').on('shown.bs.collapse', function(event) {
		$('.toggle').removeClass('bi-toggle-off');
		$('.toggle').addClass('bi-toggle-on');
		updateFixedHeaderOffset();
		scrollQuranMushafJuzMenuToCurrent();
	});

	initMarkdownEditablePreviews(document);
	initHadithSharhLinks(document);
	initHadithShareModals(document);
	initGlobalContentLanguageSelect(document);
	initHadithContentTranslationControls(document);
	initLegacyHadithTranslationLink();
	resumePendingContentTranslationCheckout();
	initQuranAyahHoverPairs(document);
	initQuranAyahSelector(document);
	initStickyFooterScrollFade(document);
	initBlogInfiniteScroll(document);
	initQuranInfinitePassageNavigation(document);
	initReaderInfiniteNavigation(document);
	initQuranMushafLastPageLinks(document);
	initQuranMushafInfinite(document);
	initQuranMushafLineFitting(document);
	initQuranMemorizeView(document);
	initQuranAyahReview(document);
	initQuranMushafAyahSelection(document);
	initQuranMushafAyahMarkerActions(document);
	initQuranAyahMemorization(document);
	initQuranMemorizeReviewLauncher(document);
	initPageHelpTips(document);
	initQuranSelectionTranslationMarquee(document);
	initQuranMushafSurahPicker(document);
	initQuranMenuRows(document);
	initQuranDynamicPassageHero(document);
	canonicalizeQuranTranslationPageUrl();
	initQuranSelectedTranslationBookPreference(document);
	initQuranPreferredTranslationDisplays(document);
	initQuranPassageTranslationSelects(document);
	initQuranPassageDisplayToggles(document);
	initQuranPassageAudioControls(document);
	initQuranHeroAudioActions(document);
	initQuranTranslations(document);
	initQuranAyahModals(document);
	initQuranPageKeyboardNavigation(document);
	initQuranPassageShareLinks(document);
	initQuranScriptSwitchers(document);
	initQuranScriptPreference(document).then(function () {
		initQuranCorpusTooltips(document);
	}).catch(function () {
		initQuranCorpusTooltips(document);
	});
	initQuranScriptMutationObserver();
	initQuranCorpusTooltipDelay(document);
	initQuranTafsirTabs(document);
	initQuranTafsirFootnotePopups(document);
	initTocExpandCollapse(document);
	initTocContentFilters(document);
	initTocInlineDescriptionExpanders(document);

});

function initBlogInfiniteScroll(root) {
	var scope = root || document;
	$(scope).find('[data-blog-infinite]').addBack('[data-blog-infinite]').each(function () {
		var main = $(this);
		if (main.data('blogInfiniteBound'))
			return;
		main.data('blogInfiniteBound', true);

		var status = main.siblings('[data-blog-infinite-status]').first();
		var sentinel = main.siblings('[data-blog-infinite-sentinel]').first();
		var nextUrl = main.attr('data-blog-next-url') || '';
		var loadingPromise = null;
		var loadedUrls = new Set();
		var currentUrl = main.attr('data-blog-current-url') || `${window.location.pathname}${window.location.search}`;
		loadedUrls.add(normalizeReaderInfiniteUrl(currentUrl));

		var renderMobilePaginationLink = function (direction, href) {
			var attribute = direction === 'prev' ? 'data-mobile-bottom-nav-prev' : 'data-mobile-bottom-nav-next';
			var current = document.querySelector(`[${attribute}]`);
			if (!current)
				return;
			var replacement = document.createElement(href ? 'a' : 'span');
			replacement.className = `mobile-bottom-nav-item${href ? '' : ' mobile-bottom-nav-item-disabled'}`;
			replacement.innerHTML = current.innerHTML;
			replacement.setAttribute(attribute, '');
			if (href) {
				replacement.setAttribute('href', href);
				replacement.setAttribute('rel', direction);
				replacement.setAttribute('title', direction === 'prev' ? 'Previous' : 'Next');
				replacement.setAttribute('aria-label', direction === 'prev' ? 'Previous' : 'Next');
			} else {
				replacement.setAttribute('aria-disabled', 'true');
			}
			current.replaceWith(replacement);
		};

		var appendBlogPage = function (html, targetUrl) {
			var parsed = new DOMParser().parseFromString(html, 'text/html');
			var remoteMain = parsed.querySelector('[data-blog-infinite]');
			if (!remoteMain)
				throw new Error('Next blog page was not found.');

			var remoteUrl = remoteMain.getAttribute('data-blog-current-url') || targetUrl;
			var pageNumber = remoteMain.getAttribute('data-blog-page-number') || '';
			var chunk = $('<section class="blog-infinite-page" data-blog-infinite-page="1"></section>').attr({
				'data-blog-url': remoteUrl,
				'data-blog-page-number': pageNumber,
				'aria-label': pageNumber ? `Blog page ${pageNumber}` : 'More blog posts'
			});
			Array.from(remoteMain.children).forEach(function (node) {
				chunk[0].appendChild(document.importNode(node, true));
			});
			if (!chunk.children().length)
				throw new Error('Next blog page did not include any posts.');
			chunk.appendTo(main);

			var prevUrl = remoteMain.getAttribute('data-blog-prev-url') || '';
			nextUrl = remoteMain.getAttribute('data-blog-next-url') || '';
			if (nextUrl)
				main.attr('data-blog-next-url', nextUrl);
			else
				main.removeAttr('data-blog-next-url');
			renderMobilePaginationLink('prev', prevUrl);
			renderMobilePaginationLink('next', nextUrl);
			return chunk[0];
		};

		var loadNext = function () {
			if (loadingPromise)
				return loadingPromise;
			if (!nextUrl)
				return Promise.resolve(false);
			var targetUrl = nextUrl;
			var normalized = normalizeReaderInfiniteUrl(targetUrl);
			if (!normalized || loadedUrls.has(normalized)) {
				nextUrl = '';
				return Promise.resolve(false);
			}
			status.removeAttr('data-infinite-load-error').text('Loading more blog posts...');
			loadingPromise = fetch(`/api${targetUrl}`, {
				credentials: 'same-origin',
				headers: { 'Accept': 'text/html' }
			}).then(function (response) {
				if (!response.ok)
					throw new Error('Unable to load more blog posts.');
				return response.text();
			}).then(function (html) {
				appendBlogPage(html, targetUrl);
				loadedUrls.add(normalized);
				status.text('');
				return true;
			}).catch(function (err) {
				showInfiniteLoadFailure(status, err && err.message ? err.message : 'Unable to load more blog posts.', targetUrl, 'Open next blog page');
				return false;
			}).finally(function () {
				loadingPromise = null;
			});
			return loadingPromise;
		};

		main[0].blogInfiniteLoadNext = loadNext;
		if ('IntersectionObserver' in window && sentinel.length) {
			var observer = new IntersectionObserver(function (entries) {
				if (entries.some(function (entry) { return entry.isIntersecting; }))
					loadNext();
			}, { rootMargin: '1200px 0px' });
			observer.observe(sentinel[0]);
		}
	});
}

function initStickyFooterScrollFade(root) {
	var scope = root || document;
	if (!$(scope).find('.mobile-bottom-nav').addBack('.mobile-bottom-nav').length)
		return;
	if ($(document).data('stickyFooterScrollFadeBound'))
		return;
	$(document).data('stickyFooterScrollFadeBound', true);
	var scrollTimer = null;
	var clearFooterFade = function () {
		document.body.classList.remove('sticky-footer-scroll-faded');
	};
	var fadeFooter = function () {
		if (document.querySelector('[data-quran-review-reader]')) {
			clearFooterFade();
			return;
		}
		document.body.classList.add('sticky-footer-scroll-faded');
		window.clearTimeout(scrollTimer);
		scrollTimer = window.setTimeout(clearFooterFade, 300);
	};
	window.addEventListener('scroll', fadeFooter, { passive: true });
	window.addEventListener('scrollend', function () {
		window.clearTimeout(scrollTimer);
		clearFooterFade();
	}, { passive: true });
}

function updateFixedHeaderOffset(extraHeight) {
	var navbar = document.querySelector('.site-navbar.fixed-top');
	if (!navbar)
		return;
	var additionalHeight = Number.isFinite(extraHeight) ? extraHeight : 0;
	var height = navbar.getBoundingClientRect().height + additionalHeight;
	document.documentElement.style.setProperty('--site-fixed-header-height', `${Math.ceil(height)}px`);
}

function initContentFontSizeControls(scope) {
	var storageKey = 'hadithdb_content_font_size';
	var step = 0.05;
	var min = 0.85;
	var max = 1.25;
	var root = scope || document;
	var controls = Array.from(root.querySelectorAll('[data-content-font-size-decrease], [data-content-font-size-reset], [data-content-font-size-increase]'));

	function normalizedScale(value) {
		var scale = parseFloat(value);
		if (!Number.isFinite(scale))
			return null;
		return Math.min(max, Math.max(min, Math.round(scale * 100) / 100));
	}

	function applyScale(scale) {
		var normalized = normalizedScale(scale);
		if (normalized === null)
			return;
		document.documentElement.style.setProperty('--content-font-scale', normalized.toString());
		controls.forEach(function (control) {
			var isDecrease = control.hasAttribute('data-content-font-size-decrease');
			var isIncrease = control.hasAttribute('data-content-font-size-increase');
			var isReset = control.hasAttribute('data-content-font-size-reset');
			control.disabled = isDecrease ? normalized <= min : (isIncrease ? normalized >= max : isReset && normalized === 1);
			control.setAttribute('aria-valuenow', Math.round(normalized * 100).toString());
		});
	}

	function storedScale() {
		try {
			if (!window.localStorage)
				return null;
			return normalizedScale(localStorage.getItem(storageKey));
		} catch (err) {
			return null;
		}
	}

	function currentScale() {
		var stored = storedScale();
		if (stored !== null)
			return stored;
		return 1;
	}

	function saveScale(scale) {
		var normalized = normalizedScale(scale);
		if (normalized === null)
			return;
		try {
			if (window.localStorage)
				localStorage.setItem(storageKey, normalized.toFixed(2));
		} catch (err) {}
		applyScale(normalized);
	}

	function resetScale() {
		try {
			if (window.localStorage)
				localStorage.removeItem(storageKey);
		} catch (err) {}
		applyScale(1);
	}

	applyScale(currentScale());

	controls.forEach(function (control) {
		if (control.dataset.contentFontSizeBound === 'true')
			return;
		control.dataset.contentFontSizeBound = 'true';
		control.addEventListener('click', function () {
		if (control.hasAttribute('data-mobile-audio-prev') || control.hasAttribute('data-mobile-audio-play')
			|| control.hasAttribute('data-mobile-audio-repeat') || control.hasAttribute('data-mobile-audio-pause')
			|| control.hasAttribute('data-mobile-audio-stop') || control.hasAttribute('data-mobile-audio-speed')
			|| control.hasAttribute('data-mobile-audio-next'))
				return;
			if (control.hasAttribute('data-content-font-size-reset')) {
				resetScale();
				return;
			}
			var delta = control.hasAttribute('data-content-font-size-decrease') ? -step : step;
			saveScale(currentScale() + delta);
		});
	});
}

function initHomeQuranAnnouncement(scope) {
	var storageKey = 'hadithdb_home_quran_announcement_closed';
	var legacyStorageKey = 'hadithHomeQuranAnnouncementClosed';
	var announcement = (scope || document).querySelector('[data-home-quran-announcement]');
	if (!announcement)
		return;

	try {
		if (window.localStorage && (localStorage.getItem(storageKey) === 'true' || localStorage.getItem(legacyStorageKey) === 'true')) {
			if (localStorage.getItem(storageKey) !== 'true') {
				localStorage.setItem(storageKey, 'true');
				localStorage.removeItem(legacyStorageKey);
			}
			announcement.remove();
			return;
		}
	} catch (err) {
		// Storage can be unavailable in private or restricted browsing contexts.
	}

	var closeButton = announcement.querySelector('[data-home-quran-announcement-close]');
	if (!closeButton)
		return;

	closeButton.addEventListener('click', function () {
		try {
			if (window.localStorage) {
				localStorage.setItem(storageKey, 'true');
				localStorage.removeItem(legacyStorageKey);
			}
		} catch (err) {}
		announcement.remove();
	});
}

function initRandomTocItemLoader(scope) {
	var root = scope || document;
	root.querySelectorAll('[data-random-toc-item]').forEach(function (container) {
		if (container.dataset.randomTocItemBound === 'true')
			return;
		container.dataset.randomTocItemBound = 'true';
		var source = container.dataset.src || '/quran/random';

		var load = async function () {
			if (container.dataset.loading === 'true')
				return;
			container.dataset.loading = 'true';
			try {
				var url = new URL(quranApiPath(source), window.location.origin);
				url.searchParams.set('_', Date.now().toString());
				var response = await fetch(url.toString(), {
					cache: 'no-store',
					credentials: 'same-origin',
					headers: {
						'Accept': 'text/html'
					}
				});
				if (!response.ok)
					throw new Error('Unable to load random item');
				container.innerHTML = await response.text();
				executeInlineScripts(container);
				initHadithSharhLinks(container);
				initHadithShareModals(container);
				initHadithContentTranslationControls(container);
				initQuranAyahHoverPairs(container);
				initQuranPreferredTranslationDisplays(container);
				initQuranScriptPreference(container).then(function () {
					initQuranCorpusTooltips(container);
				}).catch(function () {
					initQuranCorpusTooltips(container);
				});
				initQuranAyahModals(container);
				initQuranPassageShareLinks(container);
				if (window.refreshHadithActions)
					window.refreshHadithActions();
			} catch (err) {
				container.remove();
			} finally {
				container.dataset.loading = 'false';
			}
		};

		container.addEventListener('click', function (event) {
			var refresh = event.target.closest('[data-random-toc-refresh], [data-random-quran-ayah-refresh]');
			if (!refresh || !container.contains(refresh))
				return;
			event.preventDefault();
			load();
		});

		load();
	});
}

function executeInlineScripts(container) {
	Array.from(container.querySelectorAll('script')).forEach(function (script) {
		if (script.src)
			return;
		var replacement = document.createElement('script');
		Array.from(script.attributes).forEach(function (attr) {
			replacement.setAttribute(attr.name, attr.value);
		});
		replacement.text = script.textContent || '';
		script.replaceWith(replacement);
	});
}

function getHadithCookie(name) {
	const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
	return match ? decodeURIComponent(match[1]) : '';
}

window.HADITH_SESSION_MAX_AGE = window.HADITH_SESSION_MAX_AGE || 60 * 60 * 24 * 30;

function setHadithCookie(name, value, maxAge) {
	var domain = window.HADITH_COOKIE_DOMAIN ? `;domain=${window.HADITH_COOKIE_DOMAIN}` : '';
	var age = Number.isFinite(maxAge) ? `;max-age=${maxAge}` : '';
	document.cookie = `${name}=${encodeURIComponent(value)};path=/${age};samesite=lax${domain}`;
}

function clearHadithCookie(name) {
	document.cookie = `${name}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
	if (window.HADITH_COOKIE_DOMAIN)
		document.cookie = `${name}=;path=/;domain=${window.HADITH_COOKIE_DOMAIN};expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function normalizeHadithSessionUser(user) {
	if (!user || typeof user !== 'object') return null;
	var uid = (user.uid || user.userId || user.email || '').toString();
	if (!uid) return null;
	return {
		uid: uid,
		provider: user.provider || 'google.com',
		name: user.name || user.displayName || user.email || 'User',
		email: user.email || null,
		photo: user.photo || user.photoURL || null,
		admin: Boolean(user.admin)
	};
}

function decodeHadithJwtPayload(token) {
	try {
		var parts = String(token || '').split('.');
		if (parts.length < 2) return null;
		var normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		normalized += '='.repeat((4 - normalized.length % 4) % 4);
		var json = decodeURIComponent(atob(normalized).split('').map(function (c) {
			return `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`;
		}).join(''));
		return JSON.parse(json);
	} catch (err) {
		return null;
	}
}

function isHadithLoginSessionCacheExpired(payload) {
	var token = payload && payload.token;
	var tokenPayload = decodeHadithJwtPayload(token);
	if (!token || !tokenPayload || !Number.isFinite(tokenPayload.exp))
		return true;
	if (tokenPayload.exp * 1000 <= Date.now())
		return true;
	var cachedAt = Number(payload.cachedAt || 0);
	return !Number.isFinite(cachedAt) || cachedAt <= 0 || Date.now() - cachedAt > window.HADITH_SESSION_MAX_AGE * 1000;
}

function readHadithLoginSessionCache() {
	try {
		var raw = localStorage.getItem('hadithdb_login_session');
		if (!raw) return null;
		var payload = JSON.parse(raw);
		if (!payload || (payload.__hadithdbLoginSessionCache !== 1 && payload.__hadithLoginSessionCache !== 1))
			throw new Error('Unexpected login session cache payload');
		var user = normalizeHadithSessionUser(payload.user);
		if (!payload.loggedIn || !user)
			throw new Error('Missing login session user');
		if (isHadithLoginSessionCacheExpired(payload))
			throw new Error('Expired login session cache');
		return {
			status: 200,
			loggedIn: true,
			token: payload.token || null,
			userId: user.uid,
			admin: Boolean(user.admin),
			user: user,
			cached: true
		};
	} catch (err) {
		try { localStorage.removeItem('hadithdb_login_session'); } catch (_err) {}
		return null;
	}
}

function writeHadithLoginSessionCache(session) {
	var user = normalizeHadithSessionUser(session && (session.user || session));
	if (!user) return;
	try {
		localStorage.setItem('hadithdb_login_session', JSON.stringify({
			__hadithdbLoginSessionCache: 1,
			cachedAt: Date.now(),
			loggedIn: true,
			token: session.token || null,
			user: user
		}));
	} catch (err) {
		console.warn('Could not cache login session', err);
	}
}

function clearHadithLoginSessionCache() {
	try {
		localStorage.removeItem('hadithdb_login_session');
	} catch (err) {
		console.warn('Could not clear login session cache', err);
	}
	clearHadithCookie('admin');
	clearHadithCookie('adminUser');
	clearHadithCookie('adminChecked');
	clearHadithCookie('userId');
	clearHadithCookie('editMode');
	clearHadithCookie('quranMushafBookmarkPage');
}

function getHadithEditMode() {
	try {
		return localStorage.getItem('hadithdb_edit_mode') === '1';
	} catch (err) {
		return false;
	}
}

function shouldFlushQuranProxyCache() {
	var requestFlush = false;
	try {
		requestFlush = new URLSearchParams(window.location.search).has('flush');
	} catch (err) {
		requestFlush = /(?:^|[?&])flush(?:=|&|$)/.test(window.location.search || '');
	}
	return requestFlush || (window.hadithAdmin === true && (window.hadithEditMode === true || getHadithCookie('editMode') === '1'));
}

function setHadithEditMode(enabled) {
	try {
		localStorage.setItem('hadithdb_edit_mode', enabled ? '1' : '0');
	} catch (err) {
		// Ignore private-mode or blocked storage failures.
	}
	if (enabled)
		setHadithCookie('editMode', '1', window.HADITH_SESSION_MAX_AGE);
	else
		clearHadithCookie('editMode');
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
	setHadithEditMode(enabled);
	location.reload();
}
window.setHadithAdminMode = setHadithAdminMode;

function renderHadithAdminGear() {
	if (window.hadithAdmin !== true) {
		if (window.hadithAdminSessionChecked) {
			document.querySelectorAll('.edit-gear').forEach(function (el) { el.remove(); });
			setHadithEditMode(false);
		}
		return;
	}

	$('.edit-gear').show();

	const editMode = getHadithEditMode();
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
		item.innerHTML = `<a class="nav-link" role="button"><i class="app-menu-icon bi ${icon}" aria-hidden="true"></i> <strong>${editMode ? 'View' : 'Edit'}</strong></a>`;
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

async function getHadithAuthToken(message) {
	var auth = await waitForHadithAuth();
	if (!auth)
		return null;
	if (auth.requireToken)
		return auth.requireToken(message);
	return auth.getToken ? auth.getToken() : null;
}

function syncHadithAdminForCachedPage() {
	var cachedSession = readHadithLoginSessionCache();
	if (!cachedSession) {
		window.hadithAdminSessionChecked = true;
		renderHadithAdminGear();
		return;
	}
	window.hadithAdmin = Boolean(cachedSession.admin);
	window.hadithAdminSessionChecked = true;
	renderHadithAdminGear();
}

function initHadithAdminGear() {
	window.hadithAdmin = window.hadithAdmin === true;
	window.hadithAdminSessionChecked = window.hadithAdmin === true;
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

function normalizeTocFilterText(value) {
	return (value || '')
		.toString()
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function initTocContentFilters(root) {
	var scope = root || document;
	$(scope).find('[data-toc-content-filter]').each(function () {
		var input = $(this);
		if (input.data('tocContentFilterBound'))
			return;
		input.data('tocContentFilterBound', true);

		var table = $(input.attr('data-toc-content-filter'));
		if (!table.length)
			return;

		var update = function () {
			var query = normalizeTocFilterText(input.val());
			var filtering = query.length > 0;
			table.toggleClass('toc-filtering', filtering);

			table.find('[data-toc-chapter]').each(function () {
				var chapter = $(this);
				var chapterId = chapter.attr('data-toc-chapter');
				var sections = table.find('[data-toc-parent="' + chapterId + '"]');
				var chapterMatches = normalizeTocFilterText(chapter.text()).indexOf(query) !== -1;
				var matchingSections = sections.filter(function () {
					return normalizeTocFilterText($(this).text()).indexOf(query) !== -1;
				});
				var showChapter = !filtering || chapterMatches || matchingSections.length > 0;

				chapter.prop('hidden', !showChapter);
				sections.each(function () {
					var section = $(this);
					if (!filtering) {
						section.prop('hidden', false);
						section.toggleClass('d-none', table.find('[data-toc-toggle="' + chapterId + '"]').attr('aria-expanded') !== 'true');
						return;
					}
					var showSection = chapterMatches || matchingSections.filter(this).length > 0;
					section.prop('hidden', !showSection);
					section.toggleClass('d-none', !showSection);
				});
			});
		};

		input.on('input', update);
		if (input.is('[autofocus]'))
			input.get(0).focus({ preventScroll: true });
		update();
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
		return (window.HADITH_QURAN_BASE_URL || '') + quranPath(path);
	if (isQuranSubdomainHost(window.location.hostname))
		return quranPath(path);
	return path;
}

function hadithUrl(path) {
	path = (path || '').toString();
	if (/^https?:\/\//i.test(path))
		return path;
	if (!isLocalhostHost(window.location.hostname) && isQuranSubdomainHost(window.location.hostname)) {
		if (path.charAt(0) !== '/')
			path = '/' + path;
		return (window.HADITH_BASE_URL || '') + path;
	}
	return path;
}

function quranApiPath(path) {
	path = (path || '').toString();
	if (/^https?:\/\//i.test(path))
		return path;
	if (path.charAt(0) !== '/')
		path = '/' + path;
	var explicitlyQuran = path === '/quran' || path.indexOf('/quran/') === 0;
	if (path === '/quran')
		path = '/';
	else if (path.indexOf('/quran/') === 0)
		path = path.substring('/quran'.length);
	var pathname = window.location.pathname || '';
	var isQuran = explicitlyQuran || isQuranSubdomainHost(window.location.hostname) || pathname === '/quran' || pathname.indexOf('/quran/') === 0;
	return (isQuran ? '/quran/api' : '/api') + path;
}

function setDirection(el) {
	if (el.length) {
		if (el.val().match(/^[\u0600-\u06ff]+/))
			el.css({ 'direction': 'rtl' });
		else
			el.css({ 'direction': 'ltr' });
	}
}

function initReadOnlyInlineEditorGuards(root) {
	var scope = root || document;
	$(scope).find('._e[contenteditable="true"], [data-prop][contenteditable="true"]').addBack('._e[contenteditable="true"], [data-prop][contenteditable="true"]').each(function () {
		this.setAttribute('contenteditable', 'false');
	});
}

function initSearchPlainTextPaste() {
	$(document).on('paste', 'input[role=search][name=q], .quran-passage-search', function (event) {
		var originalEvent = event.originalEvent || event;
		var clipboard = originalEvent.clipboardData || window.clipboardData;
		if (!clipboard || typeof clipboard.getData !== 'function')
			return;
		var text = clipboard.getData('text/plain');
		if (typeof text !== 'string')
			return;
		event.preventDefault();
		this.value = text.trim();
		if (typeof this.setSelectionRange === 'function') {
			var end = this.value.length;
			this.setSelectionRange(end, end);
		}
		$(this).trigger('input');
	});
}

var quranTafsirStorageKeys = {
	alias: 'hadithdb_quran_tafsir_alias',
	language: 'hadithdb_quran_tafsir_language',
	open: 'hadithdb_quran_tafsir_open',
	legacyAlias: 'quranTafsirAlias'
};
var quranTafsirBooksPromise = null;

function getQuranTafsirBooks(query) {
	var request = function () {
		return fetch(`${quranApiPath('/proxy/tafsir/books')}${query || ''}`).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load tafsir list.');
			return response.json();
		});
	};
	if (query)
		return request();
	if (!quranTafsirBooksPromise) {
		quranTafsirBooksPromise = request().catch(function (err) {
			quranTafsirBooksPromise = null;
			throw err;
		});
	}
	return quranTafsirBooksPromise;
}

function quranTafsirSessionStorage() {
	try {
		return window.sessionStorage || null;
	} catch (_err) {
		return null;
	}
}

function normalizeQuranTafsirLanguage(language) {
	language = (language || '').toString();
	return language === 'ar' || language === 'en' ? language : '';
}

function getStoredQuranTafsirAlias() {
	var storage = quranTafsirSessionStorage();
	if (!storage)
		return '';
	var alias = storage.getItem(quranTafsirStorageKeys.alias);
	if (!alias) {
		alias = storage.getItem(quranTafsirStorageKeys.legacyAlias);
		if (alias) {
			storage.setItem(quranTafsirStorageKeys.alias, alias);
			storage.removeItem(quranTafsirStorageKeys.legacyAlias);
		}
	}
	return alias || '';
}

function storeQuranTafsirAlias(alias) {
	var storage = quranTafsirSessionStorage();
	if (!storage || !alias)
		return;
	storage.setItem(quranTafsirStorageKeys.alias, alias);
	storage.removeItem(quranTafsirStorageKeys.legacyAlias);
}

function getStoredQuranTafsirLanguage() {
	var storage = quranTafsirSessionStorage();
	return storage ? normalizeQuranTafsirLanguage(storage.getItem(quranTafsirStorageKeys.language)) : '';
}

function storeQuranTafsirLanguage(language) {
	language = normalizeQuranTafsirLanguage(language);
	var storage = quranTafsirSessionStorage();
	if (!storage || !language)
		return;
	storage.setItem(quranTafsirStorageKeys.language, language);
}

function requestQuranTafsirOpen() {
	var storage = quranTafsirSessionStorage();
	if (!storage)
		return;
	storage.setItem(quranTafsirStorageKeys.open, '1');
}

function consumeQuranTafsirOpenRequest() {
	var storage = quranTafsirSessionStorage();
	if (!storage || storage.getItem(quranTafsirStorageKeys.open) !== '1')
		return false;
	storage.removeItem(quranTafsirStorageKeys.open);
	return true;
}

$(document).on('click', 'a[data-open-quran-tafsir]', function () {
	requestQuranTafsirOpen();
});

function isQuranTranslationPage() {
	return /^\/quran\/translations(?:\/|$)/.test(window.location.pathname);
}

function canonicalizeQuranTranslationPageUrl() {
	if (!isQuranTranslationPage())
		return;
	var url = new URL(window.location.href);
	var changed = false;
	if (url.searchParams.has('lang')) {
		url.searchParams.delete('lang');
		changed = true;
	}
	var hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
	if (hashParams.has('tafsir') || hashParams.has('open-tafsir')) {
		url.hash = '';
		changed = true;
	}
	if (changed)
		window.history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function tafsirBrowseSlug(alias) {
	return (alias || '').toString().replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
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
		var textRoot = $(link).closest('.quran-tafsir-text, [data-quran-translation-display="passage"], .quran-translation-text');
		popup = $('<aside>').addClass('quran-tafsir-footnote-popup').attr({
			role: 'tooltip',
			dir: textRoot.attr('dir') || 'auto',
			lang: textRoot.attr('lang') || ''
		}).appendTo(doc.body);
		popup.append(content);
		positionPopup(link);
	};
	$(doc).on('mouseenter focusin', '.quran-tafsir-text .footnote-ref a, [data-quran-translation-display="passage"] .footnote-ref a', function () {
		showPopup(this);
	});
	$(doc).on('mouseleave focusout', '.quran-tafsir-text .footnote-ref a, [data-quran-translation-display="passage"] .footnote-ref a', removePopup);
	$(window).on('scroll resize', removePopup);
}

function initQuranTafsirTabs(root) {
	var scope = root || document;
		$(scope).find('.quran-tafsirs').each(function () {
			var container = $(this);
		if (container.closest('.quran-ayah-modal-pane.d-none').length)
			return;
		var modal = container.closest('.quran-ayah-modal');
		if (modal.length && !modal.hasClass('show') && !modal.data('quranAyahModalOpening'))
			return;
		if (container.data('quranTafsirsBound'))
			return;
		container.data('quranTafsirsBound', true);
		var surah = container.attr('data-surah');
		var ayahs = (container.attr('data-ayahs') || '').split(',').filter(Boolean).map(Number).filter(function (ayah) {
			return Number.isInteger(ayah) && ayah >= 0;
		});
			var selectedAyahs = (container.attr('data-selected-ayahs') || '').split(',').filter(Boolean).map(Number).filter(function (ayah) {
				return Number.isInteger(ayah) && ayah >= 0;
			});
			var ayahText = JSON.parse(container.find('.quran-tafsir-ayah-data').text() || '{}');
			var initialTafsirData = JSON.parse(container.find('.quran-tafsir-initial-data').text() || 'null');
			var initialTafsirBooks = JSON.parse(container.find('.quran-tafsir-books-data').text() || 'null');
			var selectedTafsirLanguage = normalizeQuranTafsirLanguage(container.attr('data-selected-tafsir-language'));
			var activeLanguage = selectedTafsirLanguage || getStoredQuranTafsirLanguage() || 'en';
			var rendersTafsirPassagePage = (container.attr('data-tafsir-instance') || 'passage') === 'passage';
			var rendersCollapsibleEntries = !rendersTafsirPassagePage && container.closest('.quran-ayah-modal').length < 1;
			var isTafsirModal = container.closest('.quran-ayah-modal[data-quran-ayah-modal-type="tafsirs"]').length > 0;
			var canManageTafsirVisibility = isTafsirModal || container.closest('.tafsir-only-page').length > 0;
			var selectedByLanguage = {};
			var remoteTafsirsUnavailable = false;
			var preferredTafsirAlias = container.attr('data-selected-tafsir') || '';
			var allTafsirBookAliases = { en: [], ar: [] };
			var englishLocalTafsirAliasBySlug = {};
			var tafsirUrlSlug = function (alias) {
				return (alias || '').toString().replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
			};
			var dedicatedTafsirPassageTarget = function () {
				if ((container.attr('data-tafsir-instance') || 'passage') !== 'passage')
					return null;
				var match = window.location.pathname.match(/^\/quran\/tafsir\/([^/]+)\/quran:(\d+):(\d+)(?:-(\d+))?\/?$/);
				var targetSurah = container.attr('data-surah') || surah;
				var targetAyah = (selectedAyahs[0] || ayahs[0] || '').toString();
				if (!targetSurah || !targetAyah)
					return null;
				return {
					slug: match ? match[1] : tafsirUrlSlug(preferredTafsirAlias),
					surah: match ? match[2] : targetSurah,
					ayah: match ? match[3] : targetAyah,
					endAyah: match ? (match[4] || match[3]) : targetAyah
				};
			};
			var dedicatedTafsirPassageMatch = function () {
				return dedicatedTafsirPassageTarget();
			};
			var dedicatedTafsirPassageUrl = function (alias, language) {
				var target = dedicatedTafsirPassageTarget();
				if (!target || !alias)
					return '';
				var range = target.endAyah !== target.ayah ? `${target.ayah}-${target.endAyah}` : target.ayah;
				return `/quran/tafsir/${encodeURIComponent(tafsirUrlSlug(alias))}/quran:${encodeURIComponent(target.surah)}:${range}`;
			};
			var currentDedicatedTafsirPassageUrl = function () {
				var target = dedicatedTafsirPassageTarget();
				if (!target || !target.slug)
					return '';
				var range = target.endAyah !== target.ayah ? `${target.ayah}-${target.endAyah}` : target.ayah;
				return `/quran/tafsir/${encodeURIComponent(target.slug)}/quran:${encodeURIComponent(target.surah)}:${range}`;
			};
			var clearDedicatedTafsirHash = function () {
				if (dedicatedTafsirPassageMatch() && (window.location.hash || window.location.search))
					window.history.replaceState(null, '', currentDedicatedTafsirPassageUrl());
			};
			var storeTafsirAlias = function (alias) {
				storeQuranTafsirAlias(alias);
			};
		var toArabicDigits = function (value) {
			return value.toString().replace(/\d/g, function (digit) {
				return '٠١٢٣٤٥٦٧٨٩'[digit];
			});
		};
			var tafsirAyahHeadingHref = function (alias, ayah) {
				if (rendersTafsirPassagePage || !alias)
					return quranUrl(`/quran:${surah}:${ayah}`);
				return quranUrl(`/quran/tafsir/${encodeURIComponent(tafsirUrlSlug(alias))}/quran:${encodeURIComponent(surah)}:${encodeURIComponent(ayah)}`);
			};
			var appendAyahHeading = function (entryElement, ayah, inline, showRef, alias) {
				var heading = $('<h3>').addClass('quran-tafsir-ayah').attr({
					lang: 'ar',
					dir: 'rtl'
				}).appendTo(entryElement);
				if (inline)
					heading.addClass('quran-tafsir-ayah-inline');
				var linkHref = tafsirAyahHeadingHref(alias, ayah);
				var link = $('<a>').attr({
					href: linkHref,
					title: rendersTafsirPassagePage ? `Read Quran ${surah}:${ayah}` : `Open tafsir page for Quran ${surah}:${ayah}`
				}).appendTo(heading);
			if (showRef) {
				$('<span>').addClass('quran-tafsir-ayah-ref').attr('dir', 'ltr').text(`${surah}:${ayah}`).appendTo(link);
				link.append(document.createTextNode(' '));
			}
			$('<span>').addClass('quran-tafsir-ayah-text').attr({
				'data-quran-script-text': 'ayah',
				'data-quran-ref': `${surah}:${ayah}`
			}).text(ayahText[ayah] || '').appendTo(link);
			link.append(document.createTextNode(' '));
			$('<span>').addClass('quran-ayah-end-marker').text(`۝${toArabicDigits(ayah)}`).appendTo(link);
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
		var bindTafsirEntryCollapse = function (entryElement) {
			entryElement.on('toggle', function () {
				if (!this.open)
					return;
				if ($(this).data('skipInitialOpenScroll')) {
					$(this).removeData('skipInitialOpenScroll');
					return;
				}
				$(this).siblings('.quran-tafsir-entry[open]').prop('open', false);
				scrollTafsirEntryIntoView($(this));
			});
		};
		var scrollTafsirEntryIntoView = function (entryElement) {
			if (!entryElement || !entryElement.length)
				return;
			window.requestAnimationFrame(function () {
				var modalBody = entryElement.closest('.modal-body');
				if (modalBody.length) {
					var modalBodyEl = modalBody[0];
					var modalRect = modalBodyEl.getBoundingClientRect();
					var entryRect = entryElement[0].getBoundingClientRect();
					modalBodyEl.scrollTo({
						top: modalBodyEl.scrollTop + entryRect.top - modalRect.top - 12,
						behavior: 'smooth'
					});
					return;
				}
				var navbar = document.querySelector('.site-navbar.fixed-top');
				var navbarOffset = navbar ? navbar.getBoundingClientRect().height : 0;
				window.scrollTo({
					top: window.pageYOffset + entryElement[0].getBoundingClientRect().top - navbarOffset - 12,
					behavior: 'smooth'
				});
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
			var commentaryDeathLabel = function (book, suffix) {
				var death = (book && book.death || '').toString().trim();
				if (!death)
					return '';
				if (suffix && !/\b(?:AH|CE|H)\b/i.test(death) && !/هـ/u.test(death))
					death = `${death} ${suffix}`;
				return /^d\./i.test(death) ? death : `d. ${death}`;
			};
			var commentaryPublicationLabel = function (book) {
				return [
					book && book.published_year ? `Pub. ${book.published_year}` : '',
					book && book.publisher ? book.publisher : ''
				].filter(Boolean).join(', ');
			};
			var commentaryMetaParts = function (book, suffix) {
				return [
					book && (book.author_en || book.author),
					commentaryDeathLabel(book, suffix),
					commentaryPublicationLabel(book)
				].filter(Boolean);
			};
			var tafsirSizeLabel = function (book) {
				var size = (book && book.size || '').toString();
				if (size === 'lg')
					return 'Large tafsir';
				if (size === 'md')
					return 'Medium tafsir';
				if (size === 'sm')
					return 'Small tafsir';
				return '';
			};
			var renderTafsirSizeIndicator = function (book) {
				var size = (book && book.size || '').toString();
				var label = tafsirSizeLabel(book);
				if (!label)
					return null;
				return $('<span>').addClass(`tafsir-size-indicator tafsir-size-tooltip tafsir-size-indicator-${size}`).attr({
					title: label,
					'data-tafsir-size-tooltip': label,
					'aria-label': label,
					role: 'img'
				});
			};
			var tafsirBookModalId = function (book) {
				return `tafsir-book-modal-${footnoteIdPart(book && book.alias || 'tafsir')}-${footnoteIdPart(book && book.lang || 'all')}`;
			};
			var renderTafsirBookDescription = function (description) {
				description = (description || '').toString();
				if (!description)
					return '';
				if (window.marked && window.marked.parse)
					return window.marked.parse(description).replace(/<br>/g, '</p><p>').trim();
				return $('<div>').text(description).html();
			};
			var appendTafsirBookModalNames = function (target, book, language) {
				var isArabic = language === 'ar';
				var shortName = isArabic ? (book.shortName || book.shortName_en) : (book.shortName_en || book.shortName);
				var fullName = isArabic ? (book.title || book.name_en) : (book.name_en || book.title);
				var author = isArabic ? (book.author || book.author_en) : (book.author_en || book.author);
				var meta = isArabic
					? [
						author,
						book.death ? `d. ${toArabicDigits(book.death)} هـ` : '',
						commentaryPublicationLabel(book)
					].filter(Boolean).join('، ')
					: commentaryMetaParts(book, 'AH').join(', ');
				var section = $('<section>').addClass('tafsir-book-modal-name-block').attr({
					lang: isArabic ? 'ar' : 'en',
					dir: isArabic ? 'rtl' : 'ltr'
				}).appendTo(target);
				$('<h6>').addClass('mb-1').text(shortName || fullName || book.alias || '').appendTo(section);
				if (fullName && fullName !== shortName)
					$('<p>').addClass('mb-1 tafsir-book-modal-full-name').text(fullName).appendTo(section);
				if (meta)
					$('<p>').addClass('mb-0 text-muted').text(meta).appendTo(section);
			};
			var ensureTafsirBookModal = function (book) {
				var modalId = tafsirBookModalId(book);
				var existing = $(`#${cssEscape(modalId)}`);
				if (existing.length)
					return existing;
				var titleId = `${modalId}-title`;
				var title = book.shortName_en || book.shortName || book.name_en || book.title || book.alias || 'Tafsir';
				var modal = $('<div>').addClass('modal fade tafsir-book-modal').attr({
					id: modalId,
					tabindex: '-1',
					'aria-labelledby': titleId,
					'aria-hidden': 'true'
				}).appendTo(document.body);
				var dialog = $('<div>').addClass('modal-dialog modal-dialog-scrollable').appendTo(modal);
				var content = $('<div>').addClass('modal-content').appendTo(dialog);
				var header = $('<div>').addClass('modal-header').appendTo(content);
				$('<h5>').addClass('modal-title').attr('id', titleId).text(title).appendTo(header);
				$('<button>').addClass('btn-close').attr({
					type: 'button',
					'data-bs-dismiss': 'modal',
					'aria-label': 'Close'
				}).appendTo(header);
				var body = $('<div>').addClass('modal-body').appendTo(content);
				appendTafsirBookModalNames(body, book, 'en');
				if (book.title || book.shortName || book.author)
					appendTafsirBookModalNames(body, book, 'ar');
				var descriptionHtml = renderTafsirBookDescription(book.description);
				if (descriptionHtml)
					$('<div>').addClass('tafsir-book-modal-description mt-3').html(descriptionHtml).appendTo(body);
				else
					$('<p>').addClass('tafsir-book-modal-description text-muted mt-3 mb-0').text('No description is available for this tafsir.').appendTo(body);
				return modal;
			};
			var openTafsirBookModal = function (book) {
				var modal = ensureTafsirBookModal(book);
				if (window.bootstrap && window.bootstrap.Modal)
					window.bootstrap.Modal.getOrCreateInstance(modal[0]).show();
			};
			var setTafsirBookHoverHighlight = function (target, highlighted) {
				var panel = $(target).closest('.quran-tafsir-panel');
				panel.toggleClass('tafsir-book-hover-highlight', highlighted);
			};
			var appendTafsirBookNameTrigger = function (target, book, language) {
				var isArabic = language === 'ar';
				var label = isArabic
					? (book.title || book.shortName || book.shortName_en || book.alias)
					: (book.name_en || book.shortName_en || book.alias);
				var trigger = $('<button>').addClass('quran-tafsir-book-modal-trigger').attr({
					type: 'button',
					title: 'View tafsir details',
					'aria-label': `View details for ${label}`
				}).text(label).appendTo(target);
				trigger.on('mouseenter focus', function () {
					setTafsirBookHoverHighlight(this, true);
				});
				trigger.on('mouseleave blur', function () {
					setTafsirBookHoverHighlight(this, false);
				});
				trigger.on('click', function (event) {
					event.preventDefault();
					openTafsirBookModal(book);
				});
				return trigger;
			};
			var waitForSettingsAuth = function () {
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
			var enabledTafsirOrderFromTabs = function (language) {
				return container.find('.quran-tafsir-tabs [data-tafsir-hash]').filter(function () {
					return $(this).attr('data-tafsir-lang') === language && $(this).attr('data-tafsir-disabled') !== '1';
				}).map(function () {
					return $(this).attr('data-tafsir-hash');
				}).get().filter(Boolean);
			};
			var disabledTafsirAliasesFromTabs = function () {
				var disabled = new Set();
				container.find('.quran-tafsir-tabs [data-tafsir-hash][data-tafsir-disabled="1"]').each(function () {
					var alias = $(this).attr('data-tafsir-hash');
					if (alias)
						disabled.add(alias);
				});
				return Array.from(disabled);
			};
			var saveTafsirPreferences = async function (disabledAliasesOverride) {
				var auth = await waitForSettingsAuth();
				var user = auth && auth.getUser ? await auth.getUser() : null;
				if (!user)
					throw new Error('Please sign in to save tafsir settings.');
				var token = auth && auth.requireToken
					? await auth.requireToken('Please sign in once to refresh your local session.')
					: (auth && auth.getToken ? await auth.getToken() : null);
				if (!token)
					throw new Error('Please sign in once to refresh your local session.');
				var settingsResponse = await fetch(quranApiPath('/user-settings?optional=1'), {
					credentials: 'same-origin',
					headers: { 'Authorization': `Bearer ${token}` }
				});
				if (!settingsResponse.ok)
					throw new Error(await responseErrorMessage(settingsResponse, 'Unable to load settings.'));
				var settingsData = await settingsResponse.json();
				var settings = settingsData && settingsData.settings && typeof settingsData.settings === 'object' && !Array.isArray(settingsData.settings)
					? settingsData.settings
					: {};
				var tafsirSettings = settings.tafsirs && typeof settings.tafsirs === 'object' && !Array.isArray(settings.tafsirs)
					? settings.tafsirs
					: {};
				var disabledSet = new Set(Array.isArray(disabledAliasesOverride)
					? disabledAliasesOverride
					: (Array.isArray(tafsirSettings.disabledAliases) ? tafsirSettings.disabledAliases : []));
				var existingOrder = tafsirSettings.order && typeof tafsirSettings.order === 'object' && !Array.isArray(tafsirSettings.order)
					? tafsirSettings.order
					: {};
				var nextOrder = {};
				['en', 'ar'].forEach(function (language) {
					nextOrder[language] = Array.from(new Set(enabledTafsirOrderFromTabs(language).concat(
						Array.isArray(existingOrder[language]) ? existingOrder[language] : [],
						allTafsirBookAliases[language] || []
					).filter(function (alias) {
						return alias && !disabledSet.has(alias);
					})));
				});
				var nextSettings = Object.assign({}, settings, {
					tafsirs: Object.assign({}, tafsirSettings, {
						disabledAliases: Array.from(disabledSet),
						order: nextOrder
					})
				});
				delete nextSettings.personalized;
				var response = await fetch(quranApiPath('/user-settings'), {
					method: 'PUT',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
					body: JSON.stringify({ settings: nextSettings })
				});
				if (!response.ok)
					throw new Error(await responseErrorMessage(response, 'Unable to save tafsir settings.'));
				var data = await response.json();
				updateCachedQuranUserSettings(user, data.settings || nextSettings);
			};
			var setTafsirBookDisabled = function (alias, disabled) {
				if (!alias)
					return;
				container.find(`.quran-tafsir-tabs [data-tafsir-hash="${cssEscape(alias)}"]`).each(function () {
					var tab = $(this);
					tab.attr('data-tafsir-disabled', disabled ? '1' : '0');
					tab.toggleClass('is-disabled', disabled);
					if (disabled)
						tab.addClass('d-none');
					else if (tab.attr('data-tafsir-lang') === activeLanguage && !(remoteTafsirsUnavailable && isRemoteTafsirTab(tab)))
						tab.removeClass('d-none');
					tab.find('[data-tafsir-enable-toggle]').prop('checked', !disabled);
				});
				container.find(`.quran-tafsir-panel[data-tafsir-src="${cssEscape(alias)}"]`).each(function () {
					var panel = $(this);
					var wasActive = panel.hasClass('active');
					panel.attr('data-tafsir-disabled', disabled ? '1' : '0');
					panel.toggleClass('is-disabled', disabled);
					panel.find('[data-tafsir-enable-toggle]').prop('checked', !disabled);
					if (disabled) {
						panel.data('tafsirLoaded', false);
						panel.find('.quran-tafsir-text').empty();
						panel.find('.quran-tafsir-status').removeClass('d-none').text('This tafsir is hidden in My Settings.');
					} else if (panel.hasClass('active')) {
						panel.find('.quran-tafsir-status').removeClass('d-none').text('Loading tafsir...');
						loadPanel(panel);
					}
					if (disabled && wasActive)
						showLanguage(panel.attr('data-tafsir-lang') || activeLanguage);
				});
			};
			var bindTafsirEnableToggle = function (scope, book) {
				scope.find('[data-tafsir-enable-toggle]').on('change', async function () {
					var toggle = $(this);
					var previousDisabled = toggle.closest('[data-tafsir-disabled]').attr('data-tafsir-disabled') === '1';
					var nextDisabled = !toggle.prop('checked');
					setTafsirBookDisabled(book.alias, nextDisabled);
					try {
						await saveTafsirPreferences(disabledTafsirAliasesFromTabs());
					} catch (err) {
						setTafsirBookDisabled(book.alias, previousDisabled);
						if (window.toastr)
							toastr.error(err.message || 'Unable to save tafsir settings.', 'Settings');
					}
				});
			};
			var appendTafsirEnableToggle = function (target, book) {
				if (!canManageTafsirVisibility)
					return;
				var shortName = book.shortName_en || book.shortName || book.author_en || book.alias;
				var toggleLabel = $('<label>').addClass('quran-tafsir-enable-toggle form-check form-switch mb-0 ms-auto').attr('title', 'Show this tafsir').on('click', function (event) {
					event.stopPropagation();
				}).appendTo(target);
				$('<input>').addClass('form-check-input').attr({
					type: 'checkbox',
					'data-tafsir-enable-toggle': book.alias,
					'aria-label': `Show ${shortName}`
				}).appendTo(toggleLabel);
				bindTafsirEnableToggle(toggleLabel, book);
			};
			var appendSourceHeader = function (panel, book) {
				var header = $('<header>').addClass('quran-tafsir-source row').appendTo(panel);
				var english = $('<section>').addClass('col-6 text-start').attr('lang', 'en').appendTo(header);
				var arabic = $('<section>').addClass('col-6 text-end').attr('lang', 'ar').appendTo(header);
				var englishTitle = $('<strong>').appendTo(english);
				if (rendersTafsirPassagePage)
					appendTafsirBookNameTrigger(englishTitle, book, 'en');
				else
					englishTitle.text(book.name_en || book.shortName_en || book.alias);
				$('<span>').text(commentaryMetaParts(book, 'AH').join(', ')).appendTo(english);
				appendTafsirEnableToggle(english, book);
				if (book.title || book.author) {
					var arabicTitle = $('<strong>').appendTo(arabic);
					if (rendersTafsirPassagePage)
						appendTafsirBookNameTrigger(arabicTitle, book, 'ar');
					else
						arabicTitle.text(book.title || '');
					$('<span>').text([
						book.author,
						book.death ? `d. ${toArabicDigits(book.death)} هـ` : '',
						commentaryPublicationLabel(book)
					].filter(Boolean).join('، ')).appendTo(arabic);
				}
			};
			var tafsirTooltipText = function (book) {
				var fullName = book.name_en || book.title || book.shortName_en || book.shortName || book.alias || '';
				var author = book.author_en || book.author || '';
				return [
					fullName,
					author,
					commentaryDeathLabel(book, 'AH'),
					commentaryPublicationLabel(book)
				].filter(Boolean).join('\n');
			};
			var addCatalogTab = function (book) {
				var disabled = book.disabled === true;
				var panelId = `${container.attr('data-tafsir-instance') || 'passage'}-${container.attr('data-surah')}-${ayahs[0] || ''}-${book.lang}-${book.alias}`;
				var tabId = `quran-tafsirs-${panelId}-tab`;
				var targetId = `quran-tafsirs-${panelId}`;
				if (container.find(`#${cssEscape(tabId)}`).length)
					return;
				var dedicatedHref = dedicatedTafsirPassageUrl(book.alias, book.lang);
				var tab = $(dedicatedHref ? '<a>' : '<button>').addClass('btn btn-outline-primary text-nowrap tafsir-book-tooltip').attr({
					id: tabId,
					'data-bs-target': `#${targetId}`,
					'data-tafsir-hash': book.alias,
					'data-tafsir-lang': book.lang,
					'data-tafsir-disabled': disabled ? '1' : '0',
					'data-tafsir-tooltip': tafsirTooltipText(book),
					'data-book-carousel-item': '',
					'data-book-carousel-search': [book.name_en, book.shortName_en, book.title, book.shortName, book.author_en, book.author, book.alias].filter(Boolean).join(' '),
					role: 'tab',
					'aria-controls': targetId,
					'aria-selected': 'false'
				}).text(book.shortName_en || book.shortName || book.author_en || book.alias);
				var sizeIndicator = renderTafsirSizeIndicator(book);
				if (sizeIndicator)
					tab.append(sizeIndicator);
				tab.toggleClass('is-disabled', disabled);
				if (dedicatedHref) {
					tab.attr('href', dedicatedHref);
				} else {
					tab.attr({
						'data-bs-toggle': 'tab',
						type: 'button'
					});
				}
			tab.toggleClass('d-none', book.lang !== activeLanguage).appendTo(container.find('.quran-tafsir-tabs'));
			applyBookCarouselFilter(container.find('[data-book-carousel-filter]').first());
			var panel = $('<section>').addClass('tab-pane fade quran-tafsir-panel').attr({
				id: targetId,
				role: 'tabpanel',
				'aria-labelledby': tabId,
				tabindex: '0',
				'data-tafsir-src': book.alias,
				'data-tafsir-source': book.source,
				'data-tafsir-format': book.format || 'txt',
				'data-tafsir-lang': book.lang,
				'data-tafsir-disabled': disabled ? '1' : '0'
			}).appendTo(container.find('.quran-tafsir-content'));
			panel.toggleClass('is-disabled', disabled);
			appendSourceHeader(panel, book);
			$('<p>').addClass('quran-tafsir-status text-muted').text(disabled ? 'This tafsir is hidden in My Settings.' : 'Select this tab to load the tafsir.').appendTo(panel);
			$('<div>').addClass('quran-tafsir-text').attr({
				lang: book.lang,
				dir: book.lang === 'ar' ? 'rtl' : 'ltr'
			}).appendTo(panel);
			panel.find('[data-tafsir-enable-toggle]').prop('checked', !disabled);
		};
		var adminTafsirCacheParam = function () {
			return shouldFlushQuranProxyCache() ? '&flush=1' : '';
		};
		var adminTafsirQuery = function () {
			return shouldFlushQuranProxyCache() ? '?flush=1' : '';
		};
		var fetchPayload = async function (src, source, ayah, language) {
			var endpoint = quranApiPath(source === 'local' ? '/proxy/tafsir/local' : '/proxy/tafsir');
			var languageParam = source === 'local' && language ? `&lang=${encodeURIComponent(language)}` : '';
			var response = await fetch(`${endpoint}?src=${encodeURIComponent(src)}&s=${encodeURIComponent(surah)}&a=${encodeURIComponent(ayah)}${languageParam}${adminTafsirCacheParam()}`);
			if (response.status === 404)
				return null;
			if (!response.ok) {
				var err = new Error('Unable to load tafsir.');
				err.remoteUnavailable = response.status === 503 && source !== 'local';
				throw err;
			}
			return await response.json();
		};
		var fetchLocalPayloads = async function (src, language) {
			if (ayahs.length < 1)
				return [];
			var endpoint = quranApiPath('/proxy/tafsir/local');
			var languageParam = language ? `&lang=${encodeURIComponent(language)}` : '';
			var ayahFrom = Math.min.apply(Math, ayahs);
			var ayahTo = Math.max.apply(Math, ayahs);
			var response = await fetch(`${endpoint}?src=${encodeURIComponent(src)}&s=${encodeURIComponent(surah)}&from=${encodeURIComponent(ayahFrom)}&to=${encodeURIComponent(ayahTo)}${languageParam}${adminTafsirCacheParam()}`);
			if (response.status === 404)
				return [];
			if (!response.ok)
				throw new Error('Unable to load tafsir.');
			var payload = await response.json();
			return Array.isArray(payload.entries) ? payload.entries : [payload];
		};
		var stripTafsirPageMarkers = function (value) {
			if (!value)
				return value;
			return value.toString().replace(/\\?\(p\\?-[0-9\u0660-\u0669\u06F0-\u06F9]+\\?\)/gu, '');
		};
		var cleanTafsirPayload = function (payload) {
			if (!payload)
				return payload;
			if (payload.data)
				payload.data = stripTafsirPageMarkers(payload.data);
			if (payload.html)
				payload.html = stripTafsirPageMarkers(payload.html);
			return payload;
		};
		var localTafsirPayloadRangeKey = function (payload) {
			if (!payload)
				return '';
			return `${Number(payload.ayahs_start) || 0}:${Number(payload.count) || 0}`;
		};
		var mergeLocalEnglishTranslationPayloads = function (payloads, englishPayloads) {
			if (!Array.isArray(payloads) || !Array.isArray(englishPayloads) || englishPayloads.length < 1)
				return payloads;
			var englishByRange = new Map();
			englishPayloads.forEach(function (payload) {
				if (payload && payload.html)
					englishByRange.set(localTafsirPayloadRangeKey(payload), payload);
			});
			return payloads.map(function (payload) {
				if (!payload || payload.bilingual || !payload.html)
					return payload;
				var english = englishByRange.get(localTafsirPayloadRangeKey(payload));
				if (!english || !english.html || english.html === payload.html)
					return payload;
				return Object.assign({}, payload, {
					bilingual: true,
					arabic_html: payload.html,
					html: `<div class="row quran-tafsir-local-pair"><div class="col-md-6 col-sm-12">${english.html}</div><div class="col-md-6 col-sm-12">${payload.html}</div></div>`,
					translation_existing: true,
					content_translation_language: 'en'
				});
			});
		};

		var loadPanel = async function (panel) {
			var src = panel.attr('data-tafsir-src');
			var source = panel.attr('data-tafsir-source') || 'tafsir.app';
			var format = panel.attr('data-tafsir-format') || 'txt';
			if (!src || panel.data('tafsirLoaded') || panel.data('tafsirLoading'))
				return;
			if (panel.attr('data-tafsir-disabled') === '1') {
				panel.find('.quran-tafsir-text').empty();
				panel.find('.quran-tafsir-status').removeClass('d-none').text('This tafsir is hidden in My Settings.');
				return;
			}
			panel.data('tafsirLoading', true);
			var status = panel.find('.quran-tafsir-status');
			var text = panel.find('.quran-tafsir-text');
			status.text('Loading tafsir...');
			try {
				var panelLanguage = panel.attr('data-tafsir-lang') || 'en';
				var initialPayloads = initialTafsirData
					&& initialTafsirData.alias === src
					&& initialTafsirData.lang === panelLanguage
					&& Array.isArray(initialTafsirData.entries)
					? initialTafsirData.entries
					: null;
				var payloads = initialPayloads
					? initialPayloads.map(function (payload) {
						return { ayah: payload.ayahs_start, payload: payload };
					})
					: source === 'local'
					? (await fetchLocalPayloads(src, panelLanguage)).map(function (payload) {
						return {
							ayah: payload.ayahs_start,
							payload: payload
						};
					})
					: await Promise.all(ayahs.map(async function (ayah) {
						return {
							ayah: ayah,
							payload: cleanTafsirPayload(await fetchPayload(src, source, ayah, panelLanguage))
						};
					}));
				if (source === 'local' && panelLanguage === 'ar') {
					var englishTranslationAlias = englishLocalTafsirAliasBySlug[tafsirUrlSlug(src)] || '';
					if (englishTranslationAlias && englishTranslationAlias !== src) {
						var englishPayloads = await fetchLocalPayloads(englishTranslationAlias, 'en');
						var mergedPayloads = mergeLocalEnglishTranslationPayloads(
							payloads.map(function (entry) { return entry.payload; }),
							englishPayloads
						);
						payloads = payloads.map(function (entry, index) {
							return Object.assign({}, entry, { payload: mergedPayloads[index] || entry.payload });
						});
					}
				}
				payloads.forEach(function (entry) {
					if (entry && entry.payload)
						cleanTafsirPayload(entry.payload);
				});
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
				if (entries.length > 0) {
					var rangeStarts = entries.map(function (entry) { return Number(entry.payload.ayahs_start || entry.ayah); });
					var rangeEnds = entries.map(function (entry, index) { return rangeStarts[index] + Number(entry.payload.count || 0); });
					panel.attr({ 'data-tafsir-range-start': Math.min.apply(Math, rangeStarts), 'data-tafsir-range-end': Math.max.apply(Math, rangeEnds) });
					container.trigger('quranTafsirChanged');
				}
				text.empty();
				var hasBilingualEntries = entries.some(function (entry) {
					return entry.payload && entry.payload.bilingual;
				});
				if (hasBilingualEntries) {
					text.attr({ lang: 'en', dir: 'ltr' });
				} else {
					var panelLanguage = panel.attr('data-tafsir-lang') || 'en';
					text.attr({
						lang: panelLanguage,
						dir: panelLanguage === 'ar' ? 'rtl' : 'ltr'
					});
				}
				var appendedContentTranslationControl = false;
				entries.forEach(function (entry) {
					var startAyah = Number(entry.payload.ayahs_start || entry.ayah);
					var count = Number(entry.payload.count || 0);
					var endAyah = startAyah + count;
					var entryElement = $(rendersCollapsibleEntries ? '<details>' : '<article>').addClass('quran-tafsir-entry');
					var tafsirTranslationPoints = Math.max(0, Math.floor(Number(entry.payload.translation_points) || 0));
					var tafsirTranslationWordCount = Math.max(0, Math.floor(Number(entry.payload.translation_word_count) || 0));
					var tafsirTranslationExisting = entry.payload.translation_existing === true || entry.payload.translation_existing === 'true';
					var tafsirTranslationItemId = (entry.payload.id || '').toString();
					var tafsirContentLanguage = entry.payload.content_translation_language || panel.attr('data-tafsir-lang') || 'en';
					var hasTafsirTranslationItem = source === 'local' && /^\d+$/.test(tafsirTranslationItemId);
					if (hasTafsirTranslationItem) {
						entryElement.attr({
							'data-content-translation-scope': 'tafsir',
							'data-content-translation-item-id': tafsirTranslationItemId,
							'data-content-translation-points': tafsirTranslationPoints,
							'data-content-translation-word-count': tafsirTranslationWordCount
						});
					}
					if (rendersCollapsibleEntries && overlapsSelectedAyahs(startAyah, endAyah))
						entryElement.prop('open', true).data('skipInitialOpenScroll', true);
					entryElement.appendTo(text);
					if (rendersCollapsibleEntries)
						bindTafsirEntryCollapse(entryElement);
					var summary = $(rendersCollapsibleEntries ? '<summary>' : '<header>').appendTo(entryElement);
					var ayahHeadings = count > 0
						? $('<div>').addClass('quran-tafsir-ayah-range').attr({ lang: 'ar', dir: 'rtl' }).appendTo(summary)
						: summary;
					var showedAyahRef = false;
					for (var ayah = startAyah; ayah <= endAyah; ayah++) {
						if (ayahText[ayah]) {
							appendAyahHeading(ayahHeadings, ayah, count > 0, !showedAyahRef, src);
							showedAyahRef = true;
						}
					}
					var generatedBody = null;
					if (entry.payload.html !== undefined) {
						generatedBody = $('<div>').addClass('quran-tafsir-entry-body quran-tafsir-html').html(entry.payload.html).appendTo(entryElement);
					} else if (format === 'html') {
						generatedBody = $('<div>').addClass('quran-tafsir-entry-body quran-tafsir-html').html(entry.payload.data).appendTo(entryElement);
					} else {
						var entryBody = $('<div>').addClass('quran-tafsir-entry-body').appendTo(entryElement);
						if (panel.attr('data-tafsir-lang') === 'ar')
							appendTextWithBracketedFootnotes(entryBody, entry.payload.data, `tafsir-${footnoteIdPart(src)}-${startAyah}`);
						else
							entry.payload.data.toString().split(/\n+/).filter(Boolean).forEach(function (paragraph) {
								$('<p>').text(paragraph).appendTo(entryBody);
							});
						generatedBody = entryBody;
					}
					if (entry.payload.arabic_html) {
						generatedBody.data('tafsirArabicHtml', entry.payload.arabic_html);
						generatedBody.attr('data-tafsir-preserve-arabic', '1');
					}
					if (hasTafsirTranslationItem) {
						generatedBody.attr({
							'data-content-translation-field': 'body',
							'data-content-translation-item-type': 'tafsir',
							'data-content-translation-item-id': tafsirTranslationItemId,
							'data-content-translation-language': tafsirContentLanguage,
							'data-content-translation-existing': tafsirTranslationExisting ? 'true' : 'false',
							'data-content-translation-points': tafsirTranslationPoints,
							'data-content-translation-word-count': tafsirTranslationWordCount
						});
						appendContentTranslationControl(summary, generatedBody, 'tafsir', tafsirTranslationItemId, tafsirContentLanguage);
						appendedContentTranslationControl = true;
					}
				});
				if (appendedContentTranslationControl) {
					refreshContentTranslationAuthControls();
					resumePendingContentTranslationCheckout();
				}
				if (window.bindInlineEditors)
					window.bindInlineEditors(text[0]);
				status.toggleClass('d-none', entries.length > 0);
				if (entries.length < 1)
					status.text('No tafsir text is available for this passage.');
				panel.data('tafsirLoaded', true);
			} catch (err) {
				if (err.remoteUnavailable) {
					showLocalTafsirsOnly(panel.attr('data-tafsir-lang'));
					return;
				}
				status.removeClass('d-none').text(err.message || 'Unable to load tafsir.');
			} finally {
				panel.data('tafsirLoading', false);
			}
		};
		var showLocalTafsirsOnly = function (language) {
			remoteTafsirsUnavailable = true;
			container.find('.quran-tafsir-panel').filter(function () {
				return ($(this).attr('data-tafsir-source') || 'tafsir.app') !== 'local';
			}).each(function () {
				var panel = $(this);
				panel.removeClass('active show');
				container.find(`[data-bs-target="#${cssEscape(panel.attr('id'))}"]`).addClass('d-none').removeClass('active');
			});
			var localTab = container.find('[data-tafsir-lang]').filter(function () {
				var tab = $(this);
				if (tab.attr('role') !== 'tab' || tab.attr('data-tafsir-lang') !== language || tab.hasClass('d-none'))
					return false;
				var panel = $(tab.attr('data-bs-target'));
				return (panel.attr('data-tafsir-source') || 'tafsir.app') === 'local';
			}).first();
			if (localTab.length && window.bootstrap && window.bootstrap.Tab) {
				window.bootstrap.Tab.getOrCreateInstance(localTab[0]).show();
				return;
			}
			container.find('.quran-tafsir-status').removeClass('d-none').text('Remote tafsirs are unavailable. No local tafsir is available for this language.');
		};
		var isRemoteTafsirTab = function (tab) {
			var panel = $(tab.attr('data-bs-target'));
			return (panel.attr('data-tafsir-source') || 'tafsir.app') !== 'local';
		};
		var showLanguage = function (language, preferredAlias) {
			activeLanguage = language;
			container.find('[data-tafsir-language]').toggleClass('active', false)
				.filter(`[data-tafsir-language="${language}"]`).toggleClass('active', true);
			var tabs = container.find('[data-tafsir-lang]').filter(function () {
				return $(this).attr('role') === 'tab';
			});
			tabs.each(function () {
				var tab = $(this);
				tab.toggleClass('d-none', tab.attr('data-tafsir-lang') !== language || (remoteTafsirsUnavailable && isRemoteTafsirTab(tab)));
			});
			var targetAlias = preferredAlias || selectedByLanguage[language];
			var target = targetAlias ? tabs.filter(function () {
				return $(this).attr('data-tafsir-hash') === targetAlias && $(this).attr('data-tafsir-lang') === language && !$(this).hasClass('d-none');
			}) : $();
			if (target.length !== 1)
				target = tabs.filter(function () {
					return $(this).attr('data-tafsir-lang') === language && !$(this).hasClass('d-none');
				}).first();
			if (dedicatedTafsirPassageMatch()) {
				tabs.removeClass('active').attr('aria-selected', 'false');
				container.find('.quran-tafsir-panel').removeClass('active show');
				if (target.length) {
					var targetHash = target.attr('data-tafsir-hash');
					if (targetHash)
						storeTafsirAlias(targetHash);
					storeQuranTafsirLanguage(language);
					target.addClass('active').attr('aria-selected', 'true');
					var panel = $(target.attr('data-bs-target'));
					panel.addClass('active show');
					scrollTafsirTabIntoView(target);
					loadPanel(panel);
					container.trigger('quranTafsirChanged');
				}
				return;
			}
			if (target.length && window.bootstrap && window.bootstrap.Tab)
				window.bootstrap.Tab.getOrCreateInstance(target[0]).show();
		};

			container.on('shown.bs.tab', '[data-bs-toggle="tab"]', function (event) {
				var hash = $(event.target).attr('data-tafsir-hash');
				var language = $(event.target).attr('data-tafsir-lang');
				if (hash) {
					storeTafsirAlias(hash);
					if (dedicatedTafsirPassageMatch())
						clearDedicatedTafsirHash();
				}
				if (language) {
					activeLanguage = language;
					selectedByLanguage[language] = hash;
					storeQuranTafsirLanguage(language);
				}
				scrollTafsirTabIntoView($(event.target));
				loadPanel($($(event.target).attr('data-bs-target')));
				container.trigger('quranTafsirChanged');
			});
			container.find('[data-tafsir-language]').on('click', function () {
				var language = $(this).attr('data-tafsir-language');
				storeQuranTafsirLanguage(language);
				showLanguage(language);
			});
			Promise.all([
				Array.isArray(initialTafsirBooks) ? Promise.resolve(initialTafsirBooks) : getQuranTafsirBooks(adminTafsirQuery()),
				Promise.race([
					getQuranTafsirSettings(),
					new Promise(function (resolve) {
						window.setTimeout(function () { resolve({ personalized: false, tafsirs: {} }); }, 500);
					})
				])
		]).then(function (results) {
			var books = results[0];
			var settings = results[1];
			var usePersonalizedTafsirs = settings && settings.personalized === true;
			var tafsirs = usePersonalizedTafsirs ? ((settings || {}).tafsirs || {}) : {};
			var disabledAliases = new Set(Array.isArray(tafsirs.disabledAliases) ? tafsirs.disabledAliases : []);
			allTafsirBookAliases = { en: [], ar: [] };
			englishLocalTafsirAliasBySlug = {};
			(Array.isArray(books) ? books : []).forEach(function (book) {
				if (book && (book.lang === 'en' || book.lang === 'ar') && book.alias)
					allTafsirBookAliases[book.lang].push(book.alias);
				if (book && book.lang === 'en' && book.source === 'local' && book.alias)
					englishLocalTafsirAliasBySlug[book.slug || tafsirUrlSlug(book.alias)] = book.alias;
			});
			var visibleBooks = (Array.isArray(books) ? books : []).filter(function (book) {
				return !disabledAliases.has(book.alias);
			}).map(function (book, originalIndex) {
				return { book: Object.assign({}, book, { disabled: disabledAliases.has(book.alias) }), originalIndex: originalIndex };
			});
			visibleBooks.sort(compareTafsirAlphabeticalEntries);
			visibleBooks = visibleBooks.map(function (entry) {
				return entry.book;
				});
				visibleBooks.forEach(addCatalogTab);
				if (visibleBooks.length < 1) {
					container.find('.quran-tafsir-content').html('<p class="text-muted">All tafsirs are disabled in My Settings.</p>');
					return;
				}
				var isDedicatedTafsirPassage = !!dedicatedTafsirPassageMatch();
				var initialLanguage = selectedTafsirLanguage || getStoredQuranTafsirLanguage();
			var initialAlias = preferredTafsirAlias || (isDedicatedTafsirPassage ? '' : getStoredQuranTafsirAlias());
			var initialTab = container.find('[data-tafsir-hash]').filter(function () {
				return $(this).attr('data-tafsir-hash') === initialAlias
					&& (!initialLanguage || $(this).attr('data-tafsir-lang') === initialLanguage);
			});
			if (initialTab.length)
				showLanguage(initialTab.first().attr('data-tafsir-lang'), initialAlias);
			else if (initialLanguage)
				showLanguage(initialLanguage);
			else
				showLanguage(activeLanguage);
		}).catch(function (err) {
			container.find('.quran-tafsir-status').first().removeClass('d-none').text(err.message || 'Unable to load tafsir list.');
		});
	});
}

	function initQuranTranslations(root) {
		var scope = root || document;
		$(scope).find('.quran-translations').each(function () {
			var container = $(this);
			if (container.closest('.quran-ayah-modal-pane.d-none').length)
				return;
			var modal = container.closest('.quran-ayah-modal[data-quran-ayah-modal-type="translations"]');
			var isTranslationModal = modal.length > 0;
			var managesTranslationVisibility = !isTranslationModal && container.closest('.translation-only-page').length > 0;
			var canManageTranslationVisibility = managesTranslationVisibility || isTranslationModal;
		if (isTranslationModal && !modal.hasClass('show') && !modal.data('quranAyahModalOpening'))
			return;
		if (container.data('quranTranslationsBound'))
			return;
		container.data('quranTranslationsBound', true);
		var surah = container.attr('data-surah');
		var ayahs = (container.attr('data-ayahs') || '').split(',').filter(Boolean).map(Number).filter(function (ayah) {
			return Number.isInteger(ayah) && ayah >= 0;
		});
		var list = container.find('.quran-translation-list');
		var disclosureStateStorageKey = 'hadithdb_quran_translation_disclosure_state';
		var disclosureState = $(document).data('quranTranslationDisclosureState');
		if (!disclosureState || typeof disclosureState !== 'object' || Array.isArray(disclosureState)) {
			disclosureState = {};
			try {
				var storedDisclosureState = JSON.parse(window.localStorage.getItem(disclosureStateStorageKey) || '{}');
				if (storedDisclosureState && typeof storedDisclosureState === 'object' && !Array.isArray(storedDisclosureState))
					disclosureState = storedDisclosureState;
			} catch (_err) {
				disclosureState = {};
			}
			$(document).data('quranTranslationDisclosureState', disclosureState);
		}
		if (isTranslationModal)
			modal.data('quranTranslationDisclosureState', disclosureState);
		var saveTranslationDisclosureState = function () {
			try {
				window.localStorage.setItem(disclosureStateStorageKey, JSON.stringify(disclosureState));
			} catch (_err) {
				// Disclosure state is still synchronized across the current page.
			}
		};
		var setTranslationEntryOpen = function (entry, open) {
			entry.data('quranTranslationDisclosureSyncing', true);
			entry.prop('open', open);
			window.setTimeout(function () {
				entry.removeData('quranTranslationDisclosureSyncing');
			}, 0);
		};
		var syncTranslationDisclosureEntries = function (alias, open) {
			if (!alias)
				return;
			$('.quran-translation-entry[data-translation-alias]').filter(function () {
				return $(this).attr('data-translation-alias') === alias;
			}).each(function () {
				var entry = $(this);
				if (entry.prop('open') !== open)
					setTranslationEntryOpen(entry, open);
			});
		};
		var sortTranslationList = function (targetList, order) {
			order = Array.isArray(order) ? order : [];
			var orderIndex = new Map(order.map(function (alias, index) { return [alias, index]; }));
			var entries = targetList.find('.quran-translation-entry[data-translation-alias]').filter(function () {
				return !$(this).hasClass('quran-translation-default');
			}).get();
			entries.sort(function (a, b) {
				var aAlias = a.getAttribute('data-translation-alias') || '';
				var bAlias = b.getAttribute('data-translation-alias') || '';
				var aDisabled = a.getAttribute('data-translation-disabled') === '1';
				var bDisabled = b.getAttribute('data-translation-disabled') === '1';
				if (aDisabled !== bDisabled)
					return aDisabled ? 1 : -1;
				var aIndex = orderIndex.has(aAlias) ? orderIndex.get(aAlias) : Number.MAX_SAFE_INTEGER;
				var bIndex = orderIndex.has(bAlias) ? orderIndex.get(bAlias) : Number.MAX_SAFE_INTEGER;
				if (aIndex !== bIndex)
					return aIndex - bIndex;
				return (Number(a.getAttribute('data-translation-ordinal') || 0) - Number(b.getAttribute('data-translation-ordinal') || 0))
					|| aAlias.localeCompare(bAlias);
			});
			entries.forEach(function (entry) {
				targetList.append(entry);
			});
		};
		var sortLoadedTranslationLists = function (order) {
			$('.quran-translation-list').each(function () {
				sortTranslationList($(this), order);
			});
		};
		var bindTranslationDisclosureState = function (entry, alias, fallbackOpen) {
			if (!alias)
				return;
			if (managesTranslationVisibility) {
				setTranslationEntryOpen(entry, true);
				entry.find('.quran-translation-source').on('click', function (event) {
					if ($(event.target).closest('input, button, a, .quran-translation-drag-handle').length)
						return;
					event.preventDefault();
				});
				return;
			}
			var shouldOpen = Object.prototype.hasOwnProperty.call(disclosureState, alias)
				? disclosureState[alias] !== false
				: fallbackOpen !== false;
			setTranslationEntryOpen(entry, shouldOpen);
			entry.on('toggle', function () {
				if (entry.data('quranTranslationDisclosureSyncing'))
					return;
				disclosureState[alias] = entry.prop('open');
				saveTranslationDisclosureState();
				syncTranslationDisclosureEntries(alias, disclosureState[alias] !== false);
			});
		};
		list.find('.quran-translation-entry[data-translation-alias]').each(function () {
			var entry = $(this);
			bindTranslationDisclosureState(entry, entry.attr('data-translation-alias'), true);
		});
		var adminCacheParam = function () {
			return shouldFlushQuranProxyCache() ? '&flush=1' : '';
		};
			var adminQuery = function () {
				return shouldFlushQuranProxyCache() ? '?flush=1' : '';
			};
			var allTranslationBookAliases = [];
			var selectedTranslationAlias = quranSelectedTranslationAliasFromLocation();
			var waitForSettingsAuth = function () {
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
		var enabledTranslationOrderFromList = function () {
			return list.find('.quran-translation-entry[data-translation-alias]').filter(function () {
				return !$(this).hasClass('quran-translation-default') && $(this).attr('data-translation-disabled') !== '1';
			}).map(function () {
				return $(this).attr('data-translation-alias');
			}).get().filter(Boolean);
		};
		var saveTranslationPreferences = async function (disabledAliasesOverride) {
			var auth = await waitForSettingsAuth();
			var user = auth && auth.getUser ? await auth.getUser() : null;
			if (!user)
				throw new Error('Please sign in to save translation settings.');
			var token = auth && auth.requireToken
				? await auth.requireToken('Please sign in once to refresh your local session.')
				: (auth && auth.getToken ? await auth.getToken() : null);
			if (!token)
				throw new Error('Please sign in once to refresh your local session.');
			var settingsResponse = await fetch(quranApiPath('/user-settings?optional=1'), {
				credentials: 'same-origin',
				headers: { 'Authorization': `Bearer ${token}` }
			});
			if (!settingsResponse.ok)
				throw new Error(await responseErrorMessage(settingsResponse, 'Unable to load settings.'));
			var settingsData = await settingsResponse.json();
			var settings = settingsData && settingsData.settings && typeof settingsData.settings === 'object' && !Array.isArray(settingsData.settings)
				? settingsData.settings
				: {};
			var translationSettings = settings.translations && typeof settings.translations === 'object' && !Array.isArray(settings.translations)
				? settings.translations
				: {};
			var disabledAliases = Array.isArray(disabledAliasesOverride)
				? disabledAliasesOverride
				: (Array.isArray(translationSettings.disabledAliases) ? translationSettings.disabledAliases : []);
			var disabledSet = new Set(disabledAliases);
			var visibleOrder = enabledTranslationOrderFromList();
			var order = Array.from(new Set(visibleOrder.concat(
				Array.isArray(translationSettings.order) ? translationSettings.order : [],
				allTranslationBookAliases
			).filter(function (alias) {
				return alias && !disabledSet.has(alias);
			})));
			var preferredAlias = disabledSet.has(translationSettings.preferredAlias) ? '' : (translationSettings.preferredAlias || '');
			var nextSettings = Object.assign({}, settings, {
				translations: Object.assign({}, translationSettings, {
					disabledAliases: Array.from(disabledSet),
					order: order,
					preferredAlias: preferredAlias
				})
			});
			delete nextSettings.personalized;
			var response = await fetch(quranApiPath('/user-settings'), {
				method: 'PUT',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
				body: JSON.stringify({ settings: nextSettings })
			});
			if (!response.ok)
				throw new Error(await responseErrorMessage(response, 'Unable to save translation order.'));
			var data = await response.json();
			var savedSettings = data.settings || nextSettings;
			updateCachedQuranUserSettings(user, savedSettings);
			updateQuranTranslationPreferenceHearts(document, savedSettings.translations && savedSettings.translations.preferredAlias || '');
			applyQuranHeroTranslationAlias(savedSettings.translations && savedSettings.translations.preferredAlias || '', { persist: false }).catch(function () {});
			sortLoadedTranslationLists(savedSettings.translations && Array.isArray(savedSettings.translations.order) ? savedSettings.translations.order : order);
		};
		var saveTranslationOrder = function () {
			return saveTranslationPreferences();
		};
		var bindTranslationDragSort = function () {
			if (list.data('quranTranslationDragBound'))
				return;
			list.data('quranTranslationDragBound', true);
			var dragged = null;
			var startOrder = '';
			var orderSignature = function () {
				return list.find('.quran-translation-entry[data-translation-alias]').filter(function () {
					return !$(this).hasClass('quran-translation-default') && $(this).attr('data-translation-disabled') !== '1';
				}).map(function () {
					return $(this).attr('data-translation-alias');
				}).get().join('|');
			};
			var dropTargetFor = function (y) {
				var rows = list.find('.quran-translation-entry[data-translation-alias]').filter(function () {
					return !this.classList.contains('quran-translation-default')
						&& !this.classList.contains('is-dragging')
						&& this.getAttribute('data-translation-disabled') !== '1';
				}).get();
				return rows.reduce(function (closest, row) {
					var box = row.getBoundingClientRect();
					var offset = y - box.top - (box.height / 2);
					if (offset < 0 && offset > closest.offset)
						return { offset: offset, row: row };
					return closest;
				}, { offset: Number.NEGATIVE_INFINITY, row: null }).row;
			};
			list.on('dragstart', '.quran-translation-entry[data-translation-alias]', function (event) {
				if (this.classList.contains('quran-translation-default')) {
					event.preventDefault();
					return;
				}
				if (this.getAttribute('data-translation-disabled') === '1') {
					event.preventDefault();
					return;
				}
				dragged = this;
				startOrder = orderSignature();
				this.classList.add('is-dragging');
				event.originalEvent.dataTransfer.effectAllowed = 'move';
				event.originalEvent.dataTransfer.setData('text/plain', this.getAttribute('data-translation-alias') || '');
			});
			list.on('dragover', function (event) {
				if (!dragged)
					return;
				event.preventDefault();
				var target = dropTargetFor(event.originalEvent.clientY);
				if (target)
					list[0].insertBefore(dragged, target);
				else {
					var firstDisabled = list.find('.quran-translation-entry[data-translation-disabled="1"]').get(0);
					if (firstDisabled)
						list[0].insertBefore(dragged, firstDisabled);
					else
						list[0].appendChild(dragged);
				}
			});
			list.on('drop', async function (event) {
				if (!dragged)
					return;
				event.preventDefault();
				try {
					if (startOrder !== orderSignature())
						await saveTranslationOrder();
				} catch (err) {
					if (window.toastr)
						toastr.error(err.message || 'Unable to save translation order.', 'Settings');
				}
			});
			list.on('dragend', '.quran-translation-entry[data-translation-alias]', function () {
				this.classList.remove('is-dragging');
				dragged = null;
				startOrder = '';
			});
		};
		var fetchLocalTranslationPayloads = async function (book) {
			if (ayahs.length < 1)
				return [];
			var ayahFrom = Math.min.apply(Math, ayahs);
			var ayahTo = Math.max.apply(Math, ayahs);
			var response = await fetch(`${quranApiPath('/proxy/tafsir/local')}?src=${encodeURIComponent(book.alias)}&s=${encodeURIComponent(surah)}&from=${encodeURIComponent(ayahFrom)}&to=${encodeURIComponent(ayahTo)}&lang=${encodeURIComponent(book.lang || 'en')}${adminCacheParam()}`);
			if (response.status === 404)
				return [];
			if (!response.ok)
				throw new Error('Unable to load translation.');
			var payload = await response.json();
			return Array.isArray(payload.entries) ? payload.entries : [payload];
		};
		var fetchLocalTranslationPayloadsBatch = async function (books) {
			if (ayahs.length < 1 || books.length < 1)
				return new Map();
			var ayahFrom = Math.min.apply(Math, ayahs);
			var ayahTo = Math.max.apply(Math, ayahs);
			var aliases = books.map(function (book) { return book.alias; }).filter(Boolean);
			var response = await fetch(`${quranApiPath('/proxy/translations/local')}?src=${encodeURIComponent(aliases.join(','))}&s=${encodeURIComponent(surah)}&from=${encodeURIComponent(ayahFrom)}&to=${encodeURIComponent(ayahTo)}&lang=en${adminCacheParam()}`);
			if (!response.ok)
				throw new Error('Unable to load translations.');
			var payload = await response.json();
			var payloadsByAlias = new Map();
			(Array.isArray(payload.entries) ? payload.entries : []).forEach(function (entry) {
				if (!entry || !entry.alias || !(entry.html || entry.data))
					return;
				if (!payloadsByAlias.has(entry.alias))
					payloadsByAlias.set(entry.alias, []);
				payloadsByAlias.get(entry.alias).push(entry);
			});
			return payloadsByAlias;
		};
		var setTranslationEntryDisabled = function (entry, disabled) {
			entry.toggleClass('is-disabled', disabled);
			entry.attr('data-translation-disabled', disabled ? '1' : '0');
			entry.attr('draggable', !disabled && !entry.hasClass('quran-translation-default') ? 'true' : 'false');
			entry.find('[data-translation-enable-toggle]').prop('checked', !disabled);
			setTranslationEntryOpen(entry, true);
		};
		var disabledAliasesFromEntries = function () {
			return list.find('.quran-translation-entry[data-translation-alias][data-translation-disabled="1"]').map(function () {
				return $(this).attr('data-translation-alias');
			}).get().filter(Boolean);
		};
		var bindTranslationEnableToggle = function (entry, book) {
			entry.find('[data-translation-enable-toggle]').on('change', async function () {
				var toggle = $(this);
				var previousDisabled = entry.attr('data-translation-disabled') === '1';
				var nextDisabled = !toggle.prop('checked');
				setTranslationEntryDisabled(entry, nextDisabled);
				sortTranslationList(list, enabledTranslationOrderFromList());
				try {
					await saveTranslationPreferences(disabledAliasesFromEntries());
				} catch (err) {
					setTranslationEntryDisabled(entry, previousDisabled);
					sortTranslationList(list, enabledTranslationOrderFromList());
					if (window.toastr)
						toastr.error(err.message || 'Unable to save translation settings.', 'Settings');
				}
			});
			};
			var appendTranslationPreferenceHeart = function (source, book) {
				var alias = book && book.source === 'default' ? '' : (book && book.alias || '');
				var label = quranTranslationBookLabel(book);
				var button = $('<button>').addClass('translation-preference-heart btn btn-link p-0').attr({
					type: 'button',
					'data-quran-translation-preference-heart': '1',
					'data-quran-translation-preference-alias': alias,
					'data-quran-translation-preference-label': label,
					title: `Use ${label} as the default hero translation`,
					'aria-label': `Use ${label} as the default hero translation`,
					'aria-pressed': 'false'
				}).on('click mousedown', function (event) {
					event.preventDefault();
					event.stopPropagation();
				}).appendTo(source);
				$('<i>').addClass('bi bi-heart').attr('aria-hidden', 'true').appendTo(button);
			};
			var appendTranslationSource = function (entry, book) {
				var source = $('<summary>').addClass('quran-translation-source').appendTo(entry);
				var shortName = book.shortName_en || book.shortName || book.alias;
				var authorName = book.author_en || book.author || '';
				var death = (book.death || '').toString().trim();
				if (death && !/\bCE\b/i.test(death))
					death = `${death} CE`;
				var deathLabel = death ? (/^d\./i.test(death) ? death : `d. ${death}`) : '';
				var publishedLabel = book.published_year ? `Pub. ${book.published_year}` : '';
				var bookTitle = [
					book.name_en || book.title || book.alias,
					deathLabel,
					publishedLabel,
					book.publisher || ''
				].filter(Boolean).join(', ');
				if (!managesTranslationVisibility)
					$('<span>').addClass('quran-translation-chevron bi bi-chevron-right').attr('aria-hidden', 'true').appendTo(source);
				$('<strong>').addClass('quran-translation-source-author').attr('title', shortName).text(shortName).appendTo(source);
				if (!book.builtinDefault)
					$('<span>').addClass('quran-translation-drag-handle bi bi-grip-vertical').attr({ 'aria-hidden': 'true', title: 'Drag to reorder' }).on('click', function (event) {
						event.stopPropagation();
					}).appendTo(source);
				appendTranslationPreferenceHeart(source, book);
				if (canManageTranslationVisibility && !book.builtinDefault) {
					var toggleLabel = $('<label>').addClass('quran-translation-enable-toggle form-check form-switch mb-0').attr('title', 'Show this translation').on('click', function (event) {
						event.stopPropagation();
					}).appendTo(source);
					$('<input>').addClass('form-check-input').attr({
						type: 'checkbox',
						'data-translation-enable-toggle': book.alias,
						'aria-label': `Show ${shortName}`
					}).appendTo(toggleLabel);
				}
			if (authorName || bookTitle) {
				var subtitle = $('<span>').addClass('quran-translation-source-title')
					.attr('title', [authorName, bookTitle].filter(Boolean).join(' '))
					.appendTo(source);
				if (authorName)
					$('<span>').addClass('quran-translation-source-full-author').attr('title', authorName).text(authorName).appendTo(subtitle);
				if (bookTitle)
					$('<span>').addClass('quran-translation-source-book-title').attr('title', bookTitle).text(bookTitle).appendTo(subtitle);
			}
		};
		var appendTranslationEntry = function (book, payload, open, disabled) {
			var draggable = !book.builtinDefault && !disabled;
				var entry = $('<details>').addClass('quran-translation-entry').attr({
					lang: book.lang || 'en',
					dir: book.lang === 'ar' ? 'rtl' : 'ltr',
					'data-translation-alias': book.alias,
					'data-translation-ordinal': Number(book.ordinal || 0),
					'data-translation-disabled': disabled ? '1' : '0',
					draggable: draggable ? 'true' : 'false'
				}).appendTo(list);
				if (disabled)
					entry.addClass('is-disabled');
				appendTranslationSource(entry, book);
				bindTranslationDisclosureState(entry, book.alias, open !== false);
				if (canManageTranslationVisibility && !book.builtinDefault)
					bindTranslationEnableToggle(entry, book);
				if (canManageTranslationVisibility)
					setTranslationEntryDisabled(entry, !!disabled);
				$('<div>').addClass('quran-translation-text').html(payload.html || payload.data || '').appendTo(entry);
			};
		Promise.resolve()
			.then(function () {
				return fetch(`${quranApiPath('/proxy/translations/books')}${adminQuery()}`);
			})
			.then(function (response) {
				if (!response.ok)
					throw new Error('Unable to load translation list.');
				return response.json();
			})
			.then(async function (books) {
				var settings = await getQuranTafsirSettings();
				var translationSettings = settings.translations || {};
				var disabledAliases = new Set(Array.isArray(translationSettings.disabledAliases) ? translationSettings.disabledAliases : []);
				var order = Array.isArray(translationSettings.order) ? translationSettings.order : [];
					bindQuranTranslationPreferenceHearts(list[0], translationSettings.preferredAlias || '');
					var orderIndex = new Map(order.map(function (alias, index) { return [alias, index]; }));
					var translationBooks = (Array.isArray(books) ? books : []).filter(function (book) {
						return book.source === 'local';
					});
					allTranslationBookAliases = translationBooks.map(function (book) { return book.alias; }).filter(Boolean);
					var booksToRender = (canManageTranslationVisibility ? translationBooks : translationBooks.filter(function (book) {
						return book.source === 'local' && !disabledAliases.has(book.alias);
					})).sort(function (a, b) {
					var aDisabled = disabledAliases.has(a.alias);
					var bDisabled = disabledAliases.has(b.alias);
					if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
					var aIndex = orderIndex.has(a.alias) ? orderIndex.get(a.alias) : Number.MAX_SAFE_INTEGER;
					var bIndex = orderIndex.has(b.alias) ? orderIndex.get(b.alias) : Number.MAX_SAFE_INTEGER;
					if (aIndex !== bIndex) return aIndex - bIndex;
					return Number(a.ordinal || 0) - Number(b.ordinal || 0);
				});
				list.find('.quran-translation-status').remove();
				var payloadsByAlias = await fetchLocalTranslationPayloadsBatch(booksToRender);
				for (var i = 0; i < booksToRender.length; i++) {
					var book = booksToRender[i];
						var payloads = payloadsByAlias.get(book.alias) || [];
						payloads.forEach(function (payload) {
							if (payload && (payload.html || payload.data))
								appendTranslationEntry(book, payload, selectedTranslationAlias ? book.alias === selectedTranslationAlias : true, disabledAliases.has(book.alias));
						});
					}
					sortTranslationList(list, order);
					bindQuranTranslationPreferenceHearts(list[0], translationSettings.preferredAlias || '');
					if (selectedTranslationAlias) {
						var selectedEntry = list.find(`.quran-translation-entry[data-translation-alias="${cssEscape(selectedTranslationAlias)}"]`).first();
						if (selectedEntry.length) {
							setTranslationEntryOpen(selectedEntry, true);
							window.requestAnimationFrame(function () {
								selectedEntry[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
							});
						}
					}
					bindTranslationDragSort();
				if (window.bindInlineEditors)
					window.bindInlineEditors(list[0]);
				if (list.find('.quran-translation-entry').length < 1)
					list.html('<p class="quran-translation-status text-muted">No translation is available for this ayah.</p>');
			})
			.catch(function (err) {
				list.html('');
				$('<p>').addClass('quran-translation-status text-muted').text(err.message || 'Unable to load translations.').appendTo(list);
			});
	});
}

function defaultQuranTranslationShortName() {
	return typeof window.defaultQuranTranslationShortNameLabel === 'string' && window.defaultQuranTranslationShortNameLabel
		? window.defaultQuranTranslationShortNameLabel
		: 'Abdel Haleem';
}

var quranTranslationBooksPromise = null;

function quranTranslationBooks() {
	if (!quranTranslationBooksPromise) {
		quranTranslationBooksPromise = fetch(`${quranApiPath('/proxy/translations/books')}${shouldFlushQuranProxyCache() ? '?flush=1' : ''}`)
			.then(function (response) {
				if (!response.ok)
					throw new Error('Unable to load translation list.');
				return response.json();
			})
			.then(function (books) {
				books = Array.isArray(books) ? books : [];
				var defaultBook = quranDefaultTranslationBook(books);
				if (defaultBook)
					window.defaultQuranTranslationShortNameLabel = quranTranslationBookLabel(defaultBook);
				return books;
			});
	}
	return quranTranslationBooksPromise;
}

function quranDefaultTranslationBook(books) {
	return (Array.isArray(books) ? books : []).find(function (candidate) {
		return candidate && candidate.type === 'trans' && candidate.source === 'default';
	}) || null;
}

function quranTranslationBookLabel(book) {
	return (book && (book.shortName_en || book.shortName || book.author_en || book.author || book.alias)) || defaultQuranTranslationShortName();
}

function selectableQuranTranslationBooks(books) {
	return (Array.isArray(books) ? books : []).filter(function (book) {
		return book && book.type === 'trans' && (book.source === 'default' || book.source === 'local');
	});
}

function orderedSelectableQuranTranslationBooks(books, settings) {
	var choices = selectableQuranTranslationBooks(books);
	var defaultBook = quranDefaultTranslationBook(choices);
	var translationSettings = settings && settings.translations && typeof settings.translations === 'object' && !Array.isArray(settings.translations)
		? settings.translations
		: {};
	var order = Array.isArray(translationSettings.order) ? translationSettings.order : [];
	var disabled = new Set(Array.isArray(translationSettings.disabledAliases) ? translationSettings.disabledAliases : []);
	var orderIndex = new Map(order.map(function (alias, index) {
		return [alias, index];
	}));
	var localChoices = choices.filter(function (book) {
		return book.source !== 'default';
	}).map(function (book, originalIndex) {
		return { book: book, originalIndex: originalIndex };
	}).sort(function (a, b) {
		var aDisabled = disabled.has(a.book.alias);
		var bDisabled = disabled.has(b.book.alias);
		if (aDisabled !== bDisabled)
			return aDisabled ? 1 : -1;
		var aIndex = orderIndex.has(a.book.alias) ? orderIndex.get(a.book.alias) : Number.MAX_SAFE_INTEGER;
		var bIndex = orderIndex.has(b.book.alias) ? orderIndex.get(b.book.alias) : Number.MAX_SAFE_INTEGER;
		if (aIndex !== bIndex)
			return aIndex - bIndex;
		var ordinal = Number(a.book.ordinal || 0) - Number(b.book.ordinal || 0);
		if (ordinal !== 0)
			return ordinal;
		return a.originalIndex - b.originalIndex;
	}).map(function (entry) {
		return entry.book;
	});
	return defaultBook ? [defaultBook].concat(localChoices) : localChoices;
}

function quranTranslationSelectValue(alias, books) {
	alias = validQuranTranslationAlias(alias);
	var defaultBook = quranDefaultTranslationBook(books);
	return defaultBook && defaultBook.alias === alias ? '' : alias;
}

function stripQuranDisplayFootnoteMarkdown(value) {
	return (value || '').toString()
		.replace(/\r\n?/g, '\n')
		.replace(/(?:^|\n)[ \t]*\[\^[^\]\n]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/g, '\n')
		.replace(/\[\^[^\]\n]+\]/g, '')
		.replace(/(?:\\\[|\[)(?:\\\[|\[)([\s\S]*?)(?:\\\]|\])(?:\\\]|\])/g, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function removeQuranDisplayFootnoteNodes(root) {
	if (!root)
		return;
	root.querySelectorAll('.footnote-ref, .footnotes-sep, .footnotes, .footnote, hr').forEach(function (node) {
		node.remove();
	});
}

function stripQuranDisplayFootnoteHtml(html) {
	var wrapper = document.createElement('div');
	wrapper.innerHTML = html || '';
	removeQuranDisplayFootnoteNodes(wrapper);
	return wrapper.innerHTML.trim();
}

function compactQuranPlainText(value) {
	var wrapper = document.createElement('div');
	var text = stripQuranDisplayFootnoteMarkdown(value);
	wrapper.innerHTML = stripQuranDisplayFootnoteHtml(text);
	return (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
}

function compactQuranTranslationHtml(html) {
	var wrapper = document.createElement('div');
	wrapper.innerHTML = stripQuranDisplayFootnoteMarkdown(html);
	removeQuranDisplayFootnoteNodes(wrapper);
	return wrapper.innerHTML;
}

function compactQuranHeroTranslationHtml(html) {
	var wrapper = document.createElement('div');
	wrapper.innerHTML = compactQuranTranslationHtml(html);
	while (wrapper.children.length === 1 && /^(section|div)$/i.test(wrapper.firstElementChild.tagName)) {
		wrapper.innerHTML = wrapper.firstElementChild.innerHTML;
	}
	if (wrapper.children.length === 1 && /^p$/i.test(wrapper.firstElementChild.tagName))
		return wrapper.firstElementChild.innerHTML;
	return wrapper.innerHTML;
}

function quranTranslationFootnoteIdPart(value) {
	return (value || '').toString().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'translation';
}

function quranSelectedTranslationFootnoteHolder(target) {
	return target ? target.closest('.quran-passage-section')?.querySelector('[data-quran-selected-translation-footnotes="1"]') || null : null;
}

function clearQuranSelectedTranslationFootnotes(root) {
	Array.from((root || document).querySelectorAll('[data-quran-selected-translation-footnotes="1"]')).forEach(function (holder) {
		holder.innerHTML = '';
		holder.classList.add('d-none');
	});
}

function namespaceQuranTranslationFootnotes(wrapper, target, alias) {
	var ref = quranTranslationTargetRef(target);
	var namespace = [
		'quran-translation',
		quranTranslationFootnoteIdPart(alias || 'default'),
		quranTranslationFootnoteIdPart(ref.surah),
		quranTranslationFootnoteIdPart(ref.ayah)
	].join('-');
	wrapper.querySelectorAll('[id]').forEach(function (node) {
		var id = node.getAttribute('id') || '';
		if (!id)
			return;
		node.setAttribute('id', `${namespace}-${id}`);
	});
	wrapper.querySelectorAll('a[href^="#"]').forEach(function (link) {
		var href = link.getAttribute('href') || '';
		if (href.length > 1)
			link.setAttribute('href', `#${namespace}-${href.slice(1)}`);
	});
}

function normalizeQuranSelectedTranslationFootnotes(holder) {
	if (!holder)
		return;
	var nextNumber = 1;
	Array.from(holder.querySelectorAll('.footnotes-list')).forEach(function (list) {
		var items = Array.from(list.querySelectorAll(':scope > .footnote-item'));
		if (items.length < 1)
			return;
		list.setAttribute('start', String(nextNumber));
		nextNumber += items.length;
	});
}

function quranPassageTranslationHtml(html, target, alias) {
	var wrapper = document.createElement('div');
	wrapper.innerHTML = html || '';
	while (wrapper.children.length === 1 && /^(section|div)$/i.test(wrapper.firstElementChild.tagName)) {
		wrapper.innerHTML = wrapper.firstElementChild.innerHTML;
	}
	namespaceQuranTranslationFootnotes(wrapper, target, alias);
	var holder = quranSelectedTranslationFootnoteHolder(target);
	var footnoteNodes = Array.from(wrapper.querySelectorAll('.footnotes-sep, .footnotes, .footnote'));
	footnoteNodes.forEach(function (node) {
		if (holder)
			holder.appendChild(node);
		else
			node.remove();
	});
	if (holder && holder.childNodes.length > 0) {
		normalizeQuranSelectedTranslationFootnotes(holder);
		holder.classList.remove('d-none');
	}
	return wrapper.innerHTML;
}

function quranTranslationTextFromPayload(payload) {
	var html = compactQuranTranslationHtml(payload && (payload.html || payload.data) || '');
	var wrapper = document.createElement('div');
	wrapper.innerHTML = html;
	return (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
}

function quranTranslationTargetHolder(target) {
	if (!target)
		return null;
	var rangeHolder = target.closest('.quran-ayah-hero-body[data-quran-translation-attribution-scope="range"]');
	if (rangeHolder)
		return rangeHolder;
	return target.closest('.quran-ayah-hero-ayah, .body, .quran-share-english-section') || target.parentElement;
}

function quranTranslationTargetRef(target) {
	return {
		surah: target && target.getAttribute('data-quran-surah') || '',
		ayah: target && target.getAttribute('data-quran-ayah') || ''
	};
}

function isQuranOriginalPrefatoryTranslationTarget(target) {
	var ref = quranTranslationTargetRef(target);
	return Number(ref.surah) === 1 && Number(ref.ayah) === 0;
}

function storeDefaultQuranTranslationTarget(target) {
	if (!target)
		return;
	if (target.dataset.quranDefaultTranslationHtml === undefined)
		target.dataset.quranDefaultTranslationHtml = target.innerHTML || '';
	if (target.dataset.quranDefaultTranslationMarkdown === undefined)
		target.dataset.quranDefaultTranslationMarkdown = target.dataset.markdownSource || '';
	if (target.dataset.quranDefaultTranslationEditableClass === undefined)
		target.dataset.quranDefaultTranslationEditableClass = target.classList.contains('_e') ? '1' : '0';
	if (target.dataset.quranDefaultTranslationContenteditable === undefined && target.hasAttribute('contenteditable'))
		target.dataset.quranDefaultTranslationContenteditable = target.getAttribute('contenteditable') || 'true';
}

function setQuranTranslationTargetEditable(target, editable) {
	if (!target || target.dataset.quranDefaultTranslationEditableClass !== '1')
		return;
	if (editable) {
		target.classList.add('_e');
		target.setAttribute('contenteditable', target.dataset.quranDefaultTranslationContenteditable || 'true');
		target.removeAttribute('aria-readonly');
		return;
	}
	target.classList.remove('_e');
	target.setAttribute('contenteditable', 'false');
	target.setAttribute('aria-readonly', 'true');
	target.removeAttribute('editing');
	target.removeAttribute('submitting');
}

function setQuranTranslationAttribution(target, label, alias) {
	var holder = quranTranslationTargetHolder(target);
	var attribution = holder ? holder.querySelector('[data-quran-translation-attribution="1"]') : null;
	if (attribution) {
		attribution.textContent = label ? `— ${label}` : '';
		attribution.setAttribute('role', 'button');
		attribution.setAttribute('tabindex', '0');
		attribution.setAttribute('title', 'Change translation');
		attribution.setAttribute('aria-label', 'Change Quran translation');
	}
	if (target && alias !== undefined)
		target.dataset.quranTranslationAlias = alias || '';
	var selector = holder ? holder.querySelector('[data-quran-translation-selector="1"]') : null;
	if (selector && alias !== undefined)
		selector.value = alias || '';
}

function fetchQuranLocalTranslation(book, surah, ayah) {
	return fetch(`${quranApiPath('/proxy/translations/local')}?src=${encodeURIComponent(book.alias)}&s=${encodeURIComponent(surah)}&a=${encodeURIComponent(ayah)}&lang=${encodeURIComponent(book.lang || 'en')}&render=reader${shouldFlushQuranProxyCache() ? '&flush=1' : ''}`)
		.then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load selected translation.');
			return response.json();
		});
}

var quranLocalTranslationRangePromises = new Map();

function fetchQuranLocalTranslationRange(book, surah, ayahFrom, ayahTo) {
	var alias = book && book.alias || '';
	var lang = book && book.lang || 'en';
	var from = Number(ayahFrom);
	var to = Number(ayahTo);
	var flush = shouldFlushQuranProxyCache();
	var cacheKeyPrefix = `${alias}|${surah}|${lang}|${flush ? 'flush' : 'cache'}|`;
	var coveringPromise = null;
	quranLocalTranslationRangePromises.forEach(function (promise, key) {
		if (coveringPromise || key.indexOf(cacheKeyPrefix) !== 0)
			return;
		var parts = key.slice(cacheKeyPrefix.length).split('-').map(Number);
		if (parts.length === 2 && parts[0] <= from && parts[1] >= to)
			coveringPromise = promise;
	});
	if (coveringPromise)
		return coveringPromise;
	var cacheKey = `${cacheKeyPrefix}${from}-${to}`;
	var requestPromise = fetch(`${quranApiPath('/proxy/translations/local')}?src=${encodeURIComponent(alias)}&s=${encodeURIComponent(surah)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&lang=${encodeURIComponent(lang)}&render=reader${flush ? '&flush=1' : ''}`)
		.then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load selected translation.');
			return response.json();
		});
	quranLocalTranslationRangePromises.set(cacheKey, requestPromise);
	return requestPromise.catch(function (err) {
		quranLocalTranslationRangePromises.delete(cacheKey);
		throw err;
	});
}

function applyQuranTranslationEntryToTarget(target, book, entry) {
	if (!entry || !(entry.html || entry.data))
		return;
	var alias = book && book.source !== 'default' ? book.alias : '';
	target.innerHTML = target.getAttribute('data-quran-translation-display') === 'passage'
		? quranPassageTranslationHtml(entry.html || entry.data, target, alias)
		: compactQuranHeroTranslationHtml(entry.html || entry.data);
	target.dataset.markdownSource = entry.data || '';
	setQuranTranslationAttribution(target, quranTranslationBookLabel(book), alias);
}

function quranPrefatoryTranslationEntry(entry, surah) {
	if (!entry || Number(surah) === 1)
		return entry;
	return Object.assign({}, entry, {
		html: compactQuranTranslationHtml(entry.html || entry.data || ''),
		data: stripQuranDisplayFootnoteMarkdown(entry.data || '')
	});
}

function clearMergedQuranTranslationContinuationTarget(target, book) {
	if (!target)
		return;
	target.innerHTML = '';
	target.dataset.markdownSource = '';
	var alias = book && book.source !== 'default' ? book.alias : '';
	if (alias !== undefined)
		target.dataset.quranTranslationAlias = alias || '';
}

function showUnavailableQuranTranslationTarget(target, book) {
	if (!target)
		return;
	var message = 'Content is not available for this ayah.';
	target.textContent = message;
	target.dataset.markdownSource = message;
	var alias = book && book.source !== 'default' ? book.alias : '';
	setQuranTranslationAttribution(target, quranTranslationBookLabel(book), alias);
}

function applyQuranTranslationToTarget(target, book) {
	storeDefaultQuranTranslationTarget(target);
	var alias = book && book.source !== 'default' ? book.alias : '';
	if (!book || book.source === 'default') {
		setQuranTranslationTargetEditable(target, true);
		target.innerHTML = target.dataset.quranDefaultTranslationHtml || '';
		target.dataset.markdownSource = target.dataset.quranDefaultTranslationMarkdown || '';
		setQuranTranslationAttribution(target, defaultQuranTranslationShortName(), alias);
		return Promise.resolve();
	}
	setQuranTranslationTargetEditable(target, false);
	var ref = quranTranslationTargetRef(target);
	if (!ref.surah || !ref.ayah)
		return Promise.resolve();
	if (isQuranOriginalPrefatoryTranslationTarget(target))
		return Promise.resolve();
	var requestSurah = ref.ayah === '0' ? '1' : ref.surah;
	var requestAyah = ref.ayah === '0' ? '1' : ref.ayah;
	return fetchQuranLocalTranslation(book, requestSurah, requestAyah).then(function (payload) {
		var entry = Array.isArray(payload && payload.entries) ? payload.entries[0] : payload;
		if (ref.ayah === '0')
			entry = quranPrefatoryTranslationEntry(entry, ref.surah);
		if (entry && (entry.html || entry.data))
			applyQuranTranslationEntryToTarget(target, book, entry);
		else
			showUnavailableQuranTranslationTarget(target, book);
	});
}

function quranTranslationTargetAyahNumber(target) {
	var ref = quranTranslationTargetRef(target);
	var ayah = Number(ref.ayah);
	return Number.isInteger(ayah) && ayah >= 0 ? ayah : NaN;
}

function quranTranslationTargetPassageScope(target) {
	return target && target.closest('.quran-passage-section, [data-quran-selected-ayah-hero], .quran-share-root, .quran-ayah-modal-pane') || target;
}

function applyQuranTranslationToTargets(targets, book) {
	targets = Array.isArray(targets) ? targets : [];
	if (!book || book.source === 'default')
		return Promise.all(targets.map(function (target) {
			return applyQuranTranslationToTarget(target, book);
		}));
	var prefatoryTargets = targets.filter(function (target) {
		return quranTranslationTargetAyahNumber(target) === 0;
	});
	var regularTargets = targets.filter(function (target) {
		return quranTranslationTargetAyahNumber(target) !== 0;
	});
	var targetsByPassage = new Map();
	var prefatoryPromises = prefatoryTargets.map(function (target) {
		storeDefaultQuranTranslationTarget(target);
		setQuranTranslationTargetEditable(target, false);
		if (isQuranOriginalPrefatoryTranslationTarget(target))
			return Promise.resolve();
		var ref = quranTranslationTargetRef(target);
		if (!ref.surah)
			return Promise.resolve();
		return fetchQuranLocalTranslation(book, '1', '1').then(function (payload) {
			var entry = Array.isArray(payload && payload.entries) ? payload.entries[0] : payload;
			entry = quranPrefatoryTranslationEntry(entry, ref.surah);
			applyQuranTranslationEntryToTarget(target, book, entry);
		});
	});
	regularTargets.forEach(function (target) {
		storeDefaultQuranTranslationTarget(target);
		setQuranTranslationTargetEditable(target, false);
		var ref = quranTranslationTargetRef(target);
		var ayah = quranTranslationTargetAyahNumber(target);
		if (!ref.surah || !Number.isInteger(ayah))
			return;
		var passageScope = quranTranslationTargetPassageScope(target);
		if (!targetsByPassage.has(passageScope))
			targetsByPassage.set(passageScope, []);
		targetsByPassage.get(passageScope).push(target);
	});
	var passagePromises = Array.from(targetsByPassage.values()).map(function (passageTargets) {
		var targetsBySurah = new Map();
		passageTargets.forEach(function (target) {
			var ref = quranTranslationTargetRef(target);
			if (!targetsBySurah.has(ref.surah))
				targetsBySurah.set(ref.surah, []);
			targetsBySurah.get(ref.surah).push(target);
		});
		return Promise.all(Array.from(targetsBySurah.entries()).map(function (entry) {
			var surah = entry[0];
			var surahTargets = entry[1];
			var ayahs = surahTargets.map(quranTranslationTargetAyahNumber).filter(Number.isInteger);
			var ayahFrom = Math.min.apply(Math, ayahs);
			var ayahTo = Math.max.apply(Math, ayahs);
			if (!Number.isInteger(ayahFrom) || !Number.isInteger(ayahTo))
				return Promise.resolve();
			return fetchQuranLocalTranslationRange(book, surah, ayahFrom, ayahTo).then(function (payload) {
				var entries = Array.isArray(payload && payload.entries) ? payload.entries : [payload];
				var targetsByAyah = new Map();
				var coveredAyahs = new Set();
				surahTargets.forEach(function (target) {
					targetsByAyah.set(quranTranslationTargetAyahNumber(target), target);
				});
				entries.filter(Boolean).sort(function (a, b) {
					var aStart = Number(a.ayahs_start);
					var bStart = Number(b.ayahs_start);
					if (aStart !== bStart)
						return aStart - bStart;
					return Number(a.count || 0) - Number(b.count || 0);
				}).forEach(function (payloadEntry) {
					var start = Number(payloadEntry.ayahs_start);
					var count = Math.max(0, Number(payloadEntry.count) || 0);
					if (!Number.isInteger(start))
						return;
					var coveredTargets = [];
					for (var ayah = start; ayah <= start + count; ayah++) {
						var coveredTarget = targetsByAyah.get(ayah);
						if (coveredTarget)
							coveredTargets.push(coveredTarget);
					}
					if (coveredTargets.length < 1)
						return;
					coveredTargets.forEach(function (target) {
						coveredAyahs.add(quranTranslationTargetAyahNumber(target));
					});
					applyQuranTranslationEntryToTarget(coveredTargets[0], book, payloadEntry);
					coveredTargets.slice(1).forEach(function (target) {
						clearMergedQuranTranslationContinuationTarget(target, book);
					});
				});
				surahTargets.forEach(function (target) {
					if (!coveredAyahs.has(quranTranslationTargetAyahNumber(target)))
						showUnavailableQuranTranslationTarget(target, book);
				});
			});
		}));
	});
	return Promise.all(prefatoryPromises.concat(passagePromises));
}

var QURAN_SELECTED_TRANSLATION_STORAGE_KEY = 'hadithdb.quran.selectedTranslationAlias';

function validQuranTranslationAlias(value) {
	value = (value || '').toString().trim();
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

function quranSelectedTranslationAliasFromLocation() {
	try {
		var queryAlias = validQuranTranslationAlias(new URLSearchParams(window.location.search).get('translation') || '');
		if (queryAlias)
			return queryAlias;
		var pathMatch = window.location.pathname.match(/^\/quran\/([^/]+)\/\d+\/\d+(?:\/|$)/);
		var alias = pathMatch ? validQuranTranslationAlias(decodeURIComponent(pathMatch[1] || '')) : '';
		return alias && !/^\d+$/.test(alias) && !['tafsir', 'translations', 'corpus', 'settings', 'login', 'proxy', 'comments', 'user-settings'].includes(alias)
			? alias
			: '';
	} catch (_err) {
		return '';
	}
}

function quranCurrentPassagePartsFromLocation() {
	var path = window.location.pathname || '';
	var aliasMatch = path.match(/^\/quran\/[^/]+\/(\d+)\/(\d+)(?:\/|$)/);
	var plainMatch = path.match(/^\/quran\/(\d+)\/(\d+)(?:\/|$)/);
	var match = aliasMatch || plainMatch;
	return match ? { surah: match[1], passage: match[2] } : null;
}

function quranTranslationPassageUrl(alias) {
	alias = validQuranTranslationAlias(alias);
	var parts = quranCurrentPassagePartsFromLocation();
	if (!parts)
		return '';
	var path = alias
		? `/quran/${encodeURIComponent(alias)}/${parts.surah}/${parts.passage}`
		: `/quran/${parts.surah}/${parts.passage}`;
	var params = new URLSearchParams(window.location.search || '');
	params.delete('translation');
	var query = params.toString();
	return quranUrl(`${path}${query ? `?${query}` : ''}`);
}

function storedQuranSelectedTranslationAlias() {
	try {
		return validQuranTranslationAlias(window.sessionStorage && window.sessionStorage.getItem(QURAN_SELECTED_TRANSLATION_STORAGE_KEY) || '');
	} catch (_err) {
		return '';
	}
}

function storeQuranSelectedTranslationAlias(alias) {
	alias = validQuranTranslationAlias(alias);
	try {
		if (!window.sessionStorage)
			return;
		if (alias)
			window.sessionStorage.setItem(QURAN_SELECTED_TRANSLATION_STORAGE_KEY, alias);
		else
			window.sessionStorage.removeItem(QURAN_SELECTED_TRANSLATION_STORAGE_KEY);
	} catch (_err) {}
}

function applyQuranHeroTranslationAlias(alias, options) {
	options = options || {};
	return quranTranslationBooks().then(function (books) {
		var book = alias ? books.find(function (candidate) { return candidate && candidate.alias === alias; }) : quranDefaultTranslationBook(books);
		if (!book)
			book = quranDefaultTranslationBook(books);
		var selectedAlias = book && book.source !== 'default' ? book.alias : '';
		var root = options.root || document;
		var targets = Array.from(root.querySelectorAll('[data-quran-translation-target="1"]'));
		clearQuranSelectedTranslationFootnotes(root);
		return applyQuranTranslationToTargets(targets, book).catch(function () {
			return applyQuranTranslationToTargets(targets, quranDefaultTranslationBook(books));
		}).then(function () {
			if (options.persist)
				saveQuranPreferredTranslationAlias(selectedAlias).catch(function (err) {
					if (window.toastr)
						toastr.error(err.message || 'Unable to save translation preference.', 'Settings');
				});
			return book;
		});
	});
}

function updateQuranTranslationPreferenceHearts(root, preferredAlias) {
	var scope = root || document;
	preferredAlias = validQuranTranslationAlias(preferredAlias);
	Array.from(scope.querySelectorAll('[data-quran-translation-preference-heart="1"]')).forEach(function (button) {
		var alias = validQuranTranslationAlias(button.getAttribute('data-quran-translation-preference-alias') || '');
		var label = button.getAttribute('data-quran-translation-preference-label') || quranTranslationBookLabel({ alias: alias }) || defaultQuranTranslationShortName();
		var isPreferred = alias === preferredAlias;
		var disabled = button.closest('.quran-translation-entry')?.getAttribute('data-translation-disabled') === '1';
		button.classList.toggle('is-preferred', isPreferred);
		button.setAttribute('aria-pressed', isPreferred ? 'true' : 'false');
		button.disabled = disabled;
		button.title = isPreferred
			? `${label} is the default hero translation`
			: `Use ${label} as the default hero translation`;
		button.setAttribute('aria-label', button.title);
		var icon = button.querySelector('i');
		if (icon)
			icon.className = `bi ${isPreferred ? 'bi-heart-fill' : 'bi-heart'}`;
	});
}

function bindQuranTranslationPreferenceHearts(root, preferredAlias) {
	var scope = root || document;
	updateQuranTranslationPreferenceHearts(scope, preferredAlias);
	Array.from(scope.querySelectorAll('[data-quran-translation-preference-heart="1"]')).forEach(function (button) {
		if (button.dataset.quranTranslationPreferenceHeartBound === 'true')
			return;
		button.dataset.quranTranslationPreferenceHeartBound = 'true';
		button.addEventListener('mousedown', function (event) {
			event.stopPropagation();
		});
		button.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			if (button.disabled)
				return;
			var alias = validQuranTranslationAlias(button.getAttribute('data-quran-translation-preference-alias') || '');
			var previousPreferred = document.querySelector('[data-quran-translation-preference-heart="1"].is-preferred');
			var previousAlias = previousPreferred
				? (previousPreferred.getAttribute('data-quran-translation-preference-alias') || '').toString().trim()
				: '';
			updateQuranTranslationPreferenceHearts(document, alias);
			saveQuranPreferredTranslationAlias(alias).then(function () {
				updateQuranTranslationPreferenceHearts(document, alias);
				return applyQuranHeroTranslationAlias(alias, { persist: false });
			}).catch(function (err) {
				updateQuranTranslationPreferenceHearts(document, previousAlias);
				applyQuranHeroTranslationAlias(previousAlias, { persist: false }).catch(function () {});
				if (window.toastr)
					toastr.error(err.message || 'Unable to save default translation.', 'Settings');
			});
		});
	});
}

function setQuranPassageTranslationSelectValue(alias) {
	alias = validQuranTranslationAlias(alias);
	document.querySelectorAll('[data-quran-passage-translation-select="1"]').forEach(function (selector) {
		selector.value = alias;
	});
}

function quranPassageDisplayStorageKey() {
	return 'hadithdb.quranPassageDisplay';
}

function storedQuranPassageDisplay() {
	var fallback = { translation: true, arabic: true };
	try {
		var stored = JSON.parse(window.localStorage.getItem(quranPassageDisplayStorageKey()) || '{}');
		var state = {
			translation: stored.translation !== false,
			arabic: stored.arabic !== false
		};
		if (!state.translation && !state.arabic)
			return fallback;
		return state;
	} catch (err) {
		return fallback;
	}
}

function storeQuranPassageDisplay(state) {
	try {
		window.localStorage.setItem(quranPassageDisplayStorageKey(), JSON.stringify({
			translation: state.translation !== false,
			arabic: state.arabic !== false
		}));
	} catch (err) {}
}

function applyQuranPassageDisplay(state) {
	state = {
		translation: state && state.translation !== false,
		arabic: state && state.arabic !== false
	};
	if (!state.translation && !state.arabic)
		state.translation = true;
	document.documentElement.classList.toggle('quran-hide-arabic-audio', !state.arabic);
	if (!state.arabic && typeof quranPassageAudioState !== 'undefined' && quranPassageAudioState.control)
		stopQuranPassageAudio(quranPassageAudioState.control);
	document.querySelectorAll('.quran-passage-section').forEach(function (section) {
		section.classList.toggle('quran-hide-translation', !state.translation);
		section.classList.toggle('quran-hide-arabic', !state.arabic);
	});
	document.querySelectorAll('[data-quran-passage-display-toggle]').forEach(function (button) {
		var target = button.getAttribute('data-quran-passage-display-toggle');
		var active = target === 'arabic' ? state.arabic : state.translation;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', active ? 'true' : 'false');
		button.setAttribute('title', active
			? (target === 'arabic' ? 'Hide Quran Arabic' : 'Hide translation')
			: (target === 'arabic' ? 'Show Quran Arabic' : 'Show translation'));
		button.setAttribute('aria-label', button.getAttribute('title'));
		var icon = button.querySelector('.bi');
		if (icon) {
			icon.classList.toggle('bi-eye', active);
			icon.classList.toggle('bi-eye-slash', !active);
		}
	});
	return state;
}

function initQuranPassageDisplayToggles(root) {
	var scope = root || document;
	var buttons = Array.from(scope.querySelectorAll('[data-quran-passage-display-toggle]')).filter(function (button) {
		if (button.dataset.quranPassageDisplayBound === 'true')
			return false;
		button.dataset.quranPassageDisplayBound = 'true';
		return true;
	});
	if (document.querySelectorAll('.quran-passage-section').length < 1 || buttons.length < 1)
		return;
	var state = applyQuranPassageDisplay(storedQuranPassageDisplay());
	buttons.forEach(function (button) {
		button.addEventListener('click', function () {
			var target = button.getAttribute('data-quran-passage-display-toggle');
			var next = {
				translation: state.translation,
				arabic: state.arabic
			};
			if (target === 'arabic')
				next.arabic = !next.arabic;
			else
				next.translation = !next.translation;
			if (!next.translation && !next.arabic)
				return;
			state = applyQuranPassageDisplay(next);
			storeQuranPassageDisplay(state);
		});
	});
}

function initQuranPassageTranslationSelects(root) {
	var scope = root || document;
	var selectors = Array.from(scope.querySelectorAll('[data-quran-passage-translation-select="1"]')).filter(function (selector) {
		if (selector.dataset.quranPassageTranslationSelectBound === 'true')
			return false;
		selector.dataset.quranPassageTranslationSelectBound = 'true';
		return true;
	});
	if (selectors.length < 1)
		return;
	Promise.all([quranTranslationBooks(), getQuranTafsirSettings().catch(function () { return {}; })]).then(function (results) {
		var settings = results[1] || {};
		var preferredAlias = settings.translations && settings.translations.preferredAlias || '';
		var selectedTranslationAlias = quranSelectedTranslationAliasFromLocation();
		var choices = orderedSelectableQuranTranslationBooks(results[0], settings).filter(function (book) {
			return book && (book.source === 'default' || book.source === 'local');
		});
		selectors.forEach(function (selector) {
			selector.innerHTML = '';
			choices.forEach(function (book) {
				var option = document.createElement('option');
				option.value = book.source === 'default' ? '' : book.alias;
				option.textContent = quranTranslationBookLabel(book);
				selector.appendChild(option);
			});
			var preferredSelectValue = quranTranslationSelectValue(preferredAlias || '', choices);
			if (!selectedTranslationAlias && preferredSelectValue) {
				var preferredUrl = quranTranslationPassageUrl(preferredSelectValue);
				if (preferredUrl) {
					window.location.replace(preferredUrl);
					return;
				}
			}
			selector.value = quranTranslationSelectValue(selectedTranslationAlias || '', choices);
			syncQuranAudioTranslationMenu(selector);
			bindQuranDynamicTranslationMenu(selector);
			selector.addEventListener('change', function () {
				var alias = validQuranTranslationAlias(selector.value || '');
				selector.disabled = true;
				window.quranTranslationUserSelectedAt = Date.now();
				setQuranPassageTranslationSelectValue(alias);
				syncQuranAudioTranslationSelection(alias);
				syncQuranAudioTranslationMenu(selector);
				saveQuranPreferredTranslationAlias(alias).then(function () {
					updateQuranTranslationPreferenceHearts(document, alias);
					var targetUrl = quranTranslationPassageUrl(alias);
					if (targetUrl) {
						window.location.href = targetUrl;
						return;
					}
					return applyQuranHeroTranslationAlias(alias, { persist: false });
				}).catch(function (err) {
					if (window.toastr)
						toastr.error(err.message || 'Unable to load selected translation.', 'Settings');
				}).finally(function () {
					selector.disabled = false;
				});
			});
		});
	}).catch(function () {});
}

var quranPassageAudioRecitationsPromise = null;
var quranPassageAudioPlaybackRates = [
	{ value: 1, label: 'x1' },
	{ value: 1.25, label: 'x1.25' },
	{ value: 1.5, label: 'x1.5' },
	{ value: 2, label: 'x2.0' },
	{ value: 2.5, label: 'x2.5' },
	{ value: 3, label: 'x3' }
];

function quranPassageAudioPlaybackRateStorageKey() {
	return 'hadithdb.quranPassagePlaybackRate';
}

function storedQuranPassageAudioPlaybackRate() {
	try {
		var stored = Number(window.sessionStorage && window.sessionStorage.getItem(quranPassageAudioPlaybackRateStorageKey()));
		return quranPassageAudioPlaybackRates.some(function (option) {
			return option.value === stored;
		}) ? stored : 1;
	} catch (_err) {
		return 1;
	}
}

function storeQuranPassageAudioPlaybackRate(rate) {
	try {
		if (window.sessionStorage)
			window.sessionStorage.setItem(quranPassageAudioPlaybackRateStorageKey(), Number(rate).toString());
	} catch (_err) {}
}

var quranPassageAudioState = {
	activeObjectUrl: '',
	audio: null,
	control: null,
	errorCount: 0,
	extending: null,
	index: 0,
	paused: false,
	playlist: [],
	preloadAbortController: null,
	preloadAudio: null,
	preloadedObjectUrl: '',
	preloadedUrl: '',
	playbackRate: storedQuranPassageAudioPlaybackRate(),
	repeat: false,
	requestId: 0,
	singleAyah: false,
	sourceUrl: '',
	tailControl: null
};
var quranAudioTranslationMarqueeState = {
	activeVerseKey: '',
	animation: null,
	attributionSignature: '',
	audioAttributionShown: false,
	cache: new Map(),
	playbackRate: null,
	renderedVerseKeys: [],
	requestId: 0,
	selectionVerseKey: ''
};

function quranAudioLatinDigits(value) {
	return (value || '').toString()
		.replace(/[٠-٩]/g, function (digit) {
			return '٠١٢٣٤٥٦٧٨٩'.indexOf(digit).toString();
		})
		.replace(/[۰-۹]/g, function (digit) {
			return '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit).toString();
		});
}

function quranAudioInteger(value) {
	var number = parseInt(quranAudioLatinDigits(value).replace(/\D/g, ''), 10);
	return Number.isInteger(number) ? number : null;
}

function quranAudioRefParts(value) {
	value = quranAudioLatinDigits(value).replace(/^quran:/, '');
	var parts = value.split(/[:/-]/).filter(Boolean);
	return {
		surah: quranAudioInteger(parts[0] || ''),
		ayah: quranAudioInteger(parts[1] || '')
	};
}

function quranAudioRefKey(ref) {
	if (!ref || !Number.isInteger(ref.surah) || !Number.isInteger(ref.ayah))
		return '';
	return `${ref.surah}:${ref.ayah}`;
}

function ensureQuranAudioTranslationMarquee() {
	var marquee = document.querySelector('[data-quran-audio-translation-marquee]');
	if (marquee)
		return marquee;
	var footer = document.querySelector('.mobile-bottom-nav');
	if (!footer)
		return null;
	marquee = document.createElement('div');
	marquee.className = 'quran-audio-translation-marquee';
	marquee.hidden = true;
	marquee.setAttribute('data-quran-audio-translation-marquee', '1');
	marquee.setAttribute('role', 'status');
	marquee.setAttribute('aria-live', 'polite');
	marquee.innerHTML = '<span class="quran-audio-translation-marquee-track" data-quran-audio-translation-marquee-track></span>';
	footer.parentNode.insertBefore(marquee, footer);
	if (document.documentElement.dataset.quranAudioTranslationMarqueeResizeBound !== 'true') {
		document.documentElement.dataset.quranAudioTranslationMarqueeResizeBound = 'true';
		window.addEventListener('resize', function () {
			var activeMarquee = document.querySelector('[data-quran-audio-translation-marquee]');
			if (activeMarquee && !activeMarquee.hidden)
				positionQuranAudioTranslationMarquee(activeMarquee);
		});
	}
	return marquee;
}

function positionQuranAudioTranslationMarquee(marquee) {
	var footer = document.querySelector('.mobile-bottom-nav');
	if (!marquee || !footer)
		return;
	marquee.style.bottom = `${Math.max(0, footer.getBoundingClientRect().height)}px`;
}

function quranAudioTranslationDirection(text, language) {
	language = (language || '').toString().toLowerCase();
	if (/^(ar|fa|ur|he|ps|sd)(?:-|$)/.test(language))
		return 'rtl';
	var rtlCharacters = ((text || '').match(/[\u0590-\u08ff]/g) || []).length;
	var letterCharacters = ((text || '').match(/[A-Za-z\u0590-\u08ff]/g) || []).length;
	return letterCharacters && rtlCharacters / letterCharacters > 0.4 ? 'rtl' : 'ltr';
}

function selectedQuranAudioTranslationBook() {
	return Promise.all([quranTranslationBooks(), getQuranTafsirSettings().catch(function () { return {}; })]).then(function (results) {
		var books = results[0] || [];
		var settings = results[1] || {};
		var alias = quranSelectedTranslationAliasFromLocation()
			|| storedQuranSelectedTranslationAlias()
			|| settings.translations && settings.translations.preferredAlias
			|| '';
		return (alias && books.find(function (book) { return book && book.alias === alias; }))
			|| quranDefaultTranslationBook(books);
	});
}

function defaultQuranAudioTranslation(ref) {
	return fetch(quranUrl(`/quran:${ref.surah}:${ref.ayah}?json=1`), {
		credentials: 'same-origin',
		headers: { Accept: 'application/json' }
	}).then(function (response) {
		if (!response.ok)
			throw new Error('Unable to load Quran translation.');
		return response.json();
	}).then(function (payload) {
		var ayah = Array.isArray(payload) ? payload[0] : payload;
		return ayah && ayah.en && ayah.en.body ? ayah.en.body.toString().replace(/\s+/g, ' ').trim() : '';
	});
}

function quranAudioTranslationPlainText(value) {
	var wrapper = document.createElement('div');
	wrapper.innerHTML = stripQuranDisplayFootnoteMarkdown(value || '');
	removeQuranDisplayFootnoteNodes(wrapper);
	wrapper.querySelectorAll('sup, sub, [role="doc-noteref"], [role="doc-endnote"], a[href^="#fn"], a[href*="-fn"]').forEach(function (node) {
		node.remove();
	});
	return (wrapper.textContent || '')
		.replace(/[\u00b9\u00b2\u00b3\u2070-\u209c\u2460-\u2473]+/g, '')
		.replace(/(?:\[\s*\d+\s*\]|\(\s*\d+\s*\))/g, '')
		.replace(/(?:^|\s)[*†‡§]+(?=\s|[.,;:!?]|$)/g, ' ')
		.replace(/\\([\\`*{}[\]()#+.!_>-])/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

function quranAudioTranslation(ref) {
	return selectedQuranAudioTranslationBook().then(function (book) {
		if (!book)
			return { text: '', direction: 'ltr', language: 'en' };
		var cacheKey = `${book.alias || 'default'}|${ref.surah}:${ref.ayah}`;
		if (quranAudioTranslationMarqueeState.cache.has(cacheKey))
			return quranAudioTranslationMarqueeState.cache.get(cacheKey);
		var request = (book.source === 'default'
			? defaultQuranAudioTranslation(ref)
			: fetchQuranLocalTranslation(book, ref.surah, ref.ayah).then(function (payload) {
				var entry = Array.isArray(payload && payload.entries) ? payload.entries[0] : payload;
				return entry && (entry.html || entry.data) || '';
			})).then(function (text) {
			text = quranAudioTranslationPlainText(text);
			return {
				text: text,
				direction: quranAudioTranslationDirection(text, book.lang),
				language: book.lang || 'en',
				translator: quranTranslationBookLabel(book)
			};
		});
		quranAudioTranslationMarqueeState.cache.set(cacheKey, request);
		return request.catch(function (err) {
			quranAudioTranslationMarqueeState.cache.delete(cacheKey);
			throw err;
		});
	});
}

function hideQuranAudioTranslationMarquee() {
	quranAudioTranslationMarqueeState.requestId += 1;
	quranAudioTranslationMarqueeState.activeVerseKey = '';
	quranAudioTranslationMarqueeState.attributionSignature = '';
	quranAudioTranslationMarqueeState.audioAttributionShown = false;
	quranAudioTranslationMarqueeState.playbackRate = null;
	quranAudioTranslationMarqueeState.renderedVerseKeys = [];
	quranAudioTranslationMarqueeState.selectionVerseKey = '';
	if (quranAudioTranslationMarqueeState.animation) {
		quranAudioTranslationMarqueeState.animation.cancel();
		quranAudioTranslationMarqueeState.animation = null;
	}
	var marquee = document.querySelector('[data-quran-audio-translation-marquee]');
	if (marquee) {
		marquee.hidden = true;
		marquee.classList.remove('is-static');
	}
}

function quranAudioTranslationMarqueeEntry(item, translation, reciter, includeCredits, referenceLabel) {
	var ref = quranAudioRefParts(item && item.verseKey || '');
	var entry = document.createElement('span');
	entry.className = 'quran-audio-translation-marquee-entry';
	entry.dataset.quranAudioVerseKey = quranAudioRefKey(ref);
	var translator = translation.translator || defaultQuranTranslationShortName();
	if (includeCredits) {
		var attribution = document.createElement('span');
		attribution.className = 'quran-audio-translation-marquee-attribution';
		attribution.dir = 'ltr';
		attribution.textContent = `${[reciter, translator].filter(Boolean).join(' · ')} ·`;
		entry.appendChild(attribution);
	}
	var ayah = document.createElement('span');
	ayah.className = 'quran-audio-translation-marquee-ayah';
	var reference = document.createElement('sup');
	reference.className = 'quran-audio-translation-marquee-reference';
	reference.textContent = referenceLabel || `${ref.surah}:${ref.ayah}`;
	ayah.appendChild(reference);
	var text = document.createElement('span');
	text.className = 'quran-audio-translation-marquee-text';
	text.dir = translation.direction;
	text.lang = translation.language || (translation.direction === 'rtl' ? 'ar' : 'en');
	text.textContent = translation.text;
	ayah.appendChild(text);
	entry.appendChild(ayah);
	return entry;
}

function quranAudioTranslationMarqueeItems(item) {
	var playlist = quranPassageAudioState.playlist || [];
	var index = quranPassageAudioState.index;
	if (!playlist[index] || playlist[index].verseKey !== item.verseKey)
		index = playlist.indexOf(item);
	if (index < 0)
		return [item];
	return playlist.slice(index, index + 12);
}

function quranAudioTranslationMarqueeSeconds(item, first, audio, translation) {
	var startSeconds = first && audio
		? Number(audio.currentTime)
		: Number(item && item.startMs) / 1000;
	var endSeconds = Number(item && item.endMs) / 1000;
	var seconds = Number.isFinite(startSeconds) && Number.isFinite(endSeconds)
		? endSeconds - startSeconds
		: NaN;
	if (!Number.isFinite(seconds) || seconds <= 0)
		seconds = Math.max(4, (translation && translation.text || '').length / 12);
	return Math.max(.75, seconds) / Math.max(1, Number(quranPassageAudioState.playbackRate) || 1);
}

function setQuranAudioTranslationMarqueeActiveVerse(verseKey) {
	document.querySelectorAll('.quran-audio-translation-marquee-entry').forEach(function (entry) {
		entry.classList.toggle('is-audio-active', entry.dataset.quranAudioVerseKey === verseKey);
	});
}

function showQuranAudioTranslationMarquee(item, options) {
	options = options || {};
	var ref = quranAudioRefParts(item && item.verseKey || '');
	var audio = options.selection ? null : quranPassageAudioState.audio;
	if (!Number.isInteger(ref.surah) || !Number.isInteger(ref.ayah) || (!audio && !options.selection))
		return hideQuranAudioTranslationMarquee();
	var verseKey = quranAudioRefKey(ref);
	if (options.selection)
		quranAudioTranslationMarqueeState.selectionVerseKey = verseKey;
	else if (quranAudioTranslationMarqueeState.selectionVerseKey)
		return;
	var playbackRate = Number(quranPassageAudioState.playbackRate) || 1;
	var activeMarquee = document.querySelector('[data-quran-audio-translation-marquee]');
	if (!options.selection && !options.force
		&& quranAudioTranslationMarqueeState.playbackRate === playbackRate
		&& quranAudioTranslationMarqueeState.audioAttributionShown
		&& quranAudioTranslationMarqueeState.renderedVerseKeys.includes(verseKey)
		&& activeMarquee && !activeMarquee.hidden)
	{
		quranAudioTranslationMarqueeState.activeVerseKey = verseKey;
		setQuranAudioTranslationMarqueeActiveVerse(verseKey);
		return;
	}
	var requestId = quranAudioTranslationMarqueeState.requestId + 1;
	quranAudioTranslationMarqueeState.requestId = requestId;
	var items = options.selection ? [item] : quranAudioTranslationMarqueeItems(item);
	Promise.all(items.map(function (queueItem) {
		return quranAudioTranslation(quranAudioRefParts(queueItem.verseKey)).then(function (translation) {
			return { item: queueItem, translation: translation };
		}).catch(function () { return null; });
	})).then(function (queue) {
		queue = queue.filter(function (entry) {
			return entry && entry.translation && entry.translation.text;
		});
		if (quranAudioTranslationMarqueeState.requestId !== requestId
			|| (!options.selection && !quranPassageAudioState.control) || !queue.length)
			return;
		var marquee = ensureQuranAudioTranslationMarquee();
		var track = marquee && marquee.querySelector('[data-quran-audio-translation-marquee-track]');
		if (!marquee || !track)
			return;
		track.innerHTML = '';
		var reciter = options.selection ? '' : quranPassageAudioReciterLabel(quranPassageAudioState.control);
		var translator = queue[0].translation.translator || defaultQuranTranslationShortName();
		var attributionSignature = `${reciter}|${translator}`;
		var includeCredits = !!options.selection
			|| !quranAudioTranslationMarqueeState.audioAttributionShown
			|| quranAudioTranslationMarqueeState.attributionSignature !== attributionSignature;
		var scrollRight = queue[0].translation.direction === 'rtl';
		var renderQueue = options.selection || !scrollRight ? queue : queue.slice().reverse();
		renderQueue.forEach(function (entry, index) {
			if (index > 0) {
				var separator = document.createElement('span');
				separator.className = 'quran-audio-translation-marquee-separator';
				separator.setAttribute('aria-hidden', 'true');
				separator.textContent = '\u00a0·\u00a0';
				track.appendChild(separator);
			}
			var queueIndex = queue.indexOf(entry);
			var entryRef = quranAudioRefParts(entry.item.verseKey);
			var previousRef = queueIndex > 0
				? quranAudioRefParts(queue[queueIndex - 1].item.verseKey)
				: null;
			var referenceLabel = queueIndex === 0 || !previousRef || previousRef.surah !== entryRef.surah
				? `${entryRef.surah}:${entryRef.ayah}`
				: entryRef.ayah.toString();
			track.appendChild(quranAudioTranslationMarqueeEntry(
				entry.item,
				entry.translation,
				reciter,
				includeCredits && entry === queue[0],
				referenceLabel
			));
		});
		track.dir = 'ltr';
		marquee.dir = 'ltr';
		marquee.hidden = false;
		positionQuranAudioTranslationMarquee(marquee);
		if (quranAudioTranslationMarqueeState.animation)
			quranAudioTranslationMarqueeState.animation.cancel();
		quranAudioTranslationMarqueeState.animation = null;
		track.style.transform = '';
		var width = marquee.clientWidth;
		var trackWidth = track.scrollWidth;
		var overflowWidth = Math.max(0, trackWidth - width);
		marquee.classList.remove('is-static');
		quranAudioTranslationMarqueeState.activeVerseKey = verseKey;
		quranAudioTranslationMarqueeState.attributionSignature = attributionSignature;
		if (!options.selection)
			quranAudioTranslationMarqueeState.audioAttributionShown = true;
		quranAudioTranslationMarqueeState.playbackRate = playbackRate;
		quranAudioTranslationMarqueeState.renderedVerseKeys = queue.map(function (entry) {
			return entry.item.verseKey;
		});
		if (!options.selection)
			setQuranAudioTranslationMarqueeActiveVerse(verseKey);
		if (queue.length === 1 && (options.selection || quranPassageAudioState.singleAyah)) {
			var repeatedEntry = track.querySelector('[data-quran-audio-verse-key]');
			var repeatedSeparator = document.createElement('span');
			repeatedSeparator.className = 'quran-audio-translation-marquee-separator';
			repeatedSeparator.setAttribute('aria-hidden', 'true');
			repeatedSeparator.textContent = '\u00a0\u00b7\u00a0';
			track.appendChild(repeatedSeparator);
			var repeatedClone = repeatedEntry.cloneNode(true);
			repeatedClone.setAttribute('aria-hidden', 'true');
			track.appendChild(repeatedClone);
			var repeatedWidth = repeatedClone.offsetLeft - repeatedEntry.offsetLeft;
			var repeatedCopies = Math.max(2, Math.ceil(width / repeatedWidth) + 2);
			for (var repeatedIndex = 2; repeatedIndex < repeatedCopies; repeatedIndex += 1) {
				track.appendChild(repeatedSeparator.cloneNode(true));
				track.appendChild(repeatedClone.cloneNode(true));
			}
			var repeatedRtl = queue[0].translation.direction === 'rtl';
			var repeatedSeconds = quranAudioTranslationMarqueeSeconds(item, true, options.selection ? null : audio, queue[0].translation);
			marquee.dataset.quranAudioPlaybackRate = playbackRate.toString();
			marquee.dataset.quranAudioMarqueeDurationMs = Math.round(repeatedSeconds * 1000).toString();
			quranAudioTranslationMarqueeState.animation = track.animate([
				{ transform: `translateX(${repeatedRtl ? -repeatedWidth : 0}px)` },
				{ transform: `translateX(${repeatedRtl ? 0 : -repeatedWidth}px)` }
			], {
				duration: repeatedSeconds * 1000,
				easing: 'linear',
				iterations: Infinity
			});
			if (!options.selection && audio && (quranPassageAudioState.paused || audio.paused))
				quranAudioTranslationMarqueeState.animation.pause();
			return;
		}
		if (!options.selection && queue.length === 1 && overflowWidth > 0) {
			var singleSeconds = quranAudioTranslationMarqueeSeconds(item, true, audio, queue[0].translation);
			var singleRtl = queue[0].translation.direction === 'rtl';
			marquee.dataset.quranAudioPlaybackRate = playbackRate.toString();
			marquee.dataset.quranAudioMarqueeDurationMs = Math.round(singleSeconds * 1000).toString();
			quranAudioTranslationMarqueeState.animation = track.animate([
				{ transform: `translateX(${singleRtl ? -overflowWidth : 0}px)` },
				{ transform: `translateX(${singleRtl ? 0 : -overflowWidth}px)` }
			], {
				duration: singleSeconds * 1000,
				easing: 'linear',
				fill: 'forwards'
			});
			if (audio && (quranPassageAudioState.paused || audio.paused))
				quranAudioTranslationMarqueeState.animation.pause();
			return;
		}
		var entries = queue.map(function (queueEntry) {
			return track.querySelector(`[data-quran-audio-verse-key="${queueEntry.item.verseKey}"]`);
		});
		var durations = queue.map(function (entry, index) {
			return quranAudioTranslationMarqueeSeconds(entry.item, index === 0, audio, entry.translation);
		});
		var totalSeconds = durations.reduce(function (sum, seconds) { return sum + seconds; }, 0);
		var marqueeRect = marquee.getBoundingClientRect();
		var marqueeCenter = marqueeRect.left + marqueeRect.width / 2;
		var entryStart = function (entry) {
			var rect = entry.getBoundingClientRect();
			return scrollRight ? rect.right : rect.left;
		};
		var centeredStartTransform = function (entry) {
			return marqueeCenter - entryStart(entry);
		};
		var elapsed = 0;
		var keyframes = [{
			transform: `translateX(${centeredStartTransform(entries[0])}px)`,
			offset: 0
		}];
		entries.forEach(function (entry, index) {
			elapsed += durations[index];
			var nextEntry = entries[index + 1];
			var targetTransform = nextEntry
				? centeredStartTransform(nextEntry)
				: centeredStartTransform(entry);
			keyframes.push({
				transform: `translateX(${targetTransform}px)`,
				offset: Math.min(1, elapsed / totalSeconds)
			});
		});
		marquee.dataset.quranAudioPlaybackRate = playbackRate.toString();
		marquee.dataset.quranAudioMarqueeDurationMs = Math.round(totalSeconds * 1000).toString();
		quranAudioTranslationMarqueeState.animation = track.animate(keyframes, {
			duration: totalSeconds * 1000,
			easing: 'linear',
			fill: 'forwards'
		});
		if (audio && (quranPassageAudioState.paused || audio.paused))
			quranAudioTranslationMarqueeState.animation.pause();
	}).catch(function () {
		if (quranAudioTranslationMarqueeState.requestId === requestId)
			hideQuranAudioTranslationMarquee();
	});
}

function showQuranSelectionTranslationMarquee(ref) {
	var parts = quranAudioRefParts(ref || '');
	if (!Number.isInteger(parts.surah) || !Number.isInteger(parts.ayah))
		return;
	showQuranAudioTranslationMarquee({
		verseKey: `${parts.surah}:${parts.ayah}`
	}, { selection: true });
}

function showQuranRevealedWordTranslation(word) {
	if (!word) return;
	document.dispatchEvent(new CustomEvent('quranRevealedWordTranslation', {
		detail: { action: 'show', target: word }
	}));
}

function hideQuranRevealedWordTranslation(word) {
	document.dispatchEvent(new CustomEvent('quranRevealedWordTranslation', {
		detail: { action: 'hide', target: word || null }
	}));
}

function hideQuranSelectionTranslationMarquee() {
	if (!quranPassageAudioState.control)
		hideQuranAudioTranslationMarquee();
}

function initQuranSelectionTranslationMarquee() {
	if (document.documentElement.dataset.quranSelectionTranslationMarqueeBound === '1')
		return;
	document.documentElement.dataset.quranSelectionTranslationMarqueeBound = '1';
	document.addEventListener('click', function (event) {
		var target = event.target.closest(
			'.quran-passage-section .ayah[data-quran-ref], '
			+ '.quran-mushaf-page .quran-corpus-word[data-quran-ref], '
			+ '[data-quran-ayah-actions="1"][data-quran-ref]'
		);
		if (target && target.closest('[data-quran-memorize-page]') && !target.closest('[data-quran-review-reader]'))
			return;
		if (target)
			showQuranSelectionTranslationMarquee(target.getAttribute('data-quran-ref') || '');
	}, true);
}

function quranPassageAudioStorageKey() {
	return 'hadithdb.quranPassageRecitationId';
}

function storedQuranPassageRecitationId() {
	try {
		return (window.localStorage && window.localStorage.getItem(quranPassageAudioStorageKey()) || '').toString();
	} catch (_err) {
		return '';
	}
}

function storeQuranPassageRecitationId(value) {
	try {
		if (window.localStorage)
			window.localStorage.setItem(quranPassageAudioStorageKey(), (value || '').toString());
	} catch (_err) {}
}

function saveQuranPreferredReciter(reciter) {
	reciter = /^[A-Za-z0-9_-]+$/.test((reciter || '').toString()) ? reciter.toString() : 'juhani';
	storeQuranPassageRecitationId(reciter);
	return getQuranTafsirSettings().then(function (currentSettings) {
		var nextOverride = Object.assign({}, currentSettings || {}, {
			audio: Object.assign({}, currentSettings && currentSettings.audio || {}, {
				preferredReciter: reciter
			})
		});
		window.hadithQuranUserSettingsOverride = nextOverride;
		return waitForHadithAuthClient().then(function (auth) {
			return Promise.resolve(auth && auth.getUser ? auth.getUser() : null).then(function (user) {
				if (!user)
					return null;
				return Promise.resolve(auth && auth.getToken ? auth.getToken() : null).then(function (token) {
					if (!token)
						return null;
					return fetch(quranApiPath('/user-settings?optional=1'), {
						credentials: 'same-origin',
						headers: { 'Authorization': `Bearer ${token}` }
					}).then(function (response) {
						if (!response.ok)
							throw new Error('Unable to load settings.');
						return response.json();
					}).then(function (data) {
						var settings = data && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {};
						var nextSettings = Object.assign({}, settings, {
							audio: Object.assign({}, settings.audio || {}, { preferredReciter: reciter })
						});
						return fetch(quranApiPath('/user-settings'), {
							method: 'PUT',
							credentials: 'same-origin',
							headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
							body: JSON.stringify({ settings: nextSettings })
						}).then(function (response) {
							if (!response.ok)
								throw new Error('Unable to save preferred reciter.');
							return response.json();
						}).then(function (saved) {
							updateCachedQuranUserSettings(user, saved.settings || nextSettings);
							return saved;
						});
					});
				});
			});
		});
	});
}

function quranPassageAudioRecitations() {
	if (quranPassageAudioRecitationsPromise)
		return quranPassageAudioRecitationsPromise;
	quranPassageAudioRecitationsPromise = fetch(quranApiPath('/proxy/quran-audio/recitations'), {
		cache: 'no-store',
		credentials: 'same-origin',
		headers: { Accept: 'application/json' }
	}).then(function (response) {
		if (!response.ok)
			return responseErrorMessage(response, 'Unable to load reciters.').then(function (message) {
				throw new Error(message);
			});
		return response.json();
	}).then(function (payload) {
		return Array.isArray(payload.recitations) ? payload.recitations : [];
	}).catch(function (err) {
		quranPassageAudioRecitationsPromise = null;
		throw err;
	});
	return quranPassageAudioRecitationsPromise;
}

function quranPassageAudioControls(control) {
	return {
		play: control.querySelector('[data-quran-passage-audio-play]'),
		pause: control.querySelector('[data-quran-passage-audio-pause]'),
		stop: control.querySelector('[data-quran-passage-audio-stop]'),
		repeat: control.querySelector('[data-quran-passage-audio-repeat]'),
		select: control.querySelector('[data-quran-passage-reciter-select="1"]'),
		status: control.querySelector('[data-quran-passage-audio-status]')
	};
}

function syncQuranPassageAudioStopControls() {
	var enabled = !!quranPassageAudioState.control;
	document.documentElement.classList.toggle('quran-audio-global-active', enabled);
	document.querySelectorAll('[data-quran-passage-audio-stop]').forEach(function (button) {
		button.disabled = !enabled;
	});
}

function setQuranPassageAudioStatus(control, message) {
	var controls = quranPassageAudioControls(control);
	if (controls.status)
		controls.status.textContent = message || '';
}

function setQuranPassageAudioLoading(control, loading) {
	var controls = quranPassageAudioControls(control);
	control.classList.toggle('is-loading', !!loading);
	if (controls.play)
		controls.play.disabled = !!loading;
	if (controls.pause)
		controls.pause.disabled = true;
	if (controls.stop && loading && quranPassageAudioState.control === control)
		controls.stop.disabled = false;
	if (controls.select)
		controls.select.disabled = !!loading;
	syncQuranPassageAudioStopControls();
	syncMobileFooterAudioControls();
}

function setQuranPassageAudioPlaying(control, playing) {
	var controls = quranPassageAudioControls(control);
	var paused = quranPassageAudioState.control === control && quranPassageAudioState.paused;
	var loading = control.classList.contains('is-loading');
	control.classList.toggle('is-playing', !!playing);
	control.classList.toggle('is-paused', !!paused);
	if (controls.play) {
		controls.play.disabled = loading;
		controls.play.title = playing ? 'Pause audio' : 'Play audio';
		controls.play.setAttribute('aria-label', playing ? 'Pause audio' : 'Play audio');
		var playIcon = controls.play.querySelector('.bi');
		if (playIcon) {
			playIcon.classList.toggle('bi-play-fill', !playing);
			playIcon.classList.toggle('bi-pause-fill', !!playing);
		}
	}
	if (controls.pause)
		controls.pause.disabled = !playing || loading;
	if (controls.stop)
		controls.stop.disabled = !(playing || paused) || loading;
	if (controls.select)
		controls.select.disabled = !!playing || paused || loading;
	syncQuranPassageAudioStopControls();
	syncMobileFooterAudioControls();
}

function quranPassageAudioRepeatEnabled(control) {
	return !!(control && control.dataset.quranPassageAudioRepeat === 'true');
}

function setQuranPassageAudioRepeat(control, repeat) {
	var controls = quranPassageAudioControls(control);
	var enabled = !!repeat;
	control.dataset.quranPassageAudioRepeat = enabled ? 'true' : 'false';
	control.classList.toggle('is-repeating', enabled);
	if (controls.repeat) {
		controls.repeat.classList.toggle('is-active', enabled);
		controls.repeat.setAttribute('aria-pressed', enabled ? 'true' : 'false');
	}
	if (quranPassageAudioState.control === control)
		quranPassageAudioState.repeat = enabled;
	syncMobileFooterAudioControls();
}

function quranPassageAudioControlRange(control) {
	return {
		surah: quranAudioInteger(control && control.getAttribute('data-surah')),
		from: quranAudioInteger(control && control.getAttribute('data-from')),
		to: quranAudioInteger(control && control.getAttribute('data-to'))
	};
}

function quranPassageAudioControlRanges(control) {
	var encoded = control && control.getAttribute('data-quran-audio-ranges');
	if (encoded) {
		try {
			var ranges = JSON.parse(encoded).map(function (range) {
				return { surah: quranAudioInteger(range.surah), from: quranAudioInteger(range.from), to: quranAudioInteger(range.to) };
			}).filter(function (range) {
				return Number.isInteger(range.surah) && Number.isInteger(range.from) && Number.isInteger(range.to);
			});
			if (ranges.length)
				return ranges;
		} catch (_err) {}
	}
	return [quranPassageAudioControlRange(control)];
}

function quranPassageAudioRepeatRanges(control) {
	var encoded = control && control.getAttribute('data-quran-audio-repeat-ranges');
	if (!encoded)
		return [];
	try {
		return JSON.parse(encoded).map(function (range) {
			return { surah: quranAudioInteger(range.surah), from: quranAudioInteger(range.from), to: quranAudioInteger(range.to) };
		}).filter(function (range) {
			return Number.isInteger(range.surah) && Number.isInteger(range.from) && Number.isInteger(range.to);
		});
	} catch (_err) {
		return [];
	}
}

function quranPassageAudioStartRef(control, options) {
	options = options || {};
	var surah = quranAudioInteger(options.startSurah);
	var ayah = quranAudioInteger(options.startAyah);
	if (Number.isInteger(surah) && Number.isInteger(ayah))
		return { surah: surah, ayah: ayah };
	var mushafPage = control && control.closest('[data-quran-mushaf-page]');
	var selectedRef = quranAudioRefParts(mushafPage && mushafPage.dataset.quranMushafSelectedRef || '');
	if (Number.isInteger(selectedRef.surah) && Number.isInteger(selectedRef.ayah))
		return selectedRef;
	var range = quranPassageAudioControlRange(control);
	return { surah: range.surah, ayah: range.from };
}

function quranPassageAudioRequestRanges(control, options) {
	options = options || {};
	if (options.singleAyah) {
		var singleRef = quranPassageAudioStartRef(control, options);
		if (Number.isInteger(singleRef.surah) && Number.isInteger(singleRef.ayah))
			return [{ surah: singleRef.surah, from: singleRef.ayah, to: singleRef.ayah }];
	}
	if (!quranPassageAudioRepeatEnabled(control))
		return quranPassageAudioControlRanges(control);
	var ref = quranPassageAudioStartRef(control, options);
	var repeatRange = quranPassageAudioRepeatRanges(control).find(function (range) {
		return range.surah === ref.surah && ref.ayah >= range.from && ref.ayah <= range.to;
	});
	return repeatRange ? [repeatRange] : quranPassageAudioControlRanges(control);
}

function quranPassageAudioCurrentRef() {
	var item = quranPassageAudioState.playlist[quranPassageAudioState.index];
	return quranAudioRefParts(item && item.verseKey || '');
}

function toggleQuranPassageAudioRepeat(control) {
	if (!control)
		return;
	var enabled = !quranPassageAudioRepeatEnabled(control);
	var currentRef = quranPassageAudioCurrentRef();
	setQuranPassageAudioRepeat(control, enabled);
	if (enabled && quranPassageAudioState.control === control) {
		startQuranPassageAudio(control, {
			startSurah: currentRef.surah,
			startAyah: currentRef.ayah,
			restart: true
		});
	}
}

function quranPassageAudioControlContainsRef(control, ref) {
	if (!ref)
		return false;
	return quranPassageAudioControlRanges(control).some(function (range) {
		return range.surah === ref.surah && ref.ayah >= range.from && ref.ayah <= range.to;
	});
}

function quranHeroAudioRefFromElement(element) {
	if (!element)
		return null;
	var root = element.matches && element.matches('[data-quran-hero-audio]')
		? element
		: element.closest && element.closest('[data-quran-hero-audio]');
	var surah = quranAudioInteger(element.getAttribute && element.getAttribute('data-surah') || root && root.getAttribute('data-surah'));
	var ayah = quranAudioInteger(element.getAttribute && element.getAttribute('data-ayah') || root && root.getAttribute('data-ayah'));
	if (Number.isInteger(surah) && Number.isInteger(ayah))
		return { surah: surah, ayah: ayah };
	return null;
}

function quranHeroAudioRootForControl(control) {
	var chunk = control && control.closest('[data-quran-infinite-page="1"]');
	var chunkHero = chunk ? chunk.querySelector('.quran-ayah-hero[data-quran-hero-audio="1"]') : null;
	if (chunkHero)
		return chunkHero;
	var selectedHero = document.querySelector('[data-quran-selected-ayah-hero] .quran-ayah-hero[data-quran-hero-audio="1"]');
	if (selectedHero)
		return selectedHero;
	return document.querySelector('.quran-ayah-hero[data-quran-hero-audio="1"]');
}

function quranPassageAudioPlaylistIndex(playlist, ref) {
	var key = quranAudioRefKey(ref);
	if (!key)
		return -1;
	return playlist.findIndex(function (item) {
		var itemKey = item && item.verseKey ? item.verseKey.toString() : '';
		if (!itemKey && item)
			itemKey = quranAudioRefKey({ surah: quranAudioInteger(item.surah), ayah: quranAudioInteger(item.ayah) });
		return itemKey === key;
	});
}

function quranPassageAudioStartIndex(control, playlist, options) {
	options = options || {};
	var ref = null;
	if (Number.isInteger(quranAudioInteger(options.startAyah))) {
		ref = {
			surah: quranAudioInteger(options.startSurah) || quranPassageAudioControlRange(control).surah,
			ayah: quranAudioInteger(options.startAyah)
		};
	} else {
		ref = quranHeroAudioRefFromElement(quranHeroAudioRootForControl(control));
	}
	if (!quranPassageAudioControlContainsRef(control, ref))
		return 0;
	var index = quranPassageAudioPlaylistIndex(playlist, ref);
	return index >= 0 ? index : 0;
}

function matchingQuranPassageAudioControl(ref) {
	return Array.from(document.querySelectorAll('[data-quran-passage-audio="1"]')).filter(quranPassageAudioControlIsVisible).find(function (control) {
		return quranPassageAudioControlContainsRef(control, ref);
	}) || null;
}

function quranHeroStandaloneAudioControl() {
	var control = document.querySelector('[data-quran-hero-audio-control="1"]');
	if (control)
		return control;
	control = document.createElement('div');
	control.hidden = true;
	control.className = 'quran-passage-audio-control quran-hero-audio-control';
	control.setAttribute('data-quran-passage-audio', '1');
	control.setAttribute('data-quran-hero-audio-control', '1');
	control.setAttribute('data-quran-standalone-audio', '1');
	control.innerHTML = '<button type="button" data-quran-passage-audio-play></button><button type="button" data-quran-passage-audio-pause></button><button type="button" data-quran-passage-audio-stop></button><button type="button" data-quran-passage-audio-repeat></button><select data-quran-passage-reciter-select="1"><option value="juhani">Juhani</option></select><span data-quran-passage-audio-status></span>';
	document.body.appendChild(control);
	return control;
}

function startQuranAyahAudio(refValue) {
	var ref = quranAudioRefParts(refValue || '');
	if (!Number.isInteger(ref.surah) || !Number.isInteger(ref.ayah))
		return false;
	Promise.resolve(getQuranTafsirSettings()).catch(function () { return {}; }).then(function (settings) {
		var control = matchingQuranPassageAudioControl(ref);
		if (!control) {
			control = quranHeroStandaloneAudioControl();
			control.setAttribute('data-surah', ref.surah);
			control.setAttribute('data-from', ref.ayah);
			control.setAttribute('data-to', ref.ayah);
			control.setAttribute('data-quran-audio-scope', `ayah-${ref.surah}-${ref.ayah}`);
		}
		var preferredReciter = settings && settings.audio && settings.audio.preferredReciter
			|| storedQuranPassageRecitationId() || 'juhani';
		control.setAttribute('data-quran-audio-reciter-override', preferredReciter);
		startQuranPassageAudio(control, {
			startSurah: ref.surah,
			startAyah: ref.ayah,
			restart: true,
			singleAyah: true
		});
	});
	return true;
}

function startQuranHeroAudio(button) {
	var ref = quranHeroAudioRefFromElement(button);
	if (!ref)
		return;
	var control = matchingQuranPassageAudioControl(ref);
	if (!control) {
		control = quranHeroStandaloneAudioControl();
		control.setAttribute('data-surah', ref.surah);
		control.setAttribute('data-from', ref.ayah);
		control.setAttribute('data-to', ref.ayah);
		control.setAttribute('data-quran-audio-scope', `hero-${ref.surah}-${ref.ayah}`);
	}
	startQuranPassageAudio(control, { startSurah: ref.surah, startAyah: ref.ayah, restart: true });
}

function initQuranHeroAudioActions() {
	if (document.documentElement.dataset.quranHeroAudioBound === 'true')
		return;
	document.documentElement.dataset.quranHeroAudioBound = 'true';
	document.addEventListener('click', function (event) {
		var button = event.target.closest('[data-quran-hero-audio-play]');
		if (!button)
			return;
		event.preventDefault();
		startQuranHeroAudio(button);
	});
}

function createMobileFooterAudioButton(action, iconClass, label, title) {
	var button = document.createElement('button');
	button.type = 'button';
	button.className = 'mobile-bottom-nav-item mobile-bottom-nav-audio-item';
	button.setAttribute(`data-mobile-audio-${action}`, '1');
	button.setAttribute('title', title);
	button.setAttribute('aria-label', title);
	button.innerHTML = `<span class="bi ${iconClass} mobile-bottom-nav-icon" aria-hidden="true"></span><span class="mobile-bottom-nav-label">${label}</span>`;
	return button;
}

function quranPassageAudioPlaybackRateOption() {
	return quranPassageAudioPlaybackRates.find(function (option) {
		return option.value === quranPassageAudioState.playbackRate;
	}) || quranPassageAudioPlaybackRates[0];
}

function applyQuranPassageAudioPlaybackRate(audio) {
	if (!audio)
		return;
	var rate = quranPassageAudioPlaybackRateOption().value;
	audio.defaultPlaybackRate = rate;
	audio.playbackRate = rate;
}

function setQuranPassageAudioPlaybackRate(rate) {
	var option = quranPassageAudioPlaybackRates.find(function (candidate) {
		return candidate.value === Number(rate);
	}) || quranPassageAudioPlaybackRates[0];
	quranPassageAudioState.playbackRate = option.value;
	storeQuranPassageAudioPlaybackRate(option.value);
	applyQuranPassageAudioPlaybackRate(quranPassageAudioState.audio);
	syncMobileFooterAudioControls();
	var item = quranPassageAudioState.playlist[quranPassageAudioState.index];
	if (quranPassageAudioState.control && item)
		showQuranAudioTranslationMarquee(item);
}

function cycleQuranPassageAudioPlaybackRate() {
	var current = quranPassageAudioPlaybackRateOption();
	var index = quranPassageAudioPlaybackRates.indexOf(current);
	setQuranPassageAudioPlaybackRate(quranPassageAudioPlaybackRates[(index + 1) % quranPassageAudioPlaybackRates.length].value);
}

function createMobileFooterAudioSpeedButton() {
	var option = quranPassageAudioPlaybackRateOption();
	var button = document.createElement('button');
	button.type = 'button';
	button.className = 'mobile-bottom-nav-item mobile-bottom-nav-audio-item mobile-bottom-nav-audio-speed';
	button.setAttribute('data-mobile-audio-speed', '1');
	button.setAttribute('title', `Playback speed ${option.label}`);
	button.setAttribute('aria-label', `Playback speed ${option.label}`);
	button.innerHTML = `<span class="mobile-bottom-nav-speed-value">${option.label}</span>`;
	return button;
}

function setMobileFooterAudioMode(enabled) {
	var footer = document.querySelector('.mobile-bottom-nav');
	if (!footer)
		return [];
	if (!footer.dataset.mobileAudioOriginalAriaLabel)
		footer.dataset.mobileAudioOriginalAriaLabel = footer.getAttribute('aria-label') || '';
	if (enabled) {
		if (footer.dataset.mobileAudioMode === 'true')
			return Array.from(footer.querySelectorAll('.mobile-bottom-nav-audio-item'));
		footer.dataset.mobileAudioMode = 'true';
		footer.classList.add('mobile-bottom-nav-audio-controls');
		footer.setAttribute('aria-label', 'Quran audio controls');
		Array.from(footer.children).forEach(function (item) {
			item.hidden = true;
			item.setAttribute('data-mobile-audio-original-item', '1');
		});
		var buttons = [
			createMobileFooterAudioButton('prev', 'bi-skip-backward-fill', 'Prev', 'Previous Quran verse'),
			createMobileFooterAudioButton('repeat', 'bi-repeat', 'Repeat', 'Repeat Quran passage'),
			createMobileFooterAudioButton('play', 'bi-play-fill', 'Play', 'Play Quran audio'),
			createMobileFooterAudioButton('stop', 'bi-stop-fill', 'Stop', 'Stop Quran audio'),
			createMobileFooterAudioSpeedButton(),
			createMobileFooterAudioButton('next', 'bi-skip-forward-fill', 'Next', 'Next Quran verse')
		];
		buttons.forEach(function (button) {
			footer.appendChild(button);
		});
		return buttons;
	}
	var buttons = Array.from(footer.querySelectorAll('.mobile-bottom-nav-audio-item'));
	if (footer.dataset.mobileAudioMode !== 'true')
		return buttons;
	delete footer.dataset.mobileAudioMode;
	footer.classList.remove('mobile-bottom-nav-audio-controls');
	footer.setAttribute('aria-label', footer.dataset.mobileAudioOriginalAriaLabel || 'Page navigation');
	buttons.forEach(function (button) {
		button.remove();
	});
	footer.querySelectorAll('[data-mobile-audio-original-item]').forEach(function (item) {
		item.hidden = false;
		item.removeAttribute('data-mobile-audio-original-item');
	});
	return [];
}

function syncMobileFooterAudioControls() {
	var control = quranPassageAudioState.control;
	if (!control) {
		setMobileFooterAudioMode(false);
		return;
	}
	var buttons = setMobileFooterAudioMode(true);
	if (buttons.length < 6)
		return;
	var loading = control.classList.contains('is-loading');
	var playing = control.classList.contains('is-playing') && !quranPassageAudioState.paused;
	var prev = buttons.find(function (button) { return button.hasAttribute('data-mobile-audio-prev'); });
	var repeat = buttons.find(function (button) { return button.hasAttribute('data-mobile-audio-repeat'); });
	var speed = buttons.find(function (button) { return button.hasAttribute('data-mobile-audio-speed'); });
	var play = buttons.find(function (button) { return button.hasAttribute('data-mobile-audio-play'); });
	var stop = buttons.find(function (button) { return button.hasAttribute('data-mobile-audio-stop'); });
	var next = buttons.find(function (button) { return button.hasAttribute('data-mobile-audio-next'); });
	prev.disabled = loading || quranPassageAudioState.index <= 0;
	repeat.disabled = loading;
	repeat.classList.toggle('is-active', quranPassageAudioState.repeat);
	repeat.setAttribute('aria-pressed', quranPassageAudioState.repeat ? 'true' : 'false');
	var speedOption = quranPassageAudioPlaybackRateOption();
	speed.disabled = loading;
	speed.setAttribute('title', `Playback speed ${speedOption.label}`);
	speed.setAttribute('aria-label', `Playback speed ${speedOption.label}`);
	speed.innerHTML = `<span class="mobile-bottom-nav-speed-value">${speedOption.label}</span>`;
	play.disabled = loading;
	play.setAttribute('title', playing ? 'Pause Quran audio' : 'Play Quran audio');
	play.setAttribute('aria-label', playing ? 'Pause Quran audio' : 'Play Quran audio');
	play.innerHTML = `<span class="bi ${playing ? 'bi-pause-fill' : 'bi-play-fill'} mobile-bottom-nav-icon" aria-hidden="true"></span><span class="mobile-bottom-nav-label">${playing ? 'Pause' : 'Play'}</span>`;
	stop.disabled = false;
	next.disabled = loading || quranPassageAudioState.playlist.length < 1;
}

function initMobileFooterAudioControls() {
	if (document.documentElement.dataset.mobileFooterAudioBound === 'true')
		return;
	document.documentElement.dataset.mobileFooterAudioBound = 'true';
	document.addEventListener('click', function (event) {
		var button = event.target.closest('[data-mobile-audio-prev], [data-mobile-audio-play], [data-mobile-audio-repeat], [data-mobile-audio-speed], [data-mobile-audio-pause], [data-mobile-audio-stop], [data-mobile-audio-next]');
		if (!button)
			return;
		event.preventDefault();
		var control = quranPassageAudioState.control;
		if (!control)
			return;
		if (button.hasAttribute('data-mobile-audio-prev')) {
			previousQuranPassageAudio();
			return;
		}
		if (button.hasAttribute('data-mobile-audio-play')) {
			if (quranPassageAudioState.paused)
				resumeQuranPassageAudio(control);
			else if (control.classList.contains('is-playing'))
				pauseQuranPassageAudio(control);
			else if (!control.classList.contains('is-playing') && !control.classList.contains('is-loading'))
				startQuranPassageAudio(control);
			return;
		}
		if (button.hasAttribute('data-mobile-audio-repeat')) {
			toggleQuranPassageAudioRepeat(control);
			return;
		}
		if (button.hasAttribute('data-mobile-audio-speed')) {
			cycleQuranPassageAudioPlaybackRate();
			return;
		}
		if (button.hasAttribute('data-mobile-audio-pause')) {
			pauseQuranPassageAudio(control);
			return;
		}
		if (button.hasAttribute('data-mobile-audio-stop')) {
			stopQuranPassageAudio(control);
			return;
		}
		if (button.hasAttribute('data-mobile-audio-next'))
			advanceQuranPassageAudio();
	});
}

function quranPassageAudioHighlightScopes(control) {
	var mushafPage = control && control.closest('[data-quran-mushaf-page]');
	if (mushafPage)
		return [mushafPage.closest('[data-quran-mushaf-reader]') || mushafPage];
	var scopeId = control && control.getAttribute('data-quran-audio-scope');
	if (scopeId) {
		var scopedSections = Array.from(document.querySelectorAll('.quran-passage-section[data-quran-audio-scope], .quran-mushaf-page[data-quran-audio-scope]')).filter(function (section) {
			return section.getAttribute('data-quran-audio-scope') === scopeId;
		});
		if (scopedSections.length > 0)
			return scopedSections;
	}
	var headingToolbar = control && control.closest('.quran-heading-audio-toolbar');
	if (headingToolbar && headingToolbar.nextElementSibling && headingToolbar.nextElementSibling.matches('.quran-passage-section'))
		return [headingToolbar.nextElementSibling];
	var chunk = control && control.closest('[data-quran-infinite-page="1"]');
	if (chunk)
		return [chunk];
	var toolbar = control && control.closest('.quran-ayah-select-toolbar');
	if (!toolbar)
		return [document];
	var scopes = [];
	var node = toolbar.nextElementSibling;
	while (node) {
		if (node.matches && (node.matches('.quran-ayah-select-toolbar') || node.matches('[data-quran-infinite-page="1"], [data-quran-infinite-anchor="1"]')))
			break;
		if (node.matches && (node.matches('.quran-passage-section') || node.querySelector('.quran-passage-section')))
			scopes.push(node);
		node = node.nextElementSibling;
	}
	return scopes.length > 0 ? scopes : [document];
}

function clearQuranPassageAudioHighlight(control) {
	var scopes = control ? quranPassageAudioHighlightScopes(control) : [document];
	scopes.forEach(function (scope) {
		scope.querySelectorAll('.quran-audio-active-ayah').forEach(function (ayah) {
			ayah.classList.remove('quran-audio-active-ayah');
		});
	});
	refreshQuranMushafAyahBackgrounds(scopes);
}

function refreshQuranMushafAyahBackgrounds(scopes) {
	var roots = Array.isArray(scopes) ? scopes : [scopes || document];
	window.requestAnimationFrame(function () {
		var pages = new Set();
		roots.forEach(function (root) {
			if (!root)
				return;
			if (root.matches && root.matches('[data-quran-mushaf-page]'))
				pages.add(root);
			root.querySelectorAll && root.querySelectorAll('[data-quran-mushaf-page]').forEach(function (page) {
				pages.add(page);
			});
			var containingPage = root.closest && root.closest('[data-quran-mushaf-page]');
			if (containingPage)
				pages.add(containingPage);
		});
		pages.forEach(function (page) {
			page.querySelectorAll('.quran-mushaf-ayah-highlight-bg').forEach(function (background) {
				background.remove();
			});
			var groups = new Map();
			page.querySelectorAll('[data-quran-ref].quran-mushaf-ayah-selected, [data-quran-ref].quran-audio-active-ayah').forEach(function (element) {
				var line = element.closest('.quran-mushaf-line');
				var ref = element.getAttribute('data-quran-ref') || '';
				if (!line || !ref)
					return;
				var key = `${line.getAttribute('data-line-number') || Array.from(line.parentNode.children).indexOf(line)}:${ref}`;
				if (!groups.has(key))
					groups.set(key, { line: line, elements: [] });
				groups.get(key).elements.push(element);
			});
			groups.forEach(function (group) {
				var lineRect = group.line.getBoundingClientRect();
				var rects = group.elements.map(function (element) { return element.getBoundingClientRect(); });
				var left = Math.max(0, Math.min.apply(null, rects.map(function (rect) { return rect.left; })) - lineRect.left);
				var right = Math.max(0, lineRect.right - Math.max.apply(null, rects.map(function (rect) { return rect.right; })));
				var background = document.createElement('span');
				background.className = 'quran-mushaf-ayah-highlight-bg';
				background.setAttribute('aria-hidden', 'true');
				background.style.left = `${left}px`;
				background.style.right = `${right}px`;
				group.line.insertBefore(background, group.line.firstChild);
			});
		});
	});
}

function setQuranPassageAudioHighlight(control, item) {
	clearQuranPassageAudioHighlight(control);
	var ref = quranAudioRefKey(quranAudioRefParts(item && item.verseKey || ''));
	if (!ref)
		return;
	var scopes = quranPassageAudioHighlightScopes(control);
	scopes.forEach(function (scope) {
		scope.querySelectorAll('.quran-passage-section .body.passage .ayah[data-quran-ref], .quran-mushaf-page [data-quran-ref]').forEach(function (ayah) {
			var ayahRef = quranAudioRefKey(quranAudioRefParts(ayah.getAttribute('data-quran-ref') || ''));
			ayah.classList.toggle('quran-audio-active-ayah', ayahRef === ref);
		});
	});
	refreshQuranMushafAyahBackgrounds(scopes);
	scrollQuranPassageAudioAyahIntoView(scopes, ref);
}

function quranPassageAudioFixedTopOffset() {
	var navbar = document.querySelector('.site-navbar.fixed-top');
	return (navbar && navbar.getClientRects().length ? navbar.getBoundingClientRect().height : 0) + 12;
}

function quranPassageAudioFixedBottomOffset() {
	var footer = document.querySelector('.mobile-bottom-nav');
	var marquee = document.querySelector('[data-quran-audio-translation-marquee]:not([hidden])');
	if (!footer || !footer.getClientRects().length)
		return 12;
	var style = window.getComputedStyle ? window.getComputedStyle(footer) : null;
	return (style && style.display === 'none' ? 0 : footer.getBoundingClientRect().height)
		+ (marquee ? marquee.getBoundingClientRect().height : 0) + 12;
}

function quranPassageAudioAyahTarget(scopes, ref) {
	var fallback = null;
	for (var i = 0; i < scopes.length; i += 1) {
		var ayahs = Array.from(scopes[i].querySelectorAll('.quran-passage-section .body.passage .ayah[data-quran-ref], .quran-mushaf-page [data-quran-ref]')).filter(function (ayah) {
			return (ayah.getAttribute('data-quran-ref') || '') === ref && ayah.getClientRects().length > 0;
		});
		var arabicAyah = ayahs.find(function (ayah) {
			return !!ayah.closest('[lang="ar"]');
		});
		if (arabicAyah)
			return arabicAyah.closest('.quran-mushaf-line') || arabicAyah;
		if (!fallback && ayahs.length > 0)
			fallback = ayahs[0];
	}
	return fallback;
}

function scrollQuranPassageAudioAyahIntoView(scopes, ref) {
	var target = quranPassageAudioAyahTarget(scopes, ref);
	if (!target)
		return;
	window.requestAnimationFrame(function () {
		var rect = target.getBoundingClientRect();
		var topOffset = quranPassageAudioFixedTopOffset();
		var bottomLimit = window.innerHeight - quranPassageAudioFixedBottomOffset();
		if (rect.top >= topOffset && rect.top <= bottomLimit)
			return;
		window.scrollTo({
			top: window.pageYOffset + rect.top - topOffset,
			behavior: 'smooth'
		});
	});
}

function quranPassageAudioControlIsVisible(control) {
	return !!(control && control.getClientRects && control.getClientRects().length > 0);
}

function nextQuranPassageAudioControl(control) {
	var controls = Array.from(document.querySelectorAll('[data-quran-passage-audio="1"]')).filter(quranPassageAudioControlIsVisible);
	var index = controls.indexOf(control);
	if (index < 0)
		return controls[0] || null;
	return controls[index + 1] || null;
}

function quranPassageAudioInfiniteLoader(control) {
	var main = control && control.closest('[data-quran-infinite-passage="1"]');
	if (!main)
		main = document.querySelector('[data-quran-infinite-passage="1"]');
	if (main && typeof main.quranInfiniteLoadNext === 'function')
		return main.quranInfiniteLoadNext;
	var mushaf = control && control.closest('[data-quran-mushaf-reader]');
	return mushaf && typeof mushaf.quranMushafLoadNext === 'function' ? mushaf.quranMushafLoadNext : null;
}

function continueQuranPassageAudio(control) {
	var activeControl = control || quranPassageAudioState.control;
	if (!activeControl)
		return;
	var currentControl = matchingQuranPassageAudioControl(quranPassageAudioCurrentRef());
	if (currentControl)
		activeControl = currentControl;
	if (activeControl.hasAttribute('data-quran-standalone-audio')) {
		stopQuranPassageAudio(activeControl);
		return;
	}
	var nextControl = nextQuranPassageAudioControl(activeControl);
	if (nextControl) {
		startQuranPassageAudio(nextControl);
		return;
	}
	var loader = quranPassageAudioInfiniteLoader(activeControl);
	if (!loader) {
		stopQuranPassageAudio(activeControl);
		return;
	}
	var requestId = quranPassageAudioState.requestId;
	setQuranPassageAudioPlaying(activeControl, false);
	setQuranPassageAudioLoading(activeControl, true);
	setQuranPassageAudioStatus(activeControl, 'Loading next passage');
	Promise.resolve(loader()).then(function (loaded) {
		if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== activeControl)
			return;
		setQuranPassageAudioLoading(activeControl, false);
		var loadedControl = loaded ? nextQuranPassageAudioControl(activeControl) : null;
		if (loadedControl)
			startQuranPassageAudio(loadedControl);
		else
			stopQuranPassageAudio(activeControl);
	}).catch(function (err) {
		if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== activeControl)
			return;
		stopQuranPassageAudio(activeControl);
		if (window.toastr)
			toastr.error(err && err.message ? err.message : 'Unable to load next Quran passage.');
	});
}

function extendQuranPassageAudioAcrossBoundary() {
	if (!quranPassageAudioState.control || quranPassageAudioState.repeat)
		return Promise.resolve(false);
	if (quranPassageAudioState.extending)
		return quranPassageAudioState.extending;
	var activeControl = quranPassageAudioState.control;
	var tailControl = quranPassageAudioState.tailControl || activeControl;
	var requestId = quranPassageAudioState.requestId;
	var resolveNextControl = function () {
		var nextControl = nextQuranPassageAudioControl(tailControl);
		if (nextControl)
			return Promise.resolve(nextControl);
		var loader = quranPassageAudioInfiniteLoader(tailControl);
		if (!loader)
			return Promise.resolve(null);
		return Promise.resolve(loader()).then(function (loaded) {
			return loaded ? nextQuranPassageAudioControl(tailControl) : null;
		});
	};
	quranPassageAudioState.extending = resolveNextControl().then(function (nextControl) {
		if (!nextControl || quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== activeControl)
			return false;
		var currentReciter = selectedQuranPassageReciterId(activeControl);
		nextControl.setAttribute('data-quran-audio-reciter-override', currentReciter);
		var nextSelect = quranPassageAudioControls(nextControl).select;
		if (nextSelect && Array.from(nextSelect.options).some(function (option) { return option.value === currentReciter; }))
			nextSelect.value = currentReciter;
		return loadQuranPassageAudio(nextControl).then(function (items) {
			if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== activeControl)
				return false;
			var existing = new Set(quranPassageAudioState.playlist.map(function (item) {
				return `${item.url || ''}|${item.verseKey || ''}|${Number(item.startMs) || 0}`;
			}));
			items.forEach(function (item) {
				var key = `${item.url || ''}|${item.verseKey || ''}|${Number(item.startMs) || 0}`;
				if (!existing.has(key)) {
					existing.add(key);
					quranPassageAudioState.playlist.push(item);
				}
			});
			quranPassageAudioState.tailControl = nextControl;
			preloadNextQuranPassageAudio();
			syncMobileFooterAudioControls();
			return true;
		});
	}).catch(function () {
		return false;
	}).finally(function () {
		if (quranPassageAudioState.requestId === requestId)
			quranPassageAudioState.extending = null;
	});
	return quranPassageAudioState.extending;
}

function advanceQuranPassageAudio() {
	if (!quranPassageAudioState.control || quranPassageAudioState.playlist.length < 1)
		return;
	quranPassageAudioState.index += 1;
	if (quranPassageAudioState.index >= quranPassageAudioState.playlist.length) {
		if (quranPassageAudioState.singleAyah) {
			stopQuranPassageAudio(quranPassageAudioState.control);
			return;
		}
		if (!quranPassageAudioState.repeat && quranPassageAudioState.extending) {
			quranPassageAudioState.index = Math.max(0, quranPassageAudioState.playlist.length - 1);
			return;
		}
		if (!quranPassageAudioState.repeat) {
			continueQuranPassageAudio(quranPassageAudioState.control);
			return;
		}
		quranPassageAudioState.index = 0;
	}
	playCurrentQuranPassageAudio();
}

function previousQuranPassageAudio() {
	if (!quranPassageAudioState.control || quranPassageAudioState.playlist.length < 1
		|| quranPassageAudioState.index <= 0)
		return;
	quranPassageAudioState.index -= 1;
	playCurrentQuranPassageAudio();
}

function resetQuranPassageAudioPreload() {
	quranPassageAudioState.preloadedUrl = '';
	if (quranPassageAudioState.preloadAbortController) {
		try {
			quranPassageAudioState.preloadAbortController.abort();
		} catch (_err) {}
		quranPassageAudioState.preloadAbortController = null;
	}
	releaseQuranPassageAudioPreloadedObjectUrl();
	clearQuranPassageAudioPreloadSource();
}

function revokeQuranPassageAudioObjectUrl(url) {
	if (!url || !window.URL || !window.URL.revokeObjectURL)
		return;
	try {
		window.URL.revokeObjectURL(url);
	} catch (_err) {}
}

function releaseQuranPassageAudioActiveObjectUrl() {
	revokeQuranPassageAudioObjectUrl(quranPassageAudioState.activeObjectUrl);
	quranPassageAudioState.activeObjectUrl = '';
}

function releaseQuranPassageAudioPreloadedObjectUrl() {
	revokeQuranPassageAudioObjectUrl(quranPassageAudioState.preloadedObjectUrl);
	quranPassageAudioState.preloadedObjectUrl = '';
}

function quranPassageAudioPreloadElement() {
	if (quranPassageAudioState.preloadAudio)
		return quranPassageAudioState.preloadAudio;
	var audio = new Audio();
	audio.preload = 'auto';
	quranPassageAudioState.preloadAudio = audio;
	return audio;
}

function preloadQuranPassageAudioElement(url) {
	if (!url)
		return;
	try {
		var preloadAudio = quranPassageAudioPreloadElement();
		preloadAudio.src = url;
		preloadAudio.load();
	} catch (_err) {}
}

function quranPassageAudioNextItem() {
	var playlist = quranPassageAudioState.playlist;
	if (!playlist || playlist.length < 2)
		return null;
	var nextIndex = quranPassageAudioState.index + 1;
	if (nextIndex >= playlist.length) {
		if (!quranPassageAudioState.repeat)
			return null;
		nextIndex = 0;
	}
	return playlist[nextIndex] || null;
}

function quranPassageAudioSourceUrl(item) {
	var url = item && item.url ? item.url.toString() : '';
	if (url && quranPassageAudioState.preloadedUrl === url && quranPassageAudioState.preloadedObjectUrl) {
		releaseQuranPassageAudioActiveObjectUrl();
		quranPassageAudioState.activeObjectUrl = quranPassageAudioState.preloadedObjectUrl;
		quranPassageAudioState.preloadedObjectUrl = '';
		quranPassageAudioState.preloadedUrl = '';
		quranPassageAudioState.preloadAbortController = null;
		return quranPassageAudioState.activeObjectUrl;
	}
	releaseQuranPassageAudioActiveObjectUrl();
	return url;
}

function preloadNextQuranPassageAudio() {
	var item = quranPassageAudioNextItem();
	var url = item && item.url ? item.url.toString() : '';
	if (!url || url === quranPassageAudioState.preloadedUrl)
		return;
	var currentAudio = quranPassageAudioState.audio;
	if (currentAudio && currentAudio.src && new URL(currentAudio.src, window.location.origin).pathname === new URL(url, window.location.origin).pathname)
		return;
	resetQuranPassageAudioPreload();
	quranPassageAudioState.preloadedUrl = url;
	preloadQuranPassageAudioElement(url);
	if (!window.fetch || !window.Blob || !window.URL || !window.URL.createObjectURL)
		return;
	var requestId = quranPassageAudioState.requestId;
	var controller = null;
	if (window.AbortController) {
		controller = new AbortController();
		quranPassageAudioState.preloadAbortController = controller;
	}
	fetch(url, {
		cache: 'force-cache',
		credentials: 'same-origin',
		signal: controller ? controller.signal : undefined
	}).then(function (response) {
		if (!response.ok)
			throw new Error('Unable to preload Quran audio.');
		return response.blob();
	}).then(function (blob) {
		if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.preloadedUrl !== url)
			return;
		var objectUrl = window.URL.createObjectURL(blob);
		if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.preloadedUrl !== url) {
			revokeQuranPassageAudioObjectUrl(objectUrl);
			return;
		}
		releaseQuranPassageAudioPreloadedObjectUrl();
		quranPassageAudioState.preloadedObjectUrl = objectUrl;
		preloadQuranPassageAudioElement(objectUrl);
	}).catch(function (err) {
		if (err && err.name === 'AbortError')
			return;
		if (quranPassageAudioState.preloadedUrl === url && !quranPassageAudioState.preloadedObjectUrl)
			preloadQuranPassageAudioElement(url);
	}).finally(function () {
		if (quranPassageAudioState.preloadedUrl === url)
			quranPassageAudioState.preloadAbortController = null;
	});
}

function clearQuranPassageAudioSource(audio) {
	if (!audio)
		return;
	try {
		audio.pause();
		audio.removeAttribute('src');
		audio.load();
	} catch (_err) {}
	releaseQuranPassageAudioActiveObjectUrl();
}

function clearQuranPassageAudioPreloadSource() {
	var preloadAudio = quranPassageAudioState.preloadAudio;
	if (!preloadAudio)
		return;
	try {
		preloadAudio.pause();
		preloadAudio.removeAttribute('src');
		preloadAudio.load();
	} catch (_err) {}
}

function quranPassageAudioElement() {
	if (quranPassageAudioState.audio) {
		applyQuranPassageAudioPlaybackRate(quranPassageAudioState.audio);
		return quranPassageAudioState.audio;
	}
	var audio = new Audio();
	audio.preload = 'none';
	applyQuranPassageAudioPlaybackRate(audio);
	audio.addEventListener('ratechange', function () {
		var selectedRate = quranPassageAudioPlaybackRateOption().value;
		if (Math.abs(audio.playbackRate - selectedRate) > 0.001)
			applyQuranPassageAudioPlaybackRate(audio);
	});
	audio.addEventListener('ended', function () {
		hideQuranAudioTranslationMarquee();
		if (!quranPassageAudioState.control || quranPassageAudioState.playlist.length < 1)
			return;
		quranPassageAudioState.errorCount = 0;
		advanceQuranPassageAudio();
	});
	audio.addEventListener('error', function () {
		hideQuranAudioTranslationMarquee();
		if (!quranPassageAudioState.control || quranPassageAudioState.playlist.length < 1)
			return;
		quranPassageAudioState.errorCount += 1;
		if (quranPassageAudioState.errorCount >= quranPassageAudioState.playlist.length) {
			var failedControl = quranPassageAudioState.control;
			stopQuranPassageAudio(failedControl);
			if (window.toastr)
				toastr.error('Unable to play Quran audio.');
			return;
		}
		advanceQuranPassageAudio();
	});
	audio.addEventListener('playing', function () {
		if (!quranPassageAudioState.control)
			return;
		quranPassageAudioState.paused = false;
		quranPassageAudioState.errorCount = 0;
		var item = quranPassageAudioState.playlist[quranPassageAudioState.index];
		setQuranPassageAudioPlaying(quranPassageAudioState.control, true);
		setQuranPassageAudioStatus(quranPassageAudioState.control, item && item.verseKey ? `Playing ${item.verseKey}` : 'Playing');
		setQuranPassageAudioHighlight(quranPassageAudioState.control, item);
		showQuranAudioTranslationMarquee(item);
		preloadNextQuranPassageAudio();
	});
	audio.addEventListener('loadedmetadata', function () {
		applyQuranPassageAudioPlaybackRate(audio);
		if (!audio.paused && quranPassageAudioState.control) {
			var item = quranPassageAudioState.playlist[quranPassageAudioState.index];
			showQuranAudioTranslationMarquee(item);
		}
	});
	audio.addEventListener('timeupdate', function () {
		var control = quranPassageAudioState.control;
		var playlist = quranPassageAudioState.playlist;
		if (!control || !playlist.length || audio.paused)
			return;
		var currentMs = audio.currentTime * 1000;
		var item = playlist[quranPassageAudioState.index];
		var next = playlist[quranPassageAudioState.index + 1];
		if (!quranPassageAudioState.singleAyah && !quranPassageAudioState.repeat && playlist.length - quranPassageAudioState.index <= 3)
			extendQuranPassageAudioAcrossBoundary();
		while (next && next.url === item.url && currentMs >= Number(next.startMs)) {
			quranPassageAudioState.index += 1;
			item = next;
			next = playlist[quranPassageAudioState.index + 1];
			setQuranPassageAudioStatus(control, `Playing ${item.verseKey}`);
			setQuranPassageAudioHighlight(control, item);
			showQuranAudioTranslationMarquee(item);
		}
		if (item && Number.isFinite(Number(item.endMs)) && currentMs >= Number(item.endMs)
			&& (!next || next.url !== item.url) && !quranPassageAudioState.extending)
			advanceQuranPassageAudio();
	});
	quranPassageAudioState.audio = audio;
	return audio;
}

function playCurrentQuranPassageAudio() {
	var control = quranPassageAudioState.control;
	if (!control || quranPassageAudioState.playlist.length < 1)
		return;
	if (quranPassageAudioState.index >= quranPassageAudioState.playlist.length)
		quranPassageAudioState.index = 0;
	var item = quranPassageAudioState.playlist[quranPassageAudioState.index];
	if (!item || !item.url) {
		stopQuranPassageAudio(control);
		return;
	}
	setQuranPassageAudioHighlight(control, item);
	hideQuranAudioTranslationMarquee();
	var audio = quranPassageAudioElement();
	var sourceChanged = quranPassageAudioState.sourceUrl !== item.url;
	if (sourceChanged) {
		quranPassageAudioState.sourceUrl = item.url;
		audio.src = quranPassageAudioSourceUrl(item);
	}
	quranPassageAudioState.paused = false;
	setQuranPassageAudioPlaying(control, true);
	preloadNextQuranPassageAudio();
	var requestId = quranPassageAudioState.requestId;
	var beginPlayback = function () {
		if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== control)
			return;
		applyQuranPassageAudioPlaybackRate(audio);
		audio.currentTime = Math.max(0, Number(item.startMs) || 0) / 1000;
		var playPromise = audio.play();
		if (playPromise && playPromise.catch) {
			playPromise.catch(function (err) {
				if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== control)
					return;
				stopQuranPassageAudio(control);
				if (window.toastr)
					toastr.error(err.message || 'Unable to play Quran audio.');
			});
		}
	};
	if (sourceChanged && audio.readyState < 1) {
		audio.addEventListener('loadedmetadata', beginPlayback, { once: true });
		audio.load();
	} else {
		try {
			beginPlayback();
		} catch (err) {
			if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== control)
				return;
			stopQuranPassageAudio(control);
			if (window.toastr)
				toastr.error(err.message || 'Unable to play Quran audio.');
		}
	}
}

function pauseQuranPassageAudio(control) {
	var activeControl = control || quranPassageAudioState.control;
	if (!activeControl || quranPassageAudioState.control !== activeControl || !quranPassageAudioState.audio)
		return;
	quranPassageAudioState.audio.pause();
	quranPassageAudioState.paused = true;
	if (quranAudioTranslationMarqueeState.animation)
		quranAudioTranslationMarqueeState.animation.pause();
	setQuranPassageAudioPlaying(activeControl, false);
	setQuranPassageAudioStatus(activeControl, 'Paused');
}

function resumeQuranPassageAudio(control) {
	var activeControl = control || quranPassageAudioState.control;
	if (!activeControl || quranPassageAudioState.control !== activeControl || !quranPassageAudioState.audio)
		return;
	var audio = quranPassageAudioState.audio;
	applyQuranPassageAudioPlaybackRate(audio);
	quranPassageAudioState.paused = false;
	if (quranAudioTranslationMarqueeState.animation)
		quranAudioTranslationMarqueeState.animation.play();
	setQuranPassageAudioPlaying(activeControl, true);
	var requestId = quranPassageAudioState.requestId;
	var playPromise = audio.play();
	if (playPromise && playPromise.catch) {
		playPromise.catch(function (err) {
			if (quranPassageAudioState.requestId !== requestId || quranPassageAudioState.control !== activeControl)
				return;
			stopQuranPassageAudio(activeControl);
			if (window.toastr)
				toastr.error(err.message || 'Unable to play Quran audio.');
		});
	}
}

function stopQuranPassageAudio(control) {
	quranPassageAudioState.requestId += 1;
	hideQuranAudioTranslationMarquee();
	var activeControl = control || quranPassageAudioState.control;
	clearQuranPassageAudioSource(quranPassageAudioState.audio);
	resetQuranPassageAudioPreload();
	quranPassageAudioState.control = null;
	quranPassageAudioState.errorCount = 0;
	quranPassageAudioState.extending = null;
	quranPassageAudioState.index = 0;
	quranPassageAudioState.paused = false;
	quranPassageAudioState.playlist = [];
	quranPassageAudioState.repeat = false;
	quranPassageAudioState.singleAyah = false;
	quranPassageAudioState.sourceUrl = '';
	quranPassageAudioState.tailControl = null;
	if (activeControl) {
		clearQuranPassageAudioHighlight(activeControl);
		setQuranPassageAudioLoading(activeControl, false);
		setQuranPassageAudioPlaying(activeControl, false);
		setQuranPassageAudioStatus(activeControl, '');
	} else {
		clearQuranPassageAudioHighlight();
	}
	syncQuranPassageAudioStopControls();
	syncMobileFooterAudioControls();
}

function selectedQuranPassageReciterId(control) {
	var select = quranPassageAudioControls(control).select;
	var value = control && control.getAttribute('data-quran-audio-reciter-override') || (select ? select.value : '');
	value = (value || 'juhani').toString().trim();
	if (value === '7' || value === 'johani')
		value = 'juhani';
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : 'juhani';
}

function quranPassageAudioReciterLabel(control) {
	control = control || Array.from(document.querySelectorAll('[data-quran-passage-audio="1"]')).find(quranPassageAudioControlIsVisible) || null;
	var select = control && quranPassageAudioControls(control).select;
	var reciterId = control ? selectedQuranPassageReciterId(control) : (storedQuranPassageRecitationId() || 'juhani');
	var option = select && Array.from(select.options).find(function (candidate) {
		return candidate.value === reciterId;
	});
	if (option && option.textContent.trim())
		return option.textContent.trim();
	return reciterId.charAt(0).toUpperCase() + reciterId.slice(1).replace(/[-_]+/g, ' ');
}

function quranPassageAudioRequestUrl(control, requestedRange) {
	var range = requestedRange || quranPassageAudioControlRange(control);
	var url = new URL(quranApiPath('/proxy/quran-audio/passage'), window.location.origin);
	url.searchParams.set('s', range.surah || '');
	url.searchParams.set('from', range.from || '');
	url.searchParams.set('to', range.to || '');
	url.searchParams.set('reciter', selectedQuranPassageReciterId(control));
	return url.toString();
}

function loadQuranPassageAudio(control, options) {
	return Promise.all(quranPassageAudioRequestRanges(control, options).map(function (range) {
		return fetch(quranPassageAudioRequestUrl(control, range), {
		cache: 'no-store',
		credentials: 'same-origin',
		headers: { Accept: 'application/json' }
		}).then(function (response) {
		if (!response.ok)
			return responseErrorMessage(response, 'Unable to load Quran audio.').then(function (message) {
				throw new Error(message);
			});
			return response.json();
		});
	})).then(function (payloads) {
		var playlist = payloads.flatMap(function (payload) { return Array.isArray(payload.audio) ? payload.audio : []; });
		playlist = playlist.filter(function (item) {
			return item && item.url;
		});
		if (options && options.singleAyah) {
			var singleRef = quranPassageAudioStartRef(control, options);
			var singleKey = quranAudioRefKey(singleRef);
			playlist = playlist.filter(function (item) {
				return quranAudioRefKey(quranAudioRefParts(item && item.verseKey || '')) === singleKey;
			});
		}
		if (playlist.length < 1)
			throw new Error('No Quran audio is available for this passage.');
		return playlist;
	});
}

function startQuranPassageAudio(control, options) {
	options = options || {};
	initMobileFooterAudioControls();
	if (quranPassageAudioState.control && (quranPassageAudioState.control !== control || options.restart))
		stopQuranPassageAudio(quranPassageAudioState.control);
	var requestId = quranPassageAudioState.requestId + 1;
	quranPassageAudioState.requestId = requestId;
	quranPassageAudioState.control = control;
	quranPassageAudioState.errorCount = 0;
	quranPassageAudioState.extending = null;
	quranPassageAudioState.index = 0;
	quranPassageAudioState.paused = false;
	quranPassageAudioState.playlist = [];
	quranPassageAudioState.tailControl = control;
	syncQuranPassageAudioStopControls();
	resetQuranPassageAudioPreload();
	quranPassageAudioState.repeat = quranPassageAudioRepeatEnabled(control);
	quranPassageAudioState.singleAyah = Boolean(options.singleAyah);
	setQuranPassageAudioLoading(control, true);
	setQuranPassageAudioStatus(control, 'Loading');
	loadQuranPassageAudio(control, options).then(function (playlist) {
		if (quranPassageAudioState.requestId !== requestId)
			return;
		quranPassageAudioState.errorCount = 0;
		quranPassageAudioState.index = quranPassageAudioStartIndex(control, playlist, options);
		quranPassageAudioState.paused = false;
		quranPassageAudioState.playlist = playlist;
		quranPassageAudioState.tailControl = control;
		quranPassageAudioState.repeat = quranPassageAudioRepeatEnabled(control);
		setQuranPassageAudioLoading(control, false);
		playCurrentQuranPassageAudio();
	}).catch(function (err) {
		if (quranPassageAudioState.requestId !== requestId)
			return;
		stopQuranPassageAudio(control);
		if (window.toastr)
			toastr.error(err.message || 'Unable to load Quran audio.');
	}).finally(function () {
		if (quranPassageAudioState.requestId === requestId && quranPassageAudioState.control !== control)
			setQuranPassageAudioLoading(control, false);
	});
}

function populateQuranPassageReciterSelect(selector, recitations, preferredReciter) {
	var preferred = preferredReciter || storedQuranPassageRecitationId() || selector.value || 'juhani';
	if (preferred === '7' || preferred === 'johani')
		preferred = 'juhani';
	if (Array.isArray(recitations)) {
		selector.innerHTML = '';
		recitations.forEach(function (recitation) {
			var option = document.createElement('option');
			option.value = recitation.id || recitation.slug || recitation.shortName || 'juhani';
			option.textContent = recitation.label || recitation.shortName || recitation.reciter_name || `Reciter ${option.value}`;
			selector.appendChild(option);
		});
	}
	var hasPreferred = Array.from(selector.options).some(function (option) {
		return option.value === preferred;
	});
	selector.value = hasPreferred ? preferred : (selector.querySelector('option') ? selector.querySelector('option').value : 'juhani');
	syncQuranPassageReciterMenu(selector);
}

function syncQuranPassageReciterSelection(reciter) {
	document.querySelectorAll('[data-quran-passage-reciter-select="1"]').forEach(function (selector) {
		if (Array.from(selector.options).some(function (option) { return option.value === reciter; }))
			selector.value = reciter;
		syncQuranPassageReciterMenu(selector);
	});
}

function syncQuranPassageReciterMenu(selector) {
	var control = selector && selector.closest('.quran-passage-reciter-control');
	var menu = control && control.querySelector('[data-quran-passage-reciter-menu="1"]');
	var toggle = control && control.querySelector('.quran-passage-reciter-toggle');
	if (!menu)
		return;
	menu.innerHTML = '';
	Array.from(selector.options).forEach(function (option) {
		var item = document.createElement('li');
		var button = document.createElement('button');
		button.type = 'button';
		button.className = `dropdown-item${option.value === selector.value ? ' active' : ''}`;
		button.setAttribute('data-quran-passage-reciter-option', option.value);
		button.textContent = option.textContent;
		if (option.value === selector.value)
			button.setAttribute('aria-current', 'true');
		item.appendChild(button);
		menu.appendChild(item);
	});
	var selected = selector.options[selector.selectedIndex];
	if (toggle && selected) {
		toggle.title = `Reciter: ${selected.textContent}`;
		toggle.setAttribute('aria-label', `Choose reciter. Current reciter: ${selected.textContent}`);
	}
}

function syncQuranAudioTranslationSelection(alias) {
	alias = validQuranTranslationAlias(alias);
	document.querySelectorAll('[data-quran-audio-translation-select="1"]').forEach(function (selector) {
		if (Array.from(selector.options).some(function (option) { return option.value === alias; }))
			selector.value = alias;
		syncQuranAudioTranslationMenu(selector);
	});
}

function syncQuranAudioTranslationMenu(selector) {
	var control = selector && selector.closest('.quran-audio-translation-control, .quran-dynamic-translation-control');
	var menu = control && control.querySelector('[data-quran-audio-translation-menu="1"]');
	var toggle = control && control.querySelector('.quran-audio-translation-toggle, .quran-dynamic-translation-toggle');
	if (!menu)
		return;
	menu.innerHTML = '';
	Array.from(selector.options).forEach(function (option) {
		var item = document.createElement('li');
		var button = document.createElement('button');
		button.type = 'button';
		button.className = `dropdown-item${option.value === selector.value ? ' active' : ''}`;
		button.setAttribute('data-quran-audio-translation-option', option.value);
		button.textContent = option.textContent;
		if (option.value === selector.value)
			button.setAttribute('aria-current', 'true');
		item.appendChild(button);
		menu.appendChild(item);
	});
	var selected = selector.options[selector.selectedIndex];
	if (toggle && selected) {
		toggle.title = `Translation: ${selected.textContent}`;
		toggle.setAttribute('aria-label', `Choose translation. Current translation: ${selected.textContent}`);
		var label = toggle.querySelector('[data-quran-dynamic-translation-label]');
		if (label)
			label.textContent = selected.textContent;
	}
}

function bindQuranDynamicTranslationMenu(selector) {
	if (!selector || selector.dataset.quranDynamicTranslationMenuBound === 'true')
		return;
	selector.dataset.quranDynamicTranslationMenuBound = 'true';
	var control = selector.closest('.quran-audio-translation-control, .quran-dynamic-translation-control');
	var menu = control && control.querySelector('[data-quran-audio-translation-menu="1"]');
	if (!menu)
		return;
	menu.addEventListener('click', function (event) {
		var option = event.target.closest('[data-quran-audio-translation-option]');
		if (!option)
			return;
		selector.value = option.getAttribute('data-quran-audio-translation-option') || '';
		selector.dispatchEvent(new Event('change', { bubbles: true }));
	});
}

function initQuranAudioTranslationSelects(controls) {
	var selectors = controls.map(function (control) {
		return control.querySelector('[data-quran-audio-translation-select="1"]');
	}).filter(Boolean);
	if (selectors.length < 1)
		return;
	Promise.all([quranTranslationBooks(), getQuranTafsirSettings().catch(function () { return {}; })]).then(function (results) {
		var settings = results[1] || {};
		var preferredAlias = storedQuranSelectedTranslationAlias()
			|| settings.translations && settings.translations.preferredAlias
			|| '';
		var choices = orderedSelectableQuranTranslationBooks(results[0], settings).filter(function (book) {
			var disabled = settings.translations && Array.isArray(settings.translations.disabledAliases)
				? settings.translations.disabledAliases
				: [];
			return book && (book.source === 'default' || !disabled.includes(book.alias));
		});
		selectors.forEach(function (selector) {
			selector.innerHTML = '';
			choices.forEach(function (book) {
				var option = document.createElement('option');
				option.value = book.source === 'default' ? '' : book.alias;
				option.textContent = quranTranslationBookLabel(book);
				selector.appendChild(option);
			});
			selector.value = quranTranslationSelectValue(preferredAlias, choices);
			syncQuranAudioTranslationMenu(selector);
			bindQuranDynamicTranslationMenu(selector);
		});
	}).catch(function () {});
	selectors.forEach(function (selector) {
		selector.addEventListener('change', function () {
			var alias = validQuranTranslationAlias(selector.value || '');
			syncQuranAudioTranslationSelection(alias);
			setQuranPassageTranslationSelectValue(alias);
			saveQuranPreferredTranslationAlias(alias).catch(function (err) {
				if (window.toastr)
					toastr.error(err.message || 'Unable to save translation preference.', 'Settings');
			});
			var activeItem = quranPassageAudioState.playlist[quranPassageAudioState.index];
			if (quranPassageAudioState.control && !quranPassageAudioState.paused && activeItem)
				showQuranAudioTranslationMarquee(activeItem, { force: true });
		});
		bindQuranDynamicTranslationMenu(selector);
	});
}

function initQuranPassageAudioControls(root) {
	var scope = root || document;
	var controls = Array.from(scope.querySelectorAll('[data-quran-passage-audio="1"]')).filter(function (control) {
		if (control.dataset.quranPassageAudioBound === 'true')
			return false;
		control.dataset.quranPassageAudioBound = 'true';
		return true;
	});
	if (controls.length < 1)
		return;
	initMobileFooterAudioControls();
	initQuranAudioTranslationSelects(controls);
	Promise.all([quranPassageAudioRecitations(), getQuranTafsirSettings()]).then(function (results) {
		var recitations = results[0];
		var settings = results[1] || {};
		var disabledReciters = new Set(settings.audio && Array.isArray(settings.audio.disabledReciters) ? settings.audio.disabledReciters : []);
		recitations = recitations.filter(function (recitation) {
			return !disabledReciters.has(recitation.id || recitation.slug);
		});
		var preferredReciter = settings.audio && settings.audio.preferredReciter || storedQuranPassageRecitationId() || 'juhani';
		if (!recitations.some(function (recitation) { return (recitation.id || recitation.slug) === preferredReciter; }))
			preferredReciter = recitations.some(function (recitation) { return (recitation.id || recitation.slug) === 'juhani'; })
				? 'juhani'
				: (recitations[0] && (recitations[0].id || recitations[0].slug) || '');
		controls.forEach(function (control) {
			var parts = quranPassageAudioControls(control);
			var selector = parts.select;
			if (selector)
				populateQuranPassageReciterSelect(selector, recitations, preferredReciter);
			if (parts.play) {
				parts.play.disabled = recitations.length < 1;
				if (recitations.length < 1)
					parts.play.title = 'Enable a reciter in My Settings to play Quran audio';
			}
		});
	}).catch(function () {});
	controls.forEach(function (control) {
		var controlParts = quranPassageAudioControls(control);
		setQuranPassageAudioRepeat(control, quranPassageAudioRepeatEnabled(control));
		if (controlParts.select) {
			populateQuranPassageReciterSelect(controlParts.select, null);
			controlParts.select.addEventListener('change', function () {
				var reciter = controlParts.select.value || 'juhani';
				var activeItem = quranPassageAudioState.playlist[quranPassageAudioState.index];
				var activeRef = quranAudioRefParts(activeItem && activeItem.verseKey || '');
				syncQuranPassageReciterSelection(reciter);
				saveQuranPreferredReciter(reciter).catch(function (err) {
					if (window.toastr)
						toastr.error(err.message || 'Unable to save preferred reciter.');
				});
				if (quranPassageAudioState.control === control) {
					startQuranPassageAudio(control, {
						startSurah: activeRef.surah,
						startAyah: activeRef.ayah,
						restart: true
					});
				}
			});
			var reciterMenu = control.querySelector('[data-quran-passage-reciter-menu="1"]');
			if (reciterMenu) {
				reciterMenu.addEventListener('click', function (event) {
					var option = event.target.closest('[data-quran-passage-reciter-option]');
					if (!option)
						return;
					controlParts.select.value = option.getAttribute('data-quran-passage-reciter-option') || 'juhani';
					controlParts.select.dispatchEvent(new Event('change', { bubbles: true }));
				});
			}
		}
		if (controlParts.play) {
			controlParts.play.addEventListener('click', function () {
				if (quranPassageAudioState.control === control && quranPassageAudioState.paused)
					resumeQuranPassageAudio(control);
				else if (quranPassageAudioState.control === control && control.classList.contains('is-playing'))
					pauseQuranPassageAudio(control);
				else {
					var mushafPage = control.closest('[data-quran-mushaf-page]');
					var selectedRef = quranAudioRefParts(mushafPage && mushafPage.dataset.quranMushafSelectedRef || '');
					startQuranPassageAudio(control, Number.isInteger(selectedRef.ayah) ? {
						startSurah: selectedRef.surah,
						startAyah: selectedRef.ayah
					} : {});
				}
			});
		}
		if (controlParts.pause) {
			controlParts.pause.addEventListener('click', function () {
				pauseQuranPassageAudio(control);
			});
		}
		if (controlParts.stop) {
			controlParts.stop.addEventListener('click', function () {
				stopQuranPassageAudio(quranPassageAudioState.control || control);
			});
		}
		if (controlParts.repeat) {
			controlParts.repeat.addEventListener('click', function () {
				toggleQuranPassageAudioRepeat(control);
			});
		}
	});
	syncQuranPassageAudioStopControls();
}

function waitForHadithAuthClient() {
	return new Promise(function (resolve) {
		if (window.hadithAuth && window.hadithAuth.getUser)
			return resolve(window.hadithAuth);
		var attempts = 0;
		var timer = window.setInterval(function () {
			attempts += 1;
			if (window.hadithAuth && window.hadithAuth.getUser) {
				window.clearInterval(timer);
				resolve(window.hadithAuth);
			} else if (attempts >= 20) {
				window.clearInterval(timer);
				resolve(null);
			}
		}, 100);
	});
}

function saveQuranPreferredTranslationAlias(alias) {
	alias = validQuranTranslationAlias(alias);
	storeQuranSelectedTranslationAlias(alias);
	return getQuranTafsirSettings().then(function (currentSettings) {
		var nextOverride = Object.assign({}, currentSettings || {}, {
			translations: Object.assign({}, currentSettings && currentSettings.translations || {}, {
				preferredAlias: alias || ''
			})
		});
		window.hadithQuranUserSettingsOverride = nextOverride;
		return waitForHadithAuthClient().then(function (auth) {
			return Promise.resolve(auth && auth.getUser ? auth.getUser() : null).then(function (user) {
				if (!user)
					return null;
				return Promise.resolve(auth && auth.requireToken
					? auth.requireToken('Please sign in once to refresh your local session.')
					: (auth && auth.getToken ? auth.getToken() : null)).then(function (token) {
					if (!token)
						return null;
					return fetch(quranApiPath('/user-settings?optional=1'), {
						credentials: 'same-origin',
						headers: { 'Authorization': `Bearer ${token}` }
					}).then(function (response) {
						if (!response.ok)
							throw new Error('Unable to load settings.');
						return response.json();
					}).then(function (data) {
						var settings = data && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {};
						var translations = settings.translations && typeof settings.translations === 'object' && !Array.isArray(settings.translations) ? settings.translations : {};
						var nextSettings = Object.assign({}, settings, {
							translations: Object.assign({}, translations, { preferredAlias: alias || '' })
						});
						delete nextSettings.personalized;
						return fetch(quranApiPath('/user-settings'), {
							method: 'PUT',
							credentials: 'same-origin',
							headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
							body: JSON.stringify({ settings: nextSettings })
						}).then(function (response) {
							if (!response.ok)
								throw new Error('Unable to save translation preference.');
							return response.json();
						}).then(function (saved) {
							updateCachedQuranUserSettings(user, saved.settings || nextSettings);
							return saved;
						});
					});
				});
			});
		});
	});
}

function initQuranSelectedTranslationBookPreference(root) {
	var scope = root || document;
	Array.from(scope.querySelectorAll('[data-quran-selected-translation-book]')).forEach(function (element) {
		if (element.dataset.quranSelectedTranslationBookBound === 'true')
			return;
		element.dataset.quranSelectedTranslationBookBound = 'true';
		var alias = validQuranTranslationAlias(element.getAttribute('data-quran-selected-translation-book') || '');
		if (!alias)
			return;
		saveQuranPreferredTranslationAlias(alias).then(function () {
			setQuranPassageTranslationSelectValue(alias);
			updateQuranTranslationPreferenceHearts(document, alias);
		}).catch(function (err) {
			if (window.toastr)
				toastr.error(err.message || 'Unable to save translation preference.', 'Settings');
		});
	});
}

function initQuranTranslationAttributionSelectors(root) {
	var scope = root || document;
	var targets = Array.from(scope.querySelectorAll('[data-quran-translation-target="1"]'));
	if (targets.length < 1)
		return;
	Promise.all([quranTranslationBooks(), getQuranTafsirSettings().catch(function () { return {}; })]).then(function (results) {
		var choices = orderedSelectableQuranTranslationBooks(results[0], results[1]);
		targets.forEach(function (target) {
			storeDefaultQuranTranslationTarget(target);
			var holder = quranTranslationTargetHolder(target);
			var attribution = holder ? holder.querySelector('[data-quran-translation-attribution="1"]') : null;
			if (!holder || !attribution || holder.querySelector('[data-quran-translation-selector="1"]'))
				return;
			var selector = document.createElement('select');
			selector.className = 'quran-translation-selector form-select form-select-sm d-none';
			selector.setAttribute('data-quran-translation-selector', '1');
			selector.setAttribute('aria-label', 'Quran translation');
			choices.forEach(function (book) {
				var option = document.createElement('option');
				option.value = book.source === 'default' ? '' : book.alias;
				option.textContent = quranTranslationBookLabel(book);
				selector.appendChild(option);
			});
			selector.value = target.dataset.quranTranslationAlias || '';
			var attributionLink = attribution.closest('a');
			if (attributionLink && holder.contains(attributionLink))
				attributionLink.insertAdjacentElement('afterend', selector);
			else
				attribution.insertAdjacentElement('afterend', selector);
			var hideSelector = function () {
				selector.classList.add('d-none');
				attribution.classList.remove('d-none');
			};
			var showSelector = function (event) {
				if (event) {
					event.preventDefault();
					event.stopPropagation();
				}
				document.querySelectorAll('[data-quran-translation-selector="1"]').forEach(function (otherSelector) {
					if (otherSelector === selector)
						return;
					otherSelector.classList.add('d-none');
					var otherTargetRoot = otherSelector.closest('[data-quran-translation-attribution-scope="range"], .quran-ayah-hero-ayah, .body');
					var otherHolder = quranTranslationTargetHolder(otherTargetRoot?.querySelector('[data-quran-translation-target="1"]'));
					var otherAttribution = otherHolder ? otherHolder.querySelector('[data-quran-translation-attribution="1"]') : null;
					if (otherAttribution)
						otherAttribution.classList.remove('d-none');
				});
				attribution.classList.add('d-none');
				var currentAlias = target.dataset.quranTranslationAlias || selector.value || '';
				selector.value = currentAlias;
				selector.dataset.quranOpenAlias = selector.value;
				selector.dataset.quranSelectionCommitted = '0';
				selector.classList.remove('d-none');
				selector.focus();
			};
			attribution.addEventListener('click', showSelector);
			attribution.addEventListener('keydown', function (event) {
				if (event.key === 'Enter' || event.key === ' ') {
					showSelector(event);
				}
			});
			selector.addEventListener('click', function (event) {
				event.stopPropagation();
			});
			selector.addEventListener('blur', function () {
				window.setTimeout(function () {
					if (selector.dataset.quranSelectionCommitted !== '1') {
						var openAlias = selector.dataset.quranOpenAlias || '';
						selector.value = openAlias;
						applyQuranHeroTranslationAlias(openAlias, { persist: false }).finally(function () {
							hideSelector();
						});
						return;
					}
					hideSelector();
				}, 150);
			});
			selector.addEventListener('change', function () {
				if (document.activeElement !== selector && selector.value !== (target.dataset.quranTranslationAlias || '')) {
					selector.value = target.dataset.quranTranslationAlias || '';
					return;
				}
				selector.dataset.quranSelectionCommitted = '1';
				window.quranTranslationUserSelectedAt = Date.now();
				applyQuranHeroTranslationAlias(selector.value, { persist: true }).finally(function () {
					hideSelector();
				});
			});
		});
	}).catch(function () {});
}

function initQuranPreferredTranslationDisplays(root) {
	var scope = root || document;
	var initializedAt = Date.now();
	var selectedTranslationAlias = quranSelectedTranslationAliasFromLocation();
	var targets = Array.from(scope.querySelectorAll('[data-quran-translation-target="1"]')).filter(function (target) {
		var modal = target.closest('.quran-ayah-modal');
		if (modal && !modal.classList.contains('show') && $(modal).data('quranAyahModalOpening') !== true)
			return false;
		if (target.closest('.quran-ayah-modal-pane.d-none'))
			return false;
		if (target.dataset.quranTranslationDisplayBound === 'true')
			return false;
		target.dataset.quranTranslationDisplayBound = 'true';
		return true;
	});
	if (targets.length < 1)
		return;
	targets.forEach(function (target) {
		storeDefaultQuranTranslationTarget(target);
		setQuranTranslationAttribution(target, defaultQuranTranslationShortName(), '');
	});
	var hasServerRenderedTranslation = targets.every(function (target) {
		return target.dataset.quranTranslationServerRendered === '1'
			&& validQuranTranslationAlias(target.dataset.quranFixedTranslationAlias || '') === selectedTranslationAlias;
	});
	if (hasServerRenderedTranslation) {
		var syncServerRenderedTranslation = function (book) {
			var label = selectedTranslationAlias ? quranTranslationBookLabel(book) : defaultQuranTranslationShortName();
			clearQuranSelectedTranslationFootnotes(scope);
			targets.forEach(function (target) {
				setQuranTranslationTargetEditable(target, !selectedTranslationAlias);
				target.innerHTML = quranPassageTranslationHtml(target.innerHTML || '', target, selectedTranslationAlias);
				setQuranTranslationAttribution(target, label, selectedTranslationAlias);
			});
			updateQuranTranslationPreferenceHearts(document, selectedTranslationAlias);
		};
		(selectedTranslationAlias ? quranTranslationBooks().then(function (books) {
			var book = books.find(function (candidate) {
				return candidate && candidate.alias === selectedTranslationAlias;
			}) || { alias: selectedTranslationAlias };
			syncServerRenderedTranslation(book);
		}) : Promise.resolve().then(function () {
			syncServerRenderedTranslation(null);
		})).catch(function () {
			targets.forEach(function (target) {
				setQuranTranslationAttribution(target, defaultQuranTranslationShortName(), '');
			});
		}).finally(function () {
			initQuranTranslationAttributionSelectors(scope);
		});
		return;
	}
	getQuranTafsirSettings().then(function (settings) {
		if (window.quranTranslationUserSelectedAt && window.quranTranslationUserSelectedAt > initializedAt)
			return null;
		var fixedTranslationAlias = targets.map(function (target) {
			return validQuranTranslationAlias(target.dataset.quranFixedTranslationAlias || '');
		}).find(Boolean) || '';
		var preferredAlias = fixedTranslationAlias || selectedTranslationAlias || (settings && settings.translations ? settings.translations.preferredAlias : '');
		return applyQuranHeroTranslationAlias(preferredAlias || '', {
			persist: false,
			root: scope
		}).then(function (book) {
			if (selectedTranslationAlias && !fixedTranslationAlias && book && book.source !== 'default') {
				saveQuranPreferredTranslationAlias(book.alias).catch(function () {});
				updateQuranTranslationPreferenceHearts(document, selectedTranslationAlias);
			}
			return book;
		});
	}).catch(function () {
		targets.forEach(function (target) {
			setQuranTranslationAttribution(target, defaultQuranTranslationShortName(), '');
		});
	}).finally(function () {
		initQuranTranslationAttributionSelectors(scope);
	});
}

function originFromUrl(url) {
	try {
		return url ? new URL(url, window.location.href).origin : '';
	} catch (err) {
		return '';
	}
}

function userSettingsCacheUser(user) {
	if (!user || typeof user !== 'object')
		return null;
	return {
		uid: user.uid || user.userId || '',
		email: user.email || ''
	};
}

var quranTafsirSettingsPromise = null;

function updateCachedQuranUserSettings(user, settings) {
	var cacheUser = userSettingsCacheUser(user);
	if (window.hadithUserSettingsCache && window.hadithUserSettingsCache.write)
		window.hadithUserSettingsCache.write(cacheUser, settings || {});
	window.hadithQuranUserSettingsOverride = settings || null;
	quranTafsirSettingsPromise = null;
}

window.updateCachedQuranUserSettings = updateCachedQuranUserSettings;

function responseErrorMessage(response, fallback) {
	return response.text().then(function (text) {
		if (!text)
			return fallback;
		try {
			var data = JSON.parse(text);
			return (data && (data.error || data.message)) || fallback;
		} catch (_err) {
			return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
		}
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
		var translations = source.translations && typeof source.translations === 'object' && !Array.isArray(source.translations) ? source.translations : {};
		var audio = source.audio && typeof source.audio === 'object' && !Array.isArray(source.audio) ? source.audio : {};
		var quran = source.quran && typeof source.quran === 'object' && !Array.isArray(source.quran) ? source.quran : {};
		var quranScript = ['uthmani', 'indo-pak', 'warsh'].indexOf((quran.script || '').toString().toLowerCase()) >= 0
			? quran.script.toString().toLowerCase()
			: 'uthmani';
		var translationDisabledAliases = Array.from(new Set((Array.isArray(translations.disabledAliases) ? translations.disabledAliases : [])
			.map(function (alias) { return (alias || '').toString().trim(); })
			.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias); })));
		var translationDisabled = new Set(translationDisabledAliases);
		return {
			quran: { script: quranScript },
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
			},
			translations: {
				disabledAliases: translationDisabledAliases,
				order: Array.from(new Set((Array.isArray(translations.order) ? translations.order : [])
					.map(function (alias) { return (alias || '').toString().trim(); })
					.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias) && !translationDisabled.has(alias); }))),
				preferredAlias: /^[A-Za-z0-9_-]+$/.test((translations.preferredAlias || '').toString().trim())
					? translations.preferredAlias.toString().trim()
					: ''
			},
			audio: {
				disabledReciters: Array.from(new Set((Array.isArray(audio.disabledReciters) ? audio.disabledReciters : [])
					.map(function (alias) { return (alias || '').toString().trim(); })
					.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias); }))),
				preferredReciter: /^[A-Za-z0-9_-]+$/.test((audio.preferredReciter || '').toString().trim())
					? audio.preferredReciter.toString().trim()
					: 'juhani'
			}
		};
	};
	var defaultSettings = function () {
		var settings = normalizeSettings({});
		settings.translations.preferredAlias = storedQuranSelectedTranslationAlias();
		settings.personalized = false;
		return settings;
	};
	var personalizedSettings = function (settings) {
		settings = normalizeSettings(settings);
		settings.personalized = true;
		return settings;
	};
	if (window.hadithQuranUserSettingsOverride)
		return Promise.resolve(personalizedSettings(window.hadithQuranUserSettingsOverride));
	if (quranTafsirSettingsPromise)
		return quranTafsirSettingsPromise;
	quranTafsirSettingsPromise = waitForHadithAuth().then(function (auth) {
		return Promise.resolve(auth && auth.getUser ? auth.getUser() : null).then(function (settingsUser) {
			if (!settingsUser)
				return defaultSettings();
			var cachedSettings = window.hadithUserSettingsCache && window.hadithUserSettingsCache.read
				? window.hadithUserSettingsCache.read(settingsUser)
				: null;
			if (cachedSettings)
				return personalizedSettings(cachedSettings);
			return Promise.resolve(auth && auth.getToken ? auth.getToken() : null).then(function (token) {
				return fetch(quranApiPath('/user-settings?optional=1'), {
					credentials: 'same-origin',
					headers: token ? { 'Authorization': `Bearer ${token}` } : {}
				}).then(function (response) {
					if (!response.ok)
						throw new Error('Unable to load user settings.');
					return response.json();
				}).then(function (data) {
					if (!data)
						return personalizedSettings({});
					var settings = personalizedSettings(data.settings || {});
					updateCachedQuranUserSettings(settingsUser, data.settings || {});
					return settings;
				}).catch(function () {
					return defaultSettings();
				});
			});
		});
	}).catch(function (err) {
		quranTafsirSettingsPromise = null;
		throw err;
	});
	return quranTafsirSettingsPromise;
}

	function tafsirPreferenceLanguageRank(lang) {
		if (lang === 'en')
			return 0;
		if (lang === 'ar')
			return 1;
		return Number.MAX_SAFE_INTEGER;
	}

	function defaultArabicTafsirOrder() {
		return [
			'en-tafsir-jalalayn',
			'en-tafsir-mokhtasar',
			'en-tafsir-ibn-kathir'
		];
	}

	function tafsirPreferenceLanguageOrder(order, lang) {
		var languageOrder = order && Array.isArray(order[lang]) ? order[lang] : [];
		if (lang === 'ar' && languageOrder.length < 1)
			return defaultArabicTafsirOrder();
		return languageOrder;
	}

	function tafsirPreferenceDeathYear(value) {
		var match = (value || '').toString().match(/\d+/);
		return match ? Number(match[0]) : NaN;
	}

	function compareTafsirPreferenceEntries(a, b, order) {
		var aBook = a.book || {};
		var bBook = b.book || {};
		var aLang = aBook.lang || '';
		var bLang = bBook.lang || '';
		var aLangRank = tafsirPreferenceLanguageRank(aLang);
		var bLangRank = tafsirPreferenceLanguageRank(bLang);
		if (aLangRank !== bLangRank)
			return aLangRank - bLangRank;
		var languageOrder = tafsirPreferenceLanguageOrder(order, aLang);
		var aIndex = languageOrder.indexOf(aBook.alias || '');
		var bIndex = languageOrder.indexOf(bBook.alias || '');
		aIndex = aIndex >= 0 ? aIndex : Number.MAX_SAFE_INTEGER;
		bIndex = bIndex >= 0 ? bIndex : Number.MAX_SAFE_INTEGER;
		if (aIndex !== bIndex)
			return aIndex - bIndex;
		var aDeath = tafsirPreferenceDeathYear(aBook.death);
		var bDeath = tafsirPreferenceDeathYear(bBook.death);
		var aHasDeath = Number.isFinite(aDeath) && aDeath > 0;
		var bHasDeath = Number.isFinite(bDeath) && bDeath > 0;
		if (aHasDeath && bHasDeath && aDeath !== bDeath)
			return aDeath - bDeath;
		if (aHasDeath !== bHasDeath)
			return aHasDeath ? -1 : 1;
		var ordinal = Number(aBook.ordinal || 0) - Number(bBook.ordinal || 0);
		if (ordinal !== 0)
			return ordinal;
		return (a.originalIndex || 0) - (b.originalIndex || 0);
	}

	function compareTafsirAlphabeticalEntries(a, b) {
		var aBook = a && a.book || {};
		var bBook = b && b.book || {};
		var aLabel = (a && a.label || aBook.shortName_en || aBook.name_en || aBook.author_en || aBook.alias || '').toString().replace(/^tafs[īi]r\s+/i, '').trim();
		var bLabel = (b && b.label || bBook.shortName_en || bBook.name_en || bBook.author_en || bBook.alias || '').toString().replace(/^tafs[īi]r\s+/i, '').trim();
		var labelOrder = aLabel.localeCompare(bLabel, 'en', { sensitivity: 'base' });
		if (labelOrder !== 0)
			return labelOrder;
		return (aBook.lang || '').localeCompare(bBook.lang || '', 'en', { sensitivity: 'base' });
	}

function initQuranAyahModals(root) {
	var scope = root || document;
	var modalStates = $(document).data('quranAyahModalStates') || {};
	$(document).data('quranAyahModalStates', modalStates);
	$(scope).find('.quran-ayah-modal').each(function () {
		var modal = $(this);
		var modalType = modal.attr('data-quran-ayah-modal-type') || 'tafsirs';
		if (modal.data('quranAyahModalBound')) {
			var refreshExistingPanes = modal.data('quranAyahModalRefreshPanes');
			if (typeof refreshExistingPanes === 'function')
				refreshExistingPanes();
			modalStates[modalType] = modal.data('quranAyahModalState');
			return;
		}
		modal.data('quranAyahModalBound', true);
		var panes = modal.find('[data-quran-ayah-modal-pane]');
		var modalBody = modal.find('.modal-body');
		var title = modal.find('.modal-title');
		var prevButton = modal.find('.quran-ayah-modal-prev');
			var nextButton = modal.find('.quran-ayah-modal-next');
			var tafsirExpandLink = modal.find('.quran-ayah-modal-tafsir-expand');
			var translationExpandLink = modal.find('.quran-ayah-modal-translation-expand');
			var activeIndex = 0;
			var shown = false;
			var returnFocusTo = null;
			var paneAt = function (index) {
				return panes.filter(`[data-quran-ayah-modal-pane="${index}"]`);
			};
			var refHref = function (ref) {
				if (!ref)
					return '';
				return `/${ref.replace(/^\/+/, '')}`;
			};
		var normalizeAyahRef = function (ref) {
			return (ref || '').toString().replace(/^\/+/, '').replace(/^quran:/, '');
		};
		var boundaryRef = function (step) {
			var pane = paneAt(activeIndex);
			var attr = step < 0 ? 'data-quran-ayah-prev-ref' : 'data-quran-ayah-next-ref';
			return pane.attr(attr) || '';
		};
		var paneForAyahRef = function (ref) {
			var normalized = normalizeAyahRef(ref);
			if (!normalized)
				return $();
			return panes.filter(function () {
				return normalizeAyahRef($(this).attr('data-quran-ayah-ref')) === normalized;
			}).first();
		};
		var setBoundaryLoading = function (loading) {
			modal.data('quranAyahModalBoundaryLoading', loading);
			prevButton.prop('disabled', loading);
			nextButton.prop('disabled', loading);
		};
		var refreshPanes = function () {
			panes = modal.find('[data-quran-ayah-modal-pane]');
			panes.each(function (index) {
				this.setAttribute('data-quran-ayah-modal-pane', index);
			});
		};
		var executeImportedPaneScripts = function (pane) {
			pane.find('script').each(function () {
				var type = (this.getAttribute('type') || '').toLowerCase();
				if (type && type !== 'text/javascript' && type !== 'application/javascript')
					return;
				var script = document.createElement('script');
				Array.prototype.slice.call(this.attributes || []).forEach(function (attr) {
					script.setAttribute(attr.name, attr.value);
				});
				script.text = this.text || this.textContent || '';
				document.body.appendChild(script);
				document.body.removeChild(script);
			});
		};
		var importBoundaryPane = function (html, ref, step) {
			var sourceDoc = new DOMParser().parseFromString(html, 'text/html');
			var sourceModal = sourceDoc.querySelector(`.quran-ayah-modal[data-quran-ayah-modal-type="${modalType}"]`);
			if (!sourceModal)
				return null;
			var normalized = normalizeAyahRef(ref);
			var sourcePane = Array.prototype.slice.call(sourceModal.querySelectorAll('[data-quran-ayah-modal-pane]')).find(function (pane) {
				return normalizeAyahRef(pane.getAttribute('data-quran-ayah-ref')) === normalized;
			});
			if (!sourcePane)
				return null;
			var newIndex = panes.length;
			var paneHtml = sourcePane.outerHTML
				.replace(/data-quran-ayah-modal-pane="[^"]*"/g, `data-quran-ayah-modal-pane="${newIndex}"`)
				.replace(/quran-ayah-(?:tafsir|translations|reflections)-modal-pane-\d+/g, `${modal.attr('id')}-pane-${newIndex}`)
				.replace(/quran-ayah-comments-\d+/g, `quran-ayah-comments-dynamic-${modalType}-${newIndex}`);
			var template = document.createElement('template');
			template.innerHTML = paneHtml.trim();
			var importedPane = $(template.content.firstElementChild);
			importedPane.addClass('d-none');
			var activePane = paneAt(activeIndex);
			if (activePane.length && step < 0)
				activePane.before(importedPane);
			else if (activePane.length)
				activePane.after(importedPane);
			else
				modalBody.append(importedPane);
			refreshPanes();
			executeImportedPaneScripts(importedPane);
			return importedPane;
		};
		var loadBoundaryPane = function (step) {
			if (modal.data('quranAyahModalBoundaryLoading'))
				return true;
			var ref = boundaryRef(step);
			if (!ref)
				return false;
			var existingPane = paneForAyahRef(ref);
			if (existingPane.length) {
				showAyah(panes.index(existingPane));
				return true;
			}
			setBoundaryLoading(true);
			fetch(quranUrl(refHref(ref)), { credentials: 'same-origin' })
				.then(function (response) {
					if (!response.ok)
						throw new Error('Unable to load adjacent ayah.');
					return response.text();
				})
				.then(function (html) {
					var pane = importBoundaryPane(html, ref, step);
					if (!pane)
						throw new Error('Adjacent ayah was not found in the modal payload.');
					showAyah(panes.index(pane));
				})
				.catch(function (err) {
					if (window.toastr)
						toastr.error(err.message || 'Unable to load adjacent ayah.');
				})
				.finally(function () {
					setBoundaryLoading(false);
					showAyah(activeIndex);
				});
			return true;
		};
		var activeTafsirBrowseHref = function () {
			if (modalType !== 'tafsirs')
				return '';
			var pane = paneAt(activeIndex);
			var tab = pane.find('.quran-tafsirs [role="tab"].active').filter(function () {
				return !!(this.offsetWidth || this.offsetHeight || this.getClientRects().length);
			}).first();
			var tafsir = pane.find('.quran-tafsirs').first();
			var alias = tab.attr('data-tafsir-hash') || '';
			var surah = tafsir.attr('data-surah') || '';
			var ayah = (pane.attr('data-quran-ayah-ref') || '').toString().split(':').pop();
			if (!alias || !surah || !ayah)
				return '';
			var panel = tab.attr('aria-controls') ? pane.find(`#${tab.attr('aria-controls')}`) : $();
			var startAyah = panel.attr('data-tafsir-range-start') || ayah;
			var endAyah = panel.attr('data-tafsir-range-end') || startAyah;
			var range = endAyah !== startAyah ? `${startAyah}-${endAyah}` : startAyah;
			var href = `/quran/tafsir/${encodeURIComponent(tafsirBrowseSlug(alias))}/quran:${encodeURIComponent(surah)}:${range}`;
			return quranPath(href);
		};
		var updateTafsirExpandLink = function () {
			if (!tafsirExpandLink.length)
				return;
			var href = activeTafsirBrowseHref();
			tafsirExpandLink.attr('href', href || '#');
			tafsirExpandLink.toggleClass('disabled', !href);
			tafsirExpandLink.attr('aria-disabled', href ? 'false' : 'true');
		};
		var activeTranslationBrowseHref = function () {
			if (modalType !== 'translations')
				return '';
			var pane = paneAt(activeIndex);
			var translation = pane.find('.quran-translations').first();
			var surah = translation.attr('data-surah') || '';
			var ayah = (pane.attr('data-quran-ayah-ref') || '').toString().split(':').pop();
			if (!surah || !ayah)
				return '';
			return quranPath(`/quran/translations/quran:${encodeURIComponent(surah)}:${encodeURIComponent(ayah)}`);
		};
		var updateTranslationExpandLink = function () {
			if (!translationExpandLink.length)
				return;
			var href = activeTranslationBrowseHref();
			translationExpandLink.attr('href', href || '#');
			translationExpandLink.toggleClass('disabled', !href);
			translationExpandLink.attr('aria-disabled', href ? 'false' : 'true');
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
						hadithId: this.getAttribute('data-target-id'),
						type: this.getAttribute('data-target-type') || 'hadith'
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
			if (modalType === 'reflections')
				title.text(`Reflections on Quran ${ayahRef}`);
			else if (modalType === 'translations')
				title.text(`Translations of Quran ${ayahRef}`);
			else
				title.text(`Tafsir of Quran ${ayahRef}`);
			if (!modal.data('quranAyahModalBoundaryLoading')) {
				prevButton.prop('disabled', activeIndex === 0 && !boundaryRef(-1));
				nextButton.prop('disabled', activeIndex === panes.length - 1 && !boundaryRef(1));
			}
			modalBody.scrollTop(0);
			if (shown || modal.data('quranAyahModalOpening')) {
				initQuranPreferredTranslationDisplays(pane[0]);
				initQuranTafsirTabs(pane[0]);
				initQuranTranslations(pane[0]);
				loadActiveCommentWidgets();
				scrollActiveTafsirTabs();
			}
			updateTafsirExpandLink();
			updateTranslationExpandLink();
		};
		var openAyah = function (index, focusTarget) {
			modal.data('quranAyahModalOpening', true);
			showAyah(index);
			returnFocusTo = focusTarget && document.contains(focusTarget) ? focusTarget : null;
			if (window.bootstrap && window.bootstrap.Modal)
				window.bootstrap.Modal.getOrCreateInstance(modal[0]).show();
		};
		var moveAyah = function (step) {
			var targetIndex = activeIndex + step;
			if (targetIndex < 0 || targetIndex >= panes.length)
				return loadBoundaryPane(step);
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
		tafsirExpandLink.on('click', function (event) {
			if ($(this).hasClass('disabled'))
				event.preventDefault();
		});
		translationExpandLink.on('click', function (event) {
			if ($(this).hasClass('disabled'))
				event.preventDefault();
		});
		modal.on('quranTafsirChanged', '.quran-tafsirs', updateTafsirExpandLink);
		modal.on('shown.bs.modal', function () {
			modal.removeData('quranAyahModalOpening');
			shown = true;
			loadActiveCommentWidgets();
			scrollActiveTafsirTabs();
			updateTafsirExpandLink();
			updateTranslationExpandLink();
		});
		modal.on('hide.bs.modal', function () {
			if (modal[0].contains(document.activeElement))
				document.activeElement.blur();
		});
		modal.on('hidden.bs.modal', function () {
			shown = false;
			if (!returnFocusTo || !document.contains(returnFocusTo))
				return;
			try {
				returnFocusTo.focus({ preventScroll: true });
			} catch (_err) {
				returnFocusTo.focus();
			}
		});
		var modalState = {
			isShown: function () { return shown; },
			activeIndex: function () { return activeIndex; },
			openAyah: openAyah,
			moveAyah: moveAyah,
			rotateTafsir: rotateTafsir,
			refreshPanes: refreshPanes
		};
		modal.data('quranAyahModalState', modalState);
		modal.data('quranAyahModalRefreshPanes', refreshPanes);
		modalStates[modalType] = modalState;

		showAyah(0);
	});

	if ($(document).data('quranAyahModalHandlersBound'))
		return;
	$(document).data('quranAyahModalHandlersBound', true);
	var getModalState = function (type) {
		return modalStates[type] || modalStates.tafsirs;
	};
	var openAyah = function (index, type, focusTarget) {
		var state = getModalState(type);
		if (state)
			state.openAyah(index, focusTarget);
	};
	var switchAyahModal = function (targetType, focusTarget) {
		var shownModal = $('.quran-ayah-modal.show').first();
		var shownState = getShownModalState();
		var activeIndex = shownState && shownState.activeIndex ? shownState.activeIndex() : 0;
		if (!shownModal.length) {
			openAyah(activeIndex, targetType, focusTarget);
			return;
		}
		var currentType = shownModal.attr('data-quran-ayah-modal-type');
		if (currentType === targetType)
			return;
		var targetState = getModalState(targetType);
		if (!targetState)
			return;
			var openTarget = function () {
				openAyah(activeIndex, targetType, focusTarget);
			};
			if (window.bootstrap && window.bootstrap.Modal) {
				shownModal.one('hidden.bs.modal', openTarget);
				window.bootstrap.Modal.getOrCreateInstance(shownModal[0]).hide();
			} else {
				openTarget();
			}
		};
		var openInitialAyahModalFromHash = function () {
			if (!consumeQuranTafsirOpenRequest())
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
			openAyah($(this).attr('data-quran-ayah-modal-index'), $(this).attr('data-quran-ayah-modal-type'), this);
		});

		$(document).on('click.quranAyahModalSwitch', '.quran-ayah-modal-switch[data-quran-ayah-modal-switch]', function (event) {
			event.preventDefault();
			event.stopPropagation();
			switchAyahModal($(this).attr('data-quran-ayah-modal-switch'), this);
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

function renderQuranHeroMarkdown(value) {
	value = stripQuranDisplayFootnoteMarkdown(value);
	if (!value)
		return '';
	if (window.marked && window.marked.parse)
		return stripQuranDisplayFootnoteHtml(window.marked.parse(value).replace(/<br>/g, '</p><p>').trim());
	return $('<div>').text(compactQuranPlainText(value)).html();
}

function toArabicDigits(value) {
	return (value || '').toString().replace(/\d/g, function (digit) {
		return '٠١٢٣٤٥٦٧٨٩'[digit];
	});
}

function quranAyahRef(ayah) {
	return ((ayah && ayah.en && ayah.en.num) || (ayah && ayah.num) || '').toString();
}

function quranAyahPart(ref) {
	ref = (ref || '').toString();
	return ref.split(/:/).pop() || ref;
}

function quranAyahShareId(ref) {
	return `Q${(ref || '').toString().replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function quranAyahModalIndex(ref, type) {
	var modal = $(`.quran-ayah-modal[data-quran-ayah-modal-type="${type || 'tafsirs'}"]`).first();
	var pane = modal.find(`[data-quran-ayah-ref="${ref}"]`).first();
	var index = parseInt(pane.attr('data-quran-ayah-modal-pane'), 10);
	return Number.isInteger(index) ? index : -1;
}

function quranAyahHeroToolbarHtml(ayah, shareId) {
	var ref = quranAyahRef(ayah);
	var audioRef = quranAudioRefParts(ref);
	var selectedAyahId = parseInt(ayah && ayah.id, 10);
	var modalIndex = quranAyahModalIndex(ref, 'tafsirs');
	var $toolbar = $('<aside>').addClass('tags quran-ayah-hero-toolbar col-12');

	if (Number.isInteger(selectedAyahId)) {
		$('<button>').attr({
			type: 'button',
			'data-hadith-id': selectedAyahId,
			title: 'Bookmark this ayah'
		}).addClass('hadith-bookmark-btn btn btn-sm p-0 border-0 bg-transparent d-inline-flex align-items-center')
			.append($('<span>').addClass('hadith-bookmark-icon bi bi-bookmark text-accent').attr('data-hadith-id', selectedAyahId))
			.appendTo($toolbar);

		var $like = $('<span>').addClass('quran-ayah-action').appendTo($toolbar);
		$('<button>').attr({
			type: 'button',
			'data-hadith-id': selectedAyahId,
			'data-like-type': 'hadith',
			title: 'Like this ayah'
		}).addClass('hadith-like-btn btn btn-sm p-0 border-0 bg-transparent d-inline-flex align-items-center')
			.append($('<span>').addClass('hadith-like-icon bi bi-heart text-danger').attr({ 'data-hadith-id': selectedAyahId, 'data-like-type': 'hadith' }))
			.appendTo($like);
		$('<span>').addClass('hadith-like-count fw-semibold text-danger').attr({ 'data-hadith-id': selectedAyahId, 'data-like-type': 'hadith' }).text('0').appendTo($like);
	}

	if (Number.isInteger(audioRef.surah) && Number.isInteger(audioRef.ayah)) {
		$('<button>').attr({
			type: 'button',
			'data-quran-hero-audio-play': '1',
			'data-surah': audioRef.surah,
			'data-ayah': audioRef.ayah,
			title: 'Play selected ayah',
			'aria-label': 'Play selected ayah'
		}).addClass('quran-ayah-action icon text-accent')
			.append($('<span>').addClass('bi bi-play-fill'))
			.append($('<span>').addClass('quran-ayah-action-label').text('Play'))
			.appendTo($toolbar);
	}

	if (modalIndex >= 0) {
		var reflectionAttrs = {
			type: 'button',
			'data-quran-ayah-modal-index': modalIndex,
			'data-quran-ayah-modal-type': 'reflections',
			title: 'View reflections'
		};
		var $reflections = $('<button>').attr(reflectionAttrs).addClass('quran-ayah-modal-trigger reflection-count-link text-accent').appendTo($toolbar);
		$reflections.append($('<span>').addClass('bi bi-chat-right-text'));
		var $count = $('<span>').addClass('hadith-comment-count fw-semibold').attr('title', '0 reflections').text('0');
		if (Number.isInteger(selectedAyahId))
			$count.attr({ 'data-hadith-id': selectedAyahId, 'data-comment-type': 'hadith' });
		$reflections.append($count);

		$('<button>').attr({
			type: 'button',
			'data-quran-ayah-modal-index': modalIndex,
			'data-quran-ayah-modal-type': 'tafsirs',
			title: 'View tafsir',
			'aria-label': 'View tafsir'
		}).addClass('quran-ayah-modal-trigger quran-ayah-action text-accent')
			.append($('<span>').addClass('bi bi-book-half'))
			.append($('<span>').addClass('quran-ayah-action-label').text('Tafsir'))
			.appendTo($toolbar);

		$('<button>').attr({
			type: 'button',
			'data-quran-ayah-modal-index': modalIndex,
			'data-quran-ayah-modal-type': 'translations',
			title: 'View translations',
			'aria-label': 'View translations'
		}).addClass('quran-ayah-modal-trigger quran-ayah-action text-accent')
			.append($('<span>').addClass('bi bi-translate'))
			.append($('<span>').addClass('quran-ayah-action-label').text('Translations'))
			.appendTo($toolbar);
	}

	$('<a>').attr({
		href: `#${shareId}`,
		type: 'button',
		title: 'Share selected ayah image',
		'aria-label': 'Share selected ayah image',
		'data-bs-toggle': 'modal',
		'data-bs-target': `#${shareId}`
	}).addClass('quran-ayah-action icon text-accent text-decoration-none')
		.append($('<span>').addClass('bi bi-box-arrow-up'))
		.append($('<span>').addClass('quran-ayah-action-label').text('Share'))
		.appendTo($toolbar);

	return $toolbar;
}

function quranShareModalHtml(ayah, shareId) {
	var ref = quranAyahRef(ayah);
	var part = quranAyahPart(ref);
	var arabicRef = ((ayah && ayah.ar && ayah.ar.num) || ref).toString();
	var arabicPart = quranAyahPart(arabicRef);
	var surahTitle = (ayah && (ayah.h1_title_en || (ayah.en && ayah.en.h1_title) || ayah.book_shortName_en)) || 'Qurʾān';
	var chapterTitle = (ayah && (ayah.h1_title_en || (ayah.en && ayah.en.h1_title))) || '';
	var shareTitle = ref ? `${surahTitle} ${ref}` : surahTitle;

	var $modal = $('<aside>').addClass('h modal fade hadith-share-root quran-share-root')
		.attr({ id: shareId, tabindex: '-1', 'data-dynamic-quran-share-modal': '1' });
	var $dialog = $('<div>').addClass('modal-dialog modal-dialog-scrollable modal-xl hadith-share-dialog').appendTo($modal);
	var $content = $('<div>').addClass('modal-content hadith-share-modal').appendTo($dialog);
	var $header = $('<header>').addClass('modal-header hadith-share-toolbar').appendTo($content);
	var $actions = $('<div>').addClass('hadith-share-actions').appendTo($header);
	$('<div>').addClass('hadith-share-tool-group')
		.append($('<button>').attr({ type: 'button', title: 'Edit text', 'aria-label': 'Edit text', 'aria-pressed': 'false' }).addClass('btn btn-sm btn-outline-secondary hadith-share-edit').append($('<span>').addClass('bi bi-pencil')))
		.appendTo($actions);
	var $controlGroup = $('<div>').addClass('hadith-share-control-group').appendTo($actions);
	$('<div>').addClass('form-check form-switch hadith-share-arabic-toggle').attr('title', 'Show English')
		.append($('<input>').attr({ type: 'checkbox', role: 'switch', id: `${shareId}-english`, 'data-share-language-toggle': 'english', checked: 'checked' }).addClass('form-check-input hadith-share-arabic'))
		.append($('<label>').addClass('form-check-label').attr('for', `${shareId}-english`).text('English'))
		.appendTo($controlGroup);
	$('<label>').addClass('quran-share-translation-control d-none').attr('title', 'Translator')
		.append($('<span>').addClass('visually-hidden').text('Translator'))
		.append($('<select>').addClass('form-select form-select-sm quran-share-translation-select').attr({ 'data-quran-share-translation-select': '1', 'aria-label': 'Share image translator' }))
		.appendTo($controlGroup);
	var $sizes = $('<div>').addClass('hadith-share-size-controls').attr('aria-label', 'Share image font sizes').appendTo($controlGroup);
	$('<label>').attr('title', 'English text size').append($('<span>').text('English')).append($('<input>').attr({ type: 'range', min: '70', max: '130', step: '5', value: '100', 'data-share-size-var': '--share-english-tune' }).addClass('form-range hadith-share-size')).appendTo($sizes);
	$('<label>').attr('title', 'Arabic text size').append($('<span>').text('Arabic')).append($('<input>').attr({ type: 'range', min: '70', max: '130', step: '5', value: '100', 'data-share-size-var': '--share-arabic-tune' }).addClass('form-range hadith-share-size')).appendTo($sizes);
	$('<div>').addClass('hadith-share-tool-group')
		.append($('<button>').attr({ type: 'button', title: 'Copy image', 'aria-label': 'Copy image' }).addClass('btn btn-sm btn-outline-secondary hadith-share-copy').append($('<span>').addClass('bi bi-clipboard')))
		.append($('<button>').attr({ type: 'button', title: 'Share image', 'aria-label': 'Share image' }).addClass('btn btn-sm btn-outline-secondary hadith-share-native').append($('<span>').addClass('bi bi-share')))
		.appendTo($actions);
	$('<button>').attr({ type: 'button', 'data-bs-dismiss': 'modal', 'aria-label': 'Close' }).addClass('btn-close').appendTo($header);

	var $body = $('<section>').addClass('modal-body hadith-share-body').appendTo($content);
	var $card = $('<article>').addClass('hadith-share-card quran-share-card').attr({ 'data-share-card': '', 'data-share-ref': `quran:${ref}` }).appendTo($body);
	var $inner = $('<div>').addClass('hadith-share-card-inner').appendTo($card);
	$('<h2>').addClass('hadith-share-title share-editable').attr('contenteditable', 'false').text(shareTitle).appendTo($inner);
	var $arText = $('<div>').addClass('body hadith-share-text quran-share-text share-editable').attr({ lang: 'ar', contenteditable: 'false' });
	$('<p>').append($('<span>').attr({ 'data-quran-script-text': 'ayah', 'data-quran-ref': ref }).text(compactQuranPlainText(ayah && ayah.ar && ayah.ar.body)).append(document.createTextNode(' ')).append($('<span>').addClass('quran-ayah-end-marker').attr('aria-label', `Quran ${arabicRef}`).text(`۝${toArabicDigits(arabicPart)}`))).appendTo($arText);
	$('<section>').addClass('hadith-share-section hadith-share-arabic-section').attr('lang', 'ar').append($arText).appendTo($inner);
	var $enText = $('<div>').addClass('body hadith-share-text quran-share-text share-editable').attr({ lang: 'en', contenteditable: 'false', 'data-quran-share-translation-target': '1' });
	$('<p>')
		.append($('<span>').append($('<sup>').text(ref)).append(document.createTextNode(' ')).append(document.createTextNode(compactQuranPlainText(ayah && ayah.en && ayah.en.body))))
		.append(document.createTextNode(' '))
		.append($('<span>').addClass('quran-share-translation-attribution quran-translation-attribution').attr({ 'data-quran-share-translation-attribution': '1', contenteditable: 'false' }).text(`— ${defaultQuranTranslationShortName()}`))
		.appendTo($enText);
	$('<section>').addClass('hadith-share-section quran-share-english-section').attr('lang', 'en')
		.append($enText)
		.appendTo($inner);
	var $footer = $('<footer>').addClass('hadith-share-footer').appendTo($inner);
	$('<div>').append($('<div>').addClass('title share-editable').attr('contenteditable', 'false').text(chapterTitle ? `Qurʾān > ${chapterTitle}` : 'Qurʾān')).appendTo($footer);
	var $brand = $('<div>').addClass('hadith-share-brand').attr('style', 'display:flex;align-items:center;justify-content:space-between;gap:9px;width:100%;min-width:0;').appendTo($footer);
	$('<div>').addClass('hadith-share-site share-editable').attr({ contenteditable: 'false', 'data-share-site-editor': '1' }).text('hadithunlocked.com').appendTo($brand);
	$('<div>').addClass('hadith-share-logo').attr({ 'data-share-logo': '', style: 'position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:34px;height:34px;max-width:34px;max-height:34px;' })
		.append($('<img>').attr({ src: '/images/quran-logo2.svg', width: '34', height: '34', alt: 'Quran Unlocked', loading: 'lazy', style: 'display:block;width:34px;height:34px;max-width:34px;max-height:34px;object-fit:contain;' }))
		.append($('<button>').attr({ type: 'button', 'aria-label': 'Remove logo', title: 'Remove logo', hidden: 'hidden', style: 'display:none;position:absolute;top:-8px;right:-8px;width:20px;height:20px;padding:0;border:1px solid #cfc7bc;border-radius:999px;background:#fff;color:#333;line-height:1;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.16);' }).addClass('hadith-share-logo-remove').append($('<span>').addClass('bi bi-x')))
		.appendTo($brand);
	return $modal;
}

function quranShareRefParts(card) {
	var ref = (card && card.getAttribute('data-share-ref') || '').replace(/^quran:/, '');
	var parts = ref.split(':');
	var surah = parts[0] || '';
	var ayahRange = parts[1] || '';
	var rangeParts = ayahRange.split('-');
	var ayahFrom = rangeParts[0] || '';
	var ayahTo = rangeParts[1] || ayahFrom;
	return { surah: surah, ayahFrom: ayahFrom, ayahTo: ayahTo };
}

function initQuranShareTranslationSelect(modal, card) {
	var selector = modal ? modal.querySelector('[data-quran-share-translation-select="1"]') : null;
	var target = modal ? modal.querySelector('[data-quran-share-translation-target="1"]') : null;
	if (!selector || !target)
		return;
	if (target.dataset.quranShareDefaultTranslationHtml === undefined)
		target.dataset.quranShareDefaultTranslationHtml = target.innerHTML || '';
	setQuranShareTranslationAttribution(modal, defaultQuranTranslationShortName());
	if (selector.dataset.quranShareTranslationBound !== 'true') {
		selector.dataset.quranShareTranslationBound = 'true';
		selector.addEventListener('change', function () {
			applyQuranShareTranslation(modal, card, selector.value).then(function () {
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			}).catch(function (err) {
				if (window.toastr)
					toastr.error(err.message || 'Unable to load selected translation.', 'Share');
			});
		});
	}
	Promise.all([quranTranslationBooks(), getQuranTafsirSettings().catch(function () { return {}; })]).then(function (results) {
		var books = results[0];
		var settings = results[1] || {};
		var selected = selector.value;
		var selectedTranslationAlias = quranSelectedTranslationAliasFromLocation() || storedQuranSelectedTranslationAlias();
		selector.innerHTML = '';
		var choices = orderedSelectableQuranTranslationBooks(books, settings);
		choices.forEach(function (book) {
			var option = document.createElement('option');
			option.value = book.source === 'default' ? '' : book.alias;
			option.textContent = quranTranslationBookLabel(book);
			selector.appendChild(option);
		});
		var overridePreferredAlias = window.hadithQuranUserSettingsOverride && window.hadithQuranUserSettingsOverride.translations
			? window.hadithQuranUserSettingsOverride.translations.preferredAlias || ''
			: '';
		selector.value = quranTranslationSelectValue(
			selectedTranslationAlias || overridePreferredAlias || settings.translations && settings.translations.preferredAlias || selected || '',
			choices
		);
		applyQuranShareTranslation(modal, card, selector.value).catch(function () {});
	}).catch(function () {});
}

function setQuranShareTranslationAttribution(modal, label) {
	var target = modal ? modal.querySelector('[data-quran-share-translation-target="1"]') : null;
	if (!target)
		return;
	var paragraph = target.querySelector('p:last-child') || target;
	var attribution = target.querySelector('[data-quran-share-translation-attribution="1"]');
	if (!attribution) {
		attribution = document.createElement('span');
		attribution.className = 'quran-share-translation-attribution quran-translation-attribution';
		attribution.setAttribute('data-quran-share-translation-attribution', '1');
		attribution.setAttribute('contenteditable', 'false');
		paragraph.appendChild(document.createTextNode(' '));
		paragraph.appendChild(attribution);
	}
	if (attribution)
		attribution.textContent = label ? `— ${label}` : '';
}

function applyQuranShareTranslation(modal, card, alias) {
	var target = modal ? modal.querySelector('[data-quran-share-translation-target="1"]') : null;
	if (!target)
		return Promise.resolve();
	if (target.dataset.quranShareDefaultTranslationHtml === undefined)
		target.dataset.quranShareDefaultTranslationHtml = target.innerHTML || '';
	if (!alias) {
		target.innerHTML = target.dataset.quranShareDefaultTranslationHtml || '';
		setQuranShareTranslationAttribution(modal, defaultQuranTranslationShortName());
		return Promise.resolve();
	}
	return quranTranslationBooks().then(function (books) {
		var book = books.find(function (candidate) {
			return candidate && candidate.alias === alias && candidate.source === 'local';
		});
		if (!book) {
			target.innerHTML = target.dataset.quranShareDefaultTranslationHtml || '';
			setQuranShareTranslationAttribution(modal, defaultQuranTranslationShortName());
			return;
		}
		var parts = quranShareRefParts(card);
		if (!parts.surah || !parts.ayahFrom)
			return;
		return fetch(`${quranApiPath('/proxy/translations/local')}?src=${encodeURIComponent(book.alias)}&s=${encodeURIComponent(parts.surah)}&from=${encodeURIComponent(parts.ayahFrom)}&to=${encodeURIComponent(parts.ayahTo)}&lang=${encodeURIComponent(book.lang || 'en')}${shouldFlushQuranProxyCache() ? '&flush=1' : ''}`)
			.then(function (response) {
				if (!response.ok)
					throw new Error('Unable to load selected translation.');
				return response.json();
			})
			.then(function (payload) {
				var entries = Array.isArray(payload && payload.entries) ? payload.entries : [payload];
				var ayah = Number(parts.ayahFrom);
				var spans = entries.filter(Boolean).map(function (entry, index) {
					var label = entries.length === 1 && parts.ayahFrom === parts.ayahTo ? `${parts.surah}:${parts.ayahFrom}` : `${index === 0 ? `${parts.surah}:` : ''}${ayah + index}`;
					var text = quranTranslationTextFromPayload(entry);
					return `<span><sup>${$('<div>').text(label).html()}</sup>&nbsp;${$('<div>').text(text).html()}</span>`;
				}).join(' ');
				if (spans)
					target.innerHTML = `<p>${spans}</p>`;
				setQuranShareTranslationAttribution(modal, quranTranslationBookLabel(book));
			});
	});
}

function ensureQuranShareModal(ayah, shareId) {
	if (!shareId || document.getElementById(shareId))
		return;
	$('.quran-share-root[data-dynamic-quran-share-modal="1"]').remove();
	$('body').append(quranShareModalHtml(ayah, shareId));
	initQuranScriptPreference(document.getElementById(shareId)).catch(function () {});
	if (typeof initHadithShareModals === 'function')
		initHadithShareModals(document.getElementById(shareId));
}

function quranAyahHeroHtml(ayah, clearHref, passageHero) {
	if (!ayah)
		return '';
	var ref = quranAyahRef(ayah);
	var part = quranAyahPart(ref);
	var arabicRef = ((ayah.ar && ayah.ar.num) || ref).toString();
	var arabicPart = quranAyahPart(arabicRef);
	var editMode = typeof window.bindInlineEditors === 'function';
	var editAttrs = function (prop, source, arabizi) {
		if (!editMode)
			return {};
		var attrs = {
			'data-id': ayah.id,
			'data-prop': prop,
			'data-markdown-source': (source || '').toString(),
			'data-markdown-empty-html': '…'
		};
		if (arabizi)
			attrs['data-arabizi'] = 'true';
		return attrs;
	};
	var previousHref = ayah.prev_ref ? quranUrl(`/${ayah.prev_ref}`) : '';
	var nextHref = ayah.next_ref ? quranUrl(`/${ayah.next_ref}`) : '';
	var previousLabel = 'Previous ayah';
	var nextLabel = 'Next ayah';
	var navClass = previousHref || nextHref ? ' quran-ayah-hero-with-nav' : '';
	var $hero = $('<section>').addClass(`quran-ayah-hero row${navClass}`).attr('data-dynamic-quran-ayah-hero', '1');
	var audioRef = quranAudioRefParts(ref);
	if (Number.isInteger(audioRef.surah) && Number.isInteger(audioRef.ayah)) {
		$hero.attr({
			'data-quran-hero-audio': '1',
			'data-surah': audioRef.surah,
			'data-ayah': audioRef.ayah
		});
	}
	if (previousHref) {
		$('<a>').addClass('quran-ayah-hero-nav quran-ayah-hero-prev').attr({
			href: previousHref,
			rel: 'prev',
			title: previousLabel,
			'aria-label': previousLabel
		}).append($('<span>').addClass('bi bi-chevron-left').attr('aria-hidden', 'true')).appendTo($hero);
	}
	if (nextHref) {
		$('<a>').addClass('quran-ayah-hero-nav quran-ayah-hero-next').attr({
			href: nextHref,
			rel: 'next',
			title: nextLabel,
			'aria-label': nextLabel
		}).append($('<span>').addClass('bi bi-chevron-right').attr('aria-hidden', 'true')).appendTo($hero);
	}
	if (clearHref) {
		$('<a>').addClass('quran-ayah-hero-clear').attr({
			href: clearHref,
			title: 'Clear ayah selection',
			'aria-label': 'Clear ayah selection'
		}).append($('<span>').addClass('bi bi-x').attr('aria-hidden', 'true')).appendTo($hero);
	}

	var $arSection = $('<section>').addClass('col-12').attr('lang', 'ar').appendTo($hero);
	var $arBody = $('<div>').addClass('quran-ayah-hero-body').appendTo($arSection);
	var $arAyah = $('<div>').addClass('quran-ayah-hero-ayah').appendTo($arBody);
	$('<div>').addClass(`${editMode ? '_e ' : ''}quran-ayah-hero-text`).attr(Object.assign({
		'data-quran-script-text': 'ayah',
		'data-quran-ref': ref,
		'data-quran-surah': ref.split(/:/)[0] || '',
		'data-quran-ayah': part
	}, editAttrs('hadith.body', ayah.ar && ayah.ar.body, false))).html(renderQuranHeroMarkdown(ayah.ar && ayah.ar.body)).appendTo($arAyah);
	$arAyah.append(document.createTextNode(' '));
	$('<span>').addClass('quran-ayah-end-marker').attr({ 'data-quran-ref': ref, 'aria-label': `Quran ${arabicRef}` }).text(`۝${toArabicDigits(arabicPart)}`).appendTo($arAyah);

	var $enSection = $('<section>').addClass('col-12').attr('lang', 'en').appendTo($hero);
	var $enBody = $('<div>').addClass('quran-ayah-hero-body').appendTo($enSection);
	var $enAyah = $('<div>').addClass('quran-ayah-hero-ayah').appendTo($enBody);
	$('<sup>').text(ref).appendTo($enAyah);
	$enAyah.append(document.createTextNode(' '));
	$('<div>').addClass(`${editMode ? '_e ' : ''}quran-ayah-hero-text`).attr(Object.assign({
		'data-quran-translation-target': '1',
		'data-quran-surah': ref.split(/:/)[0] || '',
		'data-quran-ayah': part
	}, editAttrs('hadith.body_en', ayah.en && ayah.en.body, true))).html(renderQuranHeroMarkdown(ayah.en && ayah.en.body)).appendTo($enAyah);
	$enAyah.append(document.createTextNode(' '));
	$('<span>').addClass('quran-translation-attribution').attr('data-quran-translation-attribution', '1').text(`— ${defaultQuranTranslationShortName()}`).appendTo($enAyah);
	$hero.append(quranAyahHeroToolbarHtml(ayah, quranAyahShareId(ref)));
	initQuranPreferredTranslationDisplays($hero[0]);
	return $hero;
}

function initQuranMushafAyahSelection(root) {
	var scope = root || document;
	if (document.documentElement.dataset.quranMushafOutsideSelectionBound !== '1') {
		document.documentElement.dataset.quranMushafOutsideSelectionBound = '1';
		window.addEventListener('resize', function () {
			refreshQuranMushafAyahBackgrounds([document]);
		}, { passive: true });
		document.addEventListener('click', function (event) {
			var searchAyah = event.target.closest('[data-quran-ref].quran-mushaf-search-ayah');
			if (!searchAyah) {
				document.querySelectorAll('.quran-mushaf-search-ayah').forEach(function (element) {
					element.classList.remove('quran-mushaf-search-ayah', 'quran-audio-active-ayah');
				});
				var url = new URL(window.location.href);
				if (url.searchParams.has('ayah') && window.history && window.history.replaceState) {
					url.searchParams.delete('ayah');
					window.history.replaceState(window.history.state || {}, '', `${url.pathname}${url.search}${url.hash}`);
				}
				refreshQuranMushafAyahBackgrounds([document]);
			}
			if (event.target.closest(
				'.quran-mushaf-page [data-quran-ref], '
				+ '.quran-passage-section .ayah[data-quran-ref], '
				+ '[data-quran-ayah-actions="1"][data-quran-ref]'
			))
				return;
			document.querySelectorAll('[data-quran-mushaf-page]').forEach(function (page) {
				page.dataset.quranMushafSelectedRef = '';
				page.querySelectorAll('.quran-mushaf-ayah-selected').forEach(function (element) {
					element.classList.remove('quran-mushaf-ayah-selected');
				});
			});
			refreshQuranMushafAyahBackgrounds([document]);
			hideQuranSelectionTranslationMarquee();
		});
	}
	var pages = scope.matches && scope.matches('[data-quran-mushaf-page]')
		? [scope]
		: Array.from(scope.querySelectorAll('[data-quran-mushaf-page]'));
	pages.forEach(function (page) {
		if (page.dataset.quranMushafAyahSelectionBound === '1')
			return;
		page.dataset.quranMushafAyahSelectionBound = '1';
		var hoverClearTimer = null;
		var setHoverRef = function (ref) {
			page.querySelectorAll('[data-quran-ref]').forEach(function (element) {
				element.classList.toggle('quran-mushaf-ayah-hover', !!ref && element.getAttribute('data-quran-ref') === ref);
			});
		};
		var setSelectedRef = function (ref) {
			page.dataset.quranMushafSelectedRef = ref || '';
			page.querySelectorAll('[data-quran-ref]').forEach(function (element) {
				element.classList.toggle('quran-mushaf-ayah-selected', !!ref && element.getAttribute('data-quran-ref') === ref);
			});
			refreshQuranMushafAyahBackgrounds([page]);
		};
		page.addEventListener('pointerover', function (event) {
			var target = event.target.closest('.quran-corpus-word[data-quran-ref], .quran-mushaf-ayah-marker[data-quran-ref]');
			if (target && page.contains(target)) {
				window.clearTimeout(hoverClearTimer);
				setHoverRef(target.getAttribute('data-quran-ref') || '');
			}
		});
		page.addEventListener('pointerout', function (event) {
			var nextTarget = event.relatedTarget && event.relatedTarget.closest
				? event.relatedTarget.closest('.quran-corpus-word[data-quran-ref], .quran-mushaf-ayah-marker[data-quran-ref]')
				: null;
			window.clearTimeout(hoverClearTimer);
			if (nextTarget && page.contains(nextTarget)) {
				setHoverRef(nextTarget.getAttribute('data-quran-ref') || '');
				return;
			}
			hoverClearTimer = window.setTimeout(function () {
				setHoverRef('');
			}, 30);
		});
		page.addEventListener('click', function (event) {
			if (page.hasAttribute('data-quran-memorize-page'))
				return;
			var target = event.target.closest('.quran-corpus-word[data-quran-ref]');
			if (!target || !page.contains(target) || target.closest('.quran-mushaf-line-basmallah'))
				return;
			var ref = target.getAttribute('data-quran-ref') || '';
			document.querySelectorAll('[data-quran-mushaf-page]').forEach(function (otherPage) {
				if (otherPage === page)
					return;
				otherPage.dataset.quranMushafSelectedRef = '';
				otherPage.querySelectorAll('.quran-mushaf-ayah-selected').forEach(function (element) {
					element.classList.remove('quran-mushaf-ayah-selected');
				});
			});
			refreshQuranMushafAyahBackgrounds([document]);
			var selectedRef = page.dataset.quranMushafSelectedRef === ref ? '' : ref;
			setSelectedRef(selectedRef);
			if (!selectedRef)
				hideQuranSelectionTranslationMarquee();
		});
	});
}

function showPageLoading(message, reviewStyle) {
	var loading = document.getElementById('page-loading-transition');
	if (!loading) {
		loading = document.createElement('div');
		loading.id = 'page-loading-transition';
		loading.className = 'page-loading-transition';
		loading.setAttribute('role', 'status');
		loading.setAttribute('aria-live', 'polite');
		loading.innerHTML = '<span class="spinner-border text-primary" aria-hidden="true"></span><span data-page-loading-message></span>';
		document.body.appendChild(loading);
	}
	loading.classList.toggle('quran-review-loading-transition', Boolean(reviewStyle));
	var copy = loading.querySelector('[data-page-loading-message]');
	if (copy) {
		copy.classList.toggle('text-muted', Boolean(reviewStyle));
		copy.textContent = message || 'Loading...';
	}
	loading.hidden = false;
	document.documentElement.classList.add('page-is-transitioning');
}

function trackQuranAnalyticsEvent(eventName, parameters) {
	if (typeof window.gtag !== 'function') return;
	window.gtag('event', eventName, Object.assign({ event_category: 'quran_memorization' }, parameters || {}));
}

window.trackQuranAnalyticsEvent = trackQuranAnalyticsEvent;

window.showPageLoading = showPageLoading;
window.navigateWithPageLoading = function (url, message, replace) {
	showPageLoading(message);
	// Give the browser a chance to paint the loading state before unloading the page.
	window.setTimeout(function () {
		window.location[replace ? 'replace' : 'assign'](url);
	}, 120);
};
window.navigateWithPageNotice = function (url, notice, loadingMessage) {
	showPageLoading(loadingMessage);
	window.setTimeout(function () {
		var target = new URL(url, window.location.href);
		if (target.origin !== window.location.origin) {
			window.location.assign(target.href);
			return;
		}
		var state = Object.assign({}, window.history.state || {}, { pageNotice: notice || null });
		window.history.pushState(state, '', `${target.pathname}${target.search}${target.hash}`);
		if (notice && notice.scrollToTop) {
			if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
			window.scrollTo(0, 0);
		}
		window.location.reload();
	}, 120);
};
window.hidePageLoading = function () {
	var loading = document.getElementById('page-loading-transition');
	if (loading) loading.hidden = true;
	document.documentElement.classList.remove('page-is-transitioning');
};
window.showQuranReviewLoading = function (message) {
	showPageLoading(message, true);
};
window.navigateWithQuranReviewLoading = function (url, message, replace) {
	window.showQuranReviewLoading(message);
	window.setTimeout(function () {
		window.location[replace ? 'replace' : 'assign'](url);
	}, 120);
};
window.hideQuranReviewLoading = window.hidePageLoading;

function initQuranMemorizeReviewLauncher(root) {
	var modal = (root || document).querySelector('#quran-memorize-review-modal');
	if (!modal || modal.dataset.quranMemorizeReviewBound === '1') return;
	modal.dataset.quranMemorizeReviewBound = '1';
	var form = modal.querySelector('[data-quran-memorize-review-form]');
	var durationFields = modal.querySelector('[data-quran-memorize-review-duration-fields]');
	var startLabel = modal.querySelector('[data-quran-review-start-label]');
	var startDescription = modal.querySelector('[data-quran-review-start-description]');
	var surahFields = modal.querySelector('[data-quran-review-surah-fields]');
	var surahInput = modal.querySelector('[data-quran-review-surah-input]');
	var surahNumber = modal.querySelector('[data-quran-review-surah-number]');
	var scopeEndLabel = modal.querySelector('[data-quran-memorize-review-scope-end]');
	var continueLabel = modal.querySelector('[data-quran-memorize-review-continue-label]');
	var status = modal.querySelector('[data-quran-memorize-review-status]');
	var submit = modal.querySelector('[data-quran-memorize-review-submit]');
	var currentPage = null;
	var currentRef = null;
	var launcherMode = 'page';
	var catalog = [];
	try { catalog = JSON.parse((modal.querySelector('[data-quran-review-surah-catalog]') || {}).textContent || '[]'); } catch (_err) {}
	var normalizeSearch = function (value) {
		return (value || '').toString().toLocaleLowerCase().normalize('NFD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{M}\d]+/gu, ' ').replace(/\s+/g, ' ').trim();
	};
	var chooseSurah = function (choice) {
		surahNumber.value = String(choice.number);
		surahInput.value = `${choice.number}. ${choice.english || `Surah ${choice.number}`}`;
		surahInput.classList.remove('is-invalid');
		startLabel.textContent = choice.english || `Surah ${choice.number}`;
		status.textContent = '';
	};
	var bindSurahAutocomplete = function () {
		if (!surahInput || surahInput.dataset.quranAutocompleteBound === '1' || !window.jQuery || !jQuery.fn.autocomplete) return;
		surahInput.dataset.quranAutocompleteBound = '1';
		var $input = jQuery(surahInput);
		$input.autocomplete({
			appendTo: modal.querySelector('.modal-body'), delay: 0, minLength: 0,
			source: function (request, response) {
				var query = normalizeSearch(request.term);
				response(catalog.filter(function (choice) { return !query || normalizeSearch([choice.number, choice.english, choice.arabic].concat(choice.aliases || []).join(' ')).includes(query); }).slice(0, 12).map(function (choice) { return { label: `${choice.number}. ${choice.english}`, value: `${choice.number}. ${choice.english}`, choice: choice }; }));
			},
			focus: function (event) { event.preventDefault(); },
			select: function (event, ui) { event.preventDefault(); chooseSurah(ui.item.choice); },
			open: function () { $input.autocomplete('widget').addClass('search-autocomplete-menu quran-surah-review-autocomplete-menu').css('width', $input.outerWidth()); }
		});
		$input.on('focus', function () { $input.autocomplete('search', $input.val()); });
		$input.on('input', function () { surahNumber.value = ''; surahInput.classList.remove('is-invalid'); });
	};
	var getToken = async function () {
		for (var attempt = 0; attempt < 30 && (!window.hadithAuth || !window.hadithAuth.getToken); attempt += 1)
			await new Promise(function (resolve) { window.setTimeout(resolve, 100); });
		var token = window.hadithAuth && window.hadithAuth.getToken ? await window.hadithAuth.getToken() : null;
		if (!token && window.hadithAuth && window.hadithAuth.requireToken)
			token = await window.hadithAuth.requireToken('Please sign in to start a Quran review.');
		return token;
	};
	modal.addEventListener('show.bs.modal', function (event) {
		var trigger = event.relatedTarget;
		launcherMode = trigger && trigger.getAttribute('data-quran-review-start-kind') || (trigger && trigger.getAttribute('data-quran-memorize-review-ref') ? 'passage' : 'page');
		currentRef = launcherMode === 'passage' ? trigger.getAttribute('data-quran-memorize-review-ref') : null;
		var finiteDurationInput = form.querySelector('input[name="quran-memorize-review-duration"][value="scope"]');
		if (finiteDurationInput) finiteDurationInput.checked = true;
		currentPage = Math.max(1, Number(trigger && trigger.getAttribute('data-quran-memorize-review-page')) || 1);
		surahFields.hidden = launcherMode !== 'surah';
		durationFields.hidden = false;
		if (launcherMode === 'passage') {
			startLabel.textContent = `Quran ${currentRef}`;
			startDescription.textContent = 'Review begins with the current Study passage and follows Quran order.';
			scopeEndLabel.textContent = 'Until this passage is complete';
			continueLabel.textContent = 'Continue into following passages as you reach them';
		} else if (launcherMode === 'surah') {
			startLabel.textContent = 'a surah';
			startDescription.textContent = 'Choose a surah, then review it in Quran order.';
			scopeEndLabel.textContent = 'Until this surah is complete';
			continueLabel.textContent = 'Continue into following surahs as you reach them';
			surahInput.value = '';
			surahNumber.value = '';
			bindSurahAutocomplete();
			window.setTimeout(function () { surahInput.focus(); }, 100);
		} else {
			startLabel.textContent = `Mushaf page ${currentPage}`;
			startDescription.textContent = 'Review begins at the start of this page and follows Quran order.';
			scopeEndLabel.textContent = 'Until this page is complete';
			continueLabel.textContent = 'Continue into following pages as you reach them';
		}
		status.textContent = '';
	});
	form.addEventListener('submit', async function (event) {
		event.preventDefault();
		var scope = launcherMode;
		var durationInput = form.querySelector('input[name="quran-memorize-review-duration"]:checked');
		var continueForward = durationInput && durationInput.value === 'session';
		var reviewUnitInput = form.querySelector('input[name="quran-review-unit"]:checked');
		var reviewUnit = reviewUnitInput ? reviewUnitInput.value : 'ayah';
		if (scope === 'surah' && (!Number.isInteger(Number(surahNumber.value)) || Number(surahNumber.value) < 1)) {
			surahInput.classList.add('is-invalid'); status.textContent = 'Choose a surah from the suggestions.'; surahInput.focus(); return;
		}
		var body = window.HadithDbQuranReview.sessionRequestBody(scope === 'passage'
			? { mode: 'passage', startRef: currentRef, continueForward: continueForward, reviewUnit: reviewUnit }
			: scope === 'page' ? { mode: 'page', pageNumber: currentPage, continueForward: continueForward, reviewUnit: reviewUnit }
				: { mode: 'surah', surahNumber: Number(surahNumber.value), reviewType: 'all', continueForward: continueForward, reviewUnit: reviewUnit });
		submit.disabled = true;
		status.textContent = scope === 'page' ? `Preparing Mushaf page ${currentPage}...` : scope === 'passage' ? `Preparing the passage from Quran ${currentRef}...` : 'Preparing the Surah Review...';
		showQuranReviewLoading('Preparing your review...');
		try {
			var token = await getToken();
			if (!token) throw new Error('Please sign in to start a Quran review.');
			var response = await fetch(quranApiPath('/memorization/review/sessions'), { method: 'POST', credentials: 'same-origin', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			var data = await response.json().catch(function () { return {}; });
			if (!response.ok) throw new Error(data.error || 'Unable to start this review.');
			trackQuranAnalyticsEvent('quran_review_session_start', {
				session_mode: data.session && data.session.session_mode || scope,
				mushaf_page: data.session && data.session.review_page_number || undefined,
				surah_number: data.session && data.session.review_surah_number || undefined,
				review_type: data.session && data.session.surah_review_type || undefined,
				ayah_count: data.session && data.session.queued || 0
			});
			if (data.session && Number(data.session.enrolled_count) > 0) trackQuranAnalyticsEvent('quran_memorization_enroll', {
				enrollment_scope: scope,
				enrolled_ayah_count: Number(data.session.enrolled_count),
				mushaf_page: data.session.review_page_number || undefined,
				surah_number: data.session.review_surah_number || undefined
			});
			window.navigateWithQuranReviewLoading(quranUrl('/quran/review?continue=1'), 'Loading your review...');
		} catch (err) {
			window.hideQuranReviewLoading();
			status.textContent = err.message || 'Unable to start this review.';
			submit.disabled = false;
		}
	});
}

function initQuranAyahMemorization(root) {
	var stateLabels = window.HadithDbQuranReview.LIFECYCLE_STATE_LABELS;
	var stateOptionLabels = {
		later: 'Learn later',
		learning: 'Learn',
		weak: 'Hard',
		review: 'Good',
		core: 'Easy',
		relearning: 'Hard',
		suspended: 'Pause learning'
	};
	var initialAssessmentLabels = Object.fromEntries(window.HadithDbQuranReview.INITIAL_ASSESSMENT_STAGES.map(function (stage) {
		return [stage.state, stage.label];
	}));
	var stateDescriptions = {
		later: 'Not currently being memorized',
		learning: 'Still learning the complete ayah',
		weak: 'Hard recall, scheduled with shorter intervals',
		review: 'Good recall, maintained through spaced review',
		core: 'Easy recall, retained without scheduled reviews',
		relearning: 'Hard recall under automatic recovery after Again',
		suspended: 'Temporarily removed from learning and review'
	};
	var stateOptions = ['learning', 'weak', 'review', 'core', 'suspended', 'later'];
	var selectableStateOptions = ['learning', 'weak', 'review', 'core', 'suspended', 'later'];
	var initialAssessmentStateOptions = window.HadithDbQuranReview.INITIAL_ASSESSMENT_STAGES.map(function (stage) { return stage.state; });
	var enrolledAyahStateOptions = ['core', 'suspended', 'later'];
	var enrolledBulkStateOptions = ['core', 'suspended', 'later'];
	var stateCache = window.quranAyahMemorizationStateCache = window.quranAyahMemorizationStateCache || new Map();
	var surahStateCache = window.quranSurahStateCache = window.quranSurahStateCache || new Map();
	var tokenPromise = window.quranAyahMemorizationTokenPromise;
	var stateMenu = document.querySelector('[data-quran-ayah-state-menu]');
	if (!stateMenu) {
		stateMenu = document.createElement('div');
		stateMenu.id = 'quran-ayah-state-menu';
		stateMenu.className = 'quran-ayah-state-menu';
		stateMenu.setAttribute('data-quran-ayah-state-menu', '1');
		stateMenu.setAttribute('role', 'menu');
		stateMenu.setAttribute('lang', 'en');
		stateMenu.setAttribute('dir', 'ltr');
		stateMenu.setAttribute('aria-label', 'Ayah memorization actions');
		stateMenu.hidden = true;
		selectableStateOptions.forEach(function (state) {
			var option = document.createElement('button');
			option.type = 'button';
			option.className = 'quran-ayah-state-option';
			option.setAttribute('data-quran-ayah-state-option', state);
			option.setAttribute('role', 'menuitemradio');
			option.setAttribute('aria-checked', 'false');
			option.setAttribute('aria-label', `${stateOptionLabels[state]}: ${stateDescriptions[state]}`);
			option.title = stateDescriptions[state];
			option.tabIndex = -1;
			var stateDot = document.createElement('span');
			stateDot.className = 'quran-ayah-state-option-dot';
			stateDot.setAttribute('aria-hidden', 'true');
			option.appendChild(stateDot);
			var optionLabel = document.createElement('span');
			optionLabel.setAttribute('data-quran-state-option-label', '1');
			optionLabel.textContent = stateOptionLabels[state];
			option.appendChild(optionLabel);
			stateMenu.appendChild(option);
		});
		document.body.appendChild(stateMenu);
	}
	var revealAyahOption = stateMenu.querySelector('[data-quran-ayah-reveal-option]');
	if (!revealAyahOption) {
		revealAyahOption = document.createElement('button');
		revealAyahOption.type = 'button';
		revealAyahOption.className = 'quran-ayah-state-option quran-ayah-reveal-option';
		revealAyahOption.setAttribute('data-quran-ayah-reveal-option', '1');
		revealAyahOption.setAttribute('role', 'menuitem');
		revealAyahOption.tabIndex = -1;
		revealAyahOption.innerHTML = '<span class="bi bi-eye" aria-hidden="true"></span><span>Reveal</span>';
		stateMenu.insertBefore(revealAyahOption, stateMenu.firstChild);
	}
	var playAyahOption = stateMenu.querySelector('[data-quran-ayah-play-option]');
	if (!playAyahOption) {
		playAyahOption = document.createElement('button');
		playAyahOption.type = 'button';
		playAyahOption.className = 'quran-ayah-state-option quran-ayah-play-option';
		playAyahOption.setAttribute('data-quran-ayah-play-option', '1');
		playAyahOption.setAttribute('role', 'menuitem');
		playAyahOption.tabIndex = -1;
		playAyahOption.innerHTML = '<span class="bi bi-play-fill" aria-hidden="true"></span><span>Play</span>';
		stateMenu.insertBefore(playAyahOption, revealAyahOption);
	}
	var reviewAyahOption = stateMenu.querySelector('[data-quran-ayah-review-option]');
	if (!reviewAyahOption) {
		reviewAyahOption = document.createElement('button');
		reviewAyahOption.type = 'button';
		reviewAyahOption.className = 'quran-ayah-state-option quran-ayah-review-option';
		reviewAyahOption.setAttribute('data-quran-ayah-review-option', '1');
		reviewAyahOption.setAttribute('role', 'menuitem');
		reviewAyahOption.tabIndex = -1;
		reviewAyahOption.innerHTML = '<span class="bi bi-arrow-repeat" aria-hidden="true"></span><span>Review</span>';
		var firstStateOption = stateMenu.querySelector('[data-quran-ayah-state-option]');
		stateMenu.insertBefore(reviewAyahOption, firstStateOption);
	}
	var surahStateMenu = document.querySelector('[data-quran-surah-state-menu]');
	if (!surahStateMenu) {
		surahStateMenu = document.createElement('div');
		surahStateMenu.id = 'quran-surah-state-menu';
		surahStateMenu.className = 'quran-ayah-state-menu quran-surah-state-menu';
		surahStateMenu.setAttribute('data-quran-surah-state-menu', '1');
		surahStateMenu.setAttribute('role', 'menu');
		surahStateMenu.setAttribute('lang', 'en');
		surahStateMenu.setAttribute('dir', 'ltr');
		surahStateMenu.setAttribute('aria-label', 'Surah memorization state');
		surahStateMenu.hidden = true;
		selectableStateOptions.forEach(function (state) {
			var option = document.createElement('button');
			option.type = 'button';
			option.className = 'quran-ayah-state-option';
			option.setAttribute('data-quran-surah-state-option', state);
			option.setAttribute('role', 'menuitemradio');
			option.setAttribute('aria-checked', 'false');
			option.tabIndex = -1;
			var stateDot = document.createElement('span');
			stateDot.className = 'quran-ayah-state-option-dot';
			stateDot.setAttribute('aria-hidden', 'true');
			option.appendChild(stateDot);
			var optionLabel = document.createElement('span');
			optionLabel.setAttribute('data-quran-state-option-label', '1');
			optionLabel.textContent = stateOptionLabels[state];
			option.appendChild(optionLabel);
			surahStateMenu.appendChild(option);
		});
		document.body.appendChild(surahStateMenu);
	}
	var pageStateMenu = document.querySelector('[data-quran-page-state-menu]');
	if (!pageStateMenu) {
		pageStateMenu = document.createElement('div');
		pageStateMenu.id = 'quran-page-state-menu';
		pageStateMenu.className = 'quran-ayah-state-menu quran-page-state-menu';
		pageStateMenu.setAttribute('data-quran-page-state-menu', '1');
		pageStateMenu.setAttribute('role', 'menu');
		pageStateMenu.setAttribute('lang', 'en');
		pageStateMenu.setAttribute('dir', 'ltr');
		pageStateMenu.setAttribute('aria-label', 'Mushaf page memorization state');
		pageStateMenu.hidden = true;
		selectableStateOptions.forEach(function (state) {
			var option = document.createElement('button');
			option.type = 'button';
			option.className = 'quran-ayah-state-option';
			option.setAttribute('data-quran-page-state-option', state);
			option.setAttribute('role', 'menuitemradio');
			option.setAttribute('aria-checked', 'false');
			option.tabIndex = -1;
			var stateDot = document.createElement('span');
			stateDot.className = 'quran-ayah-state-option-dot';
			stateDot.setAttribute('aria-hidden', 'true');
			option.appendChild(stateDot);
			var optionLabel = document.createElement('span');
			optionLabel.setAttribute('data-quran-state-option-label', '1');
			optionLabel.textContent = stateOptionLabels[state];
			option.appendChild(optionLabel);
			pageStateMenu.appendChild(option);
		});
		document.body.appendChild(pageStateMenu);
	}
	var activeStateControl = null;
	var activeSurahStateControl = null;
	var activePageStateControl = null;
	var liveRegion = document.querySelector('[data-quran-ayah-memorization-live]');
	if (!liveRegion) {
		liveRegion = document.createElement('span');
		liveRegion.className = 'visually-hidden';
		liveRegion.setAttribute('data-quran-ayah-memorization-live', '1');
		liveRegion.setAttribute('role', 'status');
		liveRegion.setAttribute('aria-live', 'polite');
		document.body.appendChild(liveRegion);
	}
	var announce = function (message) {
		liveRegion.textContent = '';
		window.setTimeout(function () { liveRegion.textContent = message || ''; }, 20);
	};
	var refForMarker = function (marker) {
		var direct = marker.getAttribute('data-quran-ref');
		var owner = direct ? null : marker.closest('[data-quran-ref]');
		if (!owner) {
			var heroAyah = marker.closest('.quran-ayah-hero-ayah');
			owner = heroAyah && heroAyah.querySelector('[data-quran-ref]');
		}
		var ref = direct || owner && owner.getAttribute('data-quran-ref') || '';
		var match = ref.replace(/^quran:/, '').match(/^(\d+):(\d+)$/);
		return match && Number(match[2]) > 0 ? `${Number(match[1])}:${Number(match[2])}` : '';
	};
	var targetForMarker = function (marker) {
		var heroLink = marker.closest('.quran-ayah-hero-link');
		if (heroLink) return heroLink;
		return marker;
	};
	var controlsForRef = function (ref) {
		return Array.from(document.querySelectorAll('.quran-ayah-state-select')).filter(function (control) {
			return control.getAttribute('data-quran-ref') === ref;
		});
	};
	var stateControlsForRef = function (ref) {
		return Array.from(document.querySelectorAll('.quran-ayah-state-control')).filter(function (control) {
			return control.getAttribute('data-quran-state-ref') === ref;
		});
	};
	var elementsForRef = function (ref) {
		return Array.from(document.querySelectorAll('[data-quran-ref]')).filter(function (element) {
			if (element.closest('.quran-mushaf-line-basmallah')) return false;
			if (element.classList.contains('quran-ayah-state-select')) return false;
			return element.getAttribute('data-quran-ref') === ref || element.getAttribute('data-quran-ref') === `quran:${ref}`;
		});
	};
	var syncStateMenu = function (state) {
		stateMenu.querySelectorAll('[data-quran-ayah-state-option]').forEach(function (option) {
			var current = option.getAttribute('data-quran-ayah-state-option') === state;
			option.classList.toggle('is-current', current);
			option.setAttribute('aria-checked', current ? 'true' : 'false');
		});
	};
	var allowedAyahStateOptions = function (state) {
		if (state === 'later') return initialAssessmentStateOptions;
		if (!state) return ['later'];
		return enrolledAyahStateOptions;
	};
	var allowedBulkStateOptions = function (state) {
		if (state === 'later') return initialAssessmentStateOptions;
		if (!state) return ['later'];
		return enrolledBulkStateOptions;
	};
	var assessmentLabel = function (state) {
		return initialAssessmentLabels[state] || stateLabels[state] || state;
	};
	var updateStateOptionPresentation = function (option, state, initialAssessment) {
		var label = initialAssessment ? assessmentLabel(state) : stateOptionLabels[state];
		var labelElement = option.querySelector('[data-quran-state-option-label]');
		if (labelElement) labelElement.textContent = label;
		option.setAttribute('aria-label', `${label}: ${stateDescriptions[state]}`);
		option.title = stateDescriptions[state];
	};
	var updatePageStateSummary = function (page) {
		if (!page) return;
		var summary = page.querySelector('[data-quran-page-state-summary]');
		if (!summary) return;
		var refs = new Set();
		var counts = { later: 0, learning: 0, weak: 0, review: 0, core: 0, relearning: 0, suspended: 0 };
		page.querySelectorAll('.quran-corpus-word[data-quran-ref], .quran-mushaf-ayah-marker').forEach(function (marker) {
			if (marker.closest('.quran-mushaf-line-basmallah')) return;
			var ref = refForMarker(marker);
			if (!ref || refs.has(ref)) return;
			refs.add(ref);
			var state = marker.getAttribute('data-quran-memorization-state') || 'later';
			counts[stateOptions.includes(state) ? state : 'later'] += 1;
		});
		stateOptions.forEach(function (state) {
			var count = summary.querySelector(`[data-quran-page-state-count="${state}"]`);
			if (count) count.textContent = counts[state].toLocaleString();
		});
		var total = summary.querySelector('[data-quran-page-state-total]');
		if (total) total.textContent = `${refs.size.toLocaleString()} ${refs.size === 1 ? 'āyah' : 'āyāt'}`;
		var pageButton = summary.querySelector('[data-quran-page-state]');
		if (!pageButton) return;
		var allLoaded = refs.size > 0 && Array.from(refs).every(function (ref) { return stateCache.has(ref); });
		if (!allLoaded) {
			pageButton.hidden = true;
			return;
		}
		var uniformState = stateOptions.find(function (state) { return counts[state] === refs.size; }) || '';
		var label = uniformState ? stateLabels[uniformState] : 'Mixed';
		var pageAction = uniformState === 'later'
			? 'Set the initial memorization self-assessment'
			: uniformState ? 'Pause or move to Later' : 'Move all ayat to Later';
		pageButton.hidden = false;
		pageButton.dataset.currentState = uniformState;
		pageButton.setAttribute('data-quran-memorization-state', uniformState || 'mixed');
		pageButton.setAttribute('aria-label', `${pageAction} for Mushaf page ${pageButton.getAttribute('data-quran-page-state')}. Current state: ${label}`);
		pageButton.title = `${pageAction} for every ayah on this Mushaf page. Current state: ${label}`;
		var current = pageButton.querySelector('[data-quran-page-state-current]');
		if (current) current.textContent = label;
	};
	var applyState = function (ref, record) {
		var lifecycleState = record && record.lifecycle_state || 'later';
		var state = lifecycleState === 'relearning' ? 'weak' : lifecycleState;
		var label = stateLabels[state] || stateLabels.later;
		var targets = new Set();
		elementsForRef(ref).forEach(function (element) {
			targets.add(element);
			var ayah = element.closest('.ayah, .quran-ayah-hero-ayah');
			if (ayah) {
				targets.add(ayah);
				if (ayah.classList.contains('quran-ayah-hero-ayah')) {
					var body = ayah.parentElement;
					var index = body ? Array.from(body.children).indexOf(ayah) : -1;
					var hero = ayah.closest('.quran-ayah-hero');
					if (hero && index >= 0) hero.querySelectorAll('.quran-ayah-hero-body').forEach(function (otherBody) {
						var matchingAyah = Array.from(otherBody.children).filter(function (child) {
							return child.classList && child.classList.contains('quran-ayah-hero-ayah');
						})[index];
						if (matchingAyah) targets.add(matchingAyah);
					});
				}
			}
		});
		targets.forEach(function (element) {
			element.setAttribute('data-quran-memorization-state', state);
			element.setAttribute('data-quran-memorization-label', label);
		});
		controlsForRef(ref).forEach(function (control) {
			control.value = state;
			control.dataset.currentState = state;
			control.dataset.rowVersion = String(record && record.row_version || 0);
			control.dataset.reviewCount = String(record && record.review_count || 0);
			control.setAttribute('aria-label', `Quran ${ref} — ${label}`);
		});
		stateControlsForRef(ref).forEach(function (stateControl) {
			stateControl.dataset.currentState = state;
			var trigger = stateControl.querySelector('[data-quran-ayah-state-toggle]');
			if (!trigger) return;
			var actionLabel = 'Memorization actions';
			trigger.setAttribute('aria-label', `${actionLabel} for Quran ${ref}. Current state: ${label}`);
			var current = trigger.querySelector('[data-quran-ayah-state-current]');
			if (current) current.textContent = label;
		});
		if (activeStateControl && activeStateControl.getAttribute('data-quran-state-ref') === ref)
			syncStateMenu(state);
		var touchedPages = new Set();
		document.querySelectorAll('.quran-ayah-end-marker, .quran-ayah-number-marker, .quran-mushaf-ayah-marker').forEach(function (marker) {
			if (refForMarker(marker) !== ref) return;
			marker.setAttribute('aria-label', `Quran ${ref} — ${label}`);
			marker.setAttribute('data-quran-memorization-state', state);
			var page = marker.closest('[data-quran-mushaf-page]');
			if (page) touchedPages.add(page);
		});
		touchedPages.forEach(updatePageStateSummary);
	};
	var getToken = async function () {
		if (tokenPromise) return tokenPromise;
		tokenPromise = (async function () {
			var attempts = 0;
			while ((!window.hadithAuth || !window.hadithAuth.getToken) && attempts < 30) {
				await new Promise(function (resolve) { window.setTimeout(resolve, 100); });
				attempts += 1;
			}
			return window.hadithAuth && window.hadithAuth.getToken ? window.hadithAuth.getToken() : null;
		}());
		window.quranAyahMemorizationTokenPromise = tokenPromise;
		return tokenPromise;
	};
	var surahButtons = function (surahNumber) {
		return Array.from(document.querySelectorAll('[data-quran-surah-state]')).filter(function (button) {
			return Number(button.getAttribute('data-quran-surah-state')) === Number(surahNumber);
		});
	};
	var applySurahStateStatus = function (status) {
		var surahNumber = Number(status && status.surah_number);
		if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) return;
		var ayahCount = Math.max(1, Number(status.ayah_count) || 1);
		var counts = {};
		stateOptions.forEach(function (state) { counts[state] = Math.max(0, Number(status.counts && status.counts[state]) || 0); });
		var uniformState = stateOptions.includes(status.uniform_state) ? status.uniform_state : null;
		var normalized = { surah_number: surahNumber, ayah_count: ayahCount, counts: counts, uniform_state: uniformState };
		surahStateCache.set(surahNumber, normalized);
		surahButtons(surahNumber).forEach(function (button) {
			var surahName = button.getAttribute('data-quran-surah-name') || `Surah ${surahNumber}`;
			var label = uniformState ? stateLabels[uniformState] : 'Mixed';
			var surahAction = uniformState === 'later'
				? 'Set the initial memorization self-assessment'
				: uniformState ? 'Pause or move to Later' : 'Move all ayat to Later';
			button.hidden = false;
			button.dataset.currentState = uniformState || '';
			button.setAttribute('data-quran-memorization-state', uniformState || 'mixed');
			button.setAttribute('aria-label', `${surahAction} for ${surahName}. Current state: ${label}`);
			button.title = `${surahAction} for every ayah in ${surahName}. Current state: ${label}`;
			var current = button.querySelector('[data-quran-surah-state-current]');
			if (current) current.textContent = label;
		});
	};
	var loadSurahStateStatuses = async function (values, force) {
		var surahs = Array.from(new Set((values || []).map(Number).filter(function (value) {
			return Number.isInteger(value) && value >= 1 && value <= 114;
		})));
		surahs.forEach(function (surahNumber) {
			if (!force && surahStateCache.has(surahNumber)) applySurahStateStatus(surahStateCache.get(surahNumber));
		});
		var pending = force ? surahs : surahs.filter(function (surahNumber) { return !surahStateCache.has(surahNumber); });
		if (!pending.length) return;
		var token = await getToken();
		if (!token) return;
		var response = await fetch(quranApiPath(`/memorization/surahs/states?surahs=${encodeURIComponent(pending.join(','))}`), {
			credentials: 'same-origin',
			headers: { 'Authorization': `Bearer ${token}` }
		});
		var data = await response.json().catch(function () { return {}; });
		if (!response.ok) throw new Error(data.error || 'Unable to load surah memorization states.');
		(data.surahs || []).forEach(applySurahStateStatus);
	};
	var adjustSurahStateStatus = function (ref, previousState, nextState) {
		if (previousState === nextState) return;
		var surahNumber = Number((ref || '').split(':')[0]);
		var status = surahStateCache.get(surahNumber);
		if (!status) return;
		var counts = Object.assign({}, status.counts);
		counts[previousState] = Math.max(0, Number(counts[previousState] || 0) - 1);
		counts[nextState] = Math.max(0, Number(counts[nextState] || 0) + 1);
		var uniformState = stateOptions.find(function (state) { return counts[state] === status.ayah_count; }) || null;
		applySurahStateStatus(Object.assign({}, status, { counts: counts, uniform_state: uniformState }));
	};
	var loadRefs = async function (refs) {
		refs = Array.from(new Set(refs)).filter(Boolean).filter(function (ref) { return !stateCache.has(ref); });
		if (!refs.length) return;
		var token = await getToken();
		if (!token) return;
		var response = await fetch(quranApiPath(`/memorization/ayahs?refs=${encodeURIComponent(refs.join(','))}`), {
			credentials: 'same-origin',
			headers: { 'Authorization': `Bearer ${token}` }
		});
		var data = await response.json().catch(function () { return {}; });
		if (!response.ok) throw new Error(data.error || 'Unable to load ayah memorization states.');
		(data.ayahs || []).forEach(function (record) {
			var ref = `${record.surah_number}:${record.ayah_number}`;
			stateCache.set(ref, record);
			applyState(ref, record);
		});
	};
	var closeStateMenu = function (restoreFocus) {
		var trigger = activeStateControl && activeStateControl.querySelector('[data-quran-ayah-state-toggle]');
		if (trigger) trigger.setAttribute('aria-expanded', 'false');
		stateMenu.hidden = true;
		stateMenu.removeAttribute('data-quran-state-ref');
		if (restoreFocus && trigger) trigger.focus();
		activeStateControl = null;
	};
	var closeSurahStateMenu = function (restoreFocus) {
		var trigger = activeSurahStateControl;
		if (trigger) trigger.setAttribute('aria-expanded', 'false');
		surahStateMenu.hidden = true;
		if (restoreFocus && trigger) trigger.focus();
		activeSurahStateControl = null;
	};
	var closePageStateMenu = function (restoreFocus) {
		var trigger = activePageStateControl;
		if (trigger) trigger.setAttribute('aria-expanded', 'false');
		pageStateMenu.hidden = true;
		if (restoreFocus && trigger) trigger.focus();
		activePageStateControl = null;
	};
	var positionBulkStateMenu = function (menu, trigger) {
		var triggerRect = trigger.getBoundingClientRect();
		var menuRect = menu.getBoundingClientRect();
		var left = Math.max(8, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
		var top = triggerRect.bottom + 6;
		if (top + menuRect.height > window.innerHeight - 8) top = Math.max(8, triggerRect.top - menuRect.height - 6);
		menu.style.left = `${Math.round(left)}px`;
		menu.style.top = `${Math.round(top)}px`;
	};
	var positionStateMenu = function (trigger) {
		var triggerRect = trigger.getBoundingClientRect();
		var menuRect = stateMenu.getBoundingClientRect();
		var left = triggerRect.left + (triggerRect.width - menuRect.width) / 2;
		left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
		var top = triggerRect.bottom + 6;
		if (top + menuRect.height > window.innerHeight - 8)
			top = Math.max(8, triggerRect.top - menuRect.height - 6);
		stateMenu.style.left = `${Math.round(left)}px`;
		stateMenu.style.top = `${Math.round(top)}px`;
	};
	var showStateMenu = function (stateControl, focusOption) {
		var trigger = stateControl.querySelector('[data-quran-ayah-state-toggle]');
		var control = stateControl.querySelector('.quran-ayah-state-select');
		if (!trigger || !control || trigger.disabled) return;
		closeSurahStateMenu(false);
		closePageStateMenu(false);
		if (activeStateControl && activeStateControl !== stateControl) {
			var previousTrigger = activeStateControl.querySelector('[data-quran-ayah-state-toggle]');
			if (previousTrigger) previousTrigger.setAttribute('aria-expanded', 'false');
		}
		activeStateControl = stateControl;
		var ref = stateControl.getAttribute('data-quran-state-ref');
		var state = control.dataset.currentState || control.value || 'later';
		var memorizePage = stateControl.closest('[data-quran-memorize-page]');
		var ayahWords = memorizePage ? Array.from(memorizePage.querySelectorAll('.quran-corpus-word[data-quran-ref]')).filter(function (word) {
			return word.getAttribute('data-quran-ref') === ref && !word.closest('.quran-mushaf-line-basmallah');
		}) : [];
		var ayahIsRevealed = Boolean(memorizePage && memorizePage.classList.contains('quran-memorize-show-all'))
			|| (ayahWords.length > 0 && ayahWords.every(function (word) {
				return word.classList.contains('quran-memorize-ayah-revealed');
			}));
		trigger.setAttribute('aria-expanded', 'true');
		stateMenu.setAttribute('aria-label', `Memorization actions for Quran ${ref}`);
		stateMenu.setAttribute('data-quran-state-ref', ref);
		syncStateMenu(state);
		playAyahOption.hidden = false;
		playAyahOption.disabled = control.disabled;
		revealAyahOption.hidden = Boolean(stateControl.closest('[data-quran-review-reader]'));
		revealAyahOption.disabled = control.disabled;
		revealAyahOption.dataset.quranAyahRevealAction = ayahIsRevealed ? 'hide' : 'reveal';
		revealAyahOption.setAttribute('aria-label', `${ayahIsRevealed ? 'Hide' : 'Reveal'} Quran ${ref}`);
		revealAyahOption.title = ayahIsRevealed ? 'Hide' : 'Reveal';
		var revealAyahIcon = revealAyahOption.querySelector('.bi');
		if (revealAyahIcon) {
			revealAyahIcon.classList.toggle('bi-eye', !ayahIsRevealed);
			revealAyahIcon.classList.toggle('bi-eye-slash', ayahIsRevealed);
		}
		var revealAyahLabel = revealAyahOption.querySelector('span:last-child');
		if (revealAyahLabel) revealAyahLabel.textContent = ayahIsRevealed ? 'Hide' : 'Reveal';
		stateMenu.querySelectorAll('[data-quran-ayah-state-option]').forEach(function (option) {
			var optionState = option.getAttribute('data-quran-ayah-state-option');
			updateStateOptionPresentation(option, optionState, state === 'later');
			option.hidden = allowedAyahStateOptions(state).indexOf(optionState) === -1;
			option.disabled = control.disabled;
		});
		stateMenu.hidden = false;
		positionStateMenu(trigger);
		if (focusOption) {
			var current = stateMenu.querySelector('[aria-checked="true"]:not([hidden])') || stateMenu.querySelector('[data-quran-ayah-state-option]:not([hidden])');
			if (current) current.focus();
		}
	};
	var showSurahStateMenu = function (trigger, focusOption) {
		if (!trigger || trigger.disabled) return;
		closeStateMenu(false);
		closePageStateMenu(false);
		if (activeSurahStateControl && activeSurahStateControl !== trigger)
			activeSurahStateControl.setAttribute('aria-expanded', 'false');
		activeSurahStateControl = trigger;
		var state = trigger.dataset.currentState || '';
		var surahName = trigger.getAttribute('data-quran-surah-name') || `Surah ${trigger.getAttribute('data-quran-surah-state')}`;
		trigger.setAttribute('aria-expanded', 'true');
		surahStateMenu.setAttribute('aria-label', `Memorization state for ${surahName}`);
		surahStateMenu.querySelectorAll('[data-quran-surah-state-option]').forEach(function (option) {
			var optionState = option.getAttribute('data-quran-surah-state-option');
			updateStateOptionPresentation(option, optionState, state === 'later');
			var current = optionState === state;
			option.hidden = allowedBulkStateOptions(state).indexOf(optionState) === -1;
			option.classList.toggle('is-current', current);
			option.setAttribute('aria-checked', current ? 'true' : 'false');
			option.disabled = trigger.disabled;
		});
		surahStateMenu.hidden = false;
		positionBulkStateMenu(surahStateMenu, trigger);
		if (focusOption) {
			var currentOption = surahStateMenu.querySelector('.is-current:not([hidden])') || surahStateMenu.querySelector('[data-quran-surah-state-option]:not([hidden])');
			if (currentOption) currentOption.focus();
		}
	};
	var showPageStateMenu = function (trigger, focusOption) {
		if (!trigger || trigger.disabled) return;
		closeStateMenu(false);
		closeSurahStateMenu(false);
		if (activePageStateControl && activePageStateControl !== trigger)
			activePageStateControl.setAttribute('aria-expanded', 'false');
		activePageStateControl = trigger;
		var state = trigger.dataset.currentState || '';
		var pageNumber = trigger.getAttribute('data-quran-page-state');
		trigger.setAttribute('aria-expanded', 'true');
		pageStateMenu.setAttribute('aria-label', `Memorization state for Mushaf page ${pageNumber}`);
		pageStateMenu.querySelectorAll('[data-quran-page-state-option]').forEach(function (option) {
			var optionState = option.getAttribute('data-quran-page-state-option');
			updateStateOptionPresentation(option, optionState, state === 'later');
			var current = optionState === state;
			option.hidden = allowedBulkStateOptions(state).indexOf(optionState) === -1;
			option.classList.toggle('is-current', current);
			option.setAttribute('aria-checked', current ? 'true' : 'false');
			option.disabled = trigger.disabled;
		});
		pageStateMenu.hidden = false;
		positionBulkStateMenu(pageStateMenu, trigger);
		if (focusOption) {
			var currentOption = pageStateMenu.querySelector('.is-current:not([hidden])') || pageStateMenu.querySelector('[data-quran-page-state-option]:not([hidden])');
			if (currentOption) currentOption.focus();
		}
	};
	var setControlsDisabled = function (ref, disabled) {
		controlsForRef(ref).forEach(function (control) { control.disabled = disabled; });
		stateControlsForRef(ref).forEach(function (stateControl) {
			var trigger = stateControl.querySelector('[data-quran-ayah-state-toggle]');
			if (trigger) trigger.disabled = disabled;
		});
	};
	var setControlsHidden = function (ref, hidden) {
		stateControlsForRef(ref).forEach(function (stateControl) { stateControl.hidden = hidden; });
	};
	var bind = function (scope) {
		var markers = [];
		if (scope.matches && scope.matches('.quran-ayah-end-marker, .quran-ayah-number-marker, .quran-mushaf-ayah-marker'))
			markers.push(scope);
		if (scope.querySelectorAll)
			markers = markers.concat(Array.from(scope.querySelectorAll('.quran-ayah-end-marker, .quran-ayah-number-marker, .quran-mushaf-ayah-marker')));
		var refs = [];
		var scopePages = [];
		if (scope.matches && scope.matches('[data-quran-memorize-page]')) scopePages.push(scope);
		if (scope.querySelectorAll) scopePages = scopePages.concat(Array.from(scope.querySelectorAll('[data-quran-memorize-page]')));
		scopePages.forEach(function (page) {
			page.querySelectorAll('.quran-corpus-word[data-quran-ref]').forEach(function (word) {
				if (word.closest('.quran-mushaf-line-basmallah')) return;
				var ref = refForMarker(word);
				if (ref) refs.push(ref);
			});
		});
		var scopeSurahButtons = [];
		if (scope.matches && scope.matches('[data-quran-surah-state]')) scopeSurahButtons.push(scope);
		if (scope.querySelectorAll) scopeSurahButtons = scopeSurahButtons.concat(Array.from(scope.querySelectorAll('[data-quran-surah-state]')));
		var surahs = scopeSurahButtons.map(function (button) { return Number(button.getAttribute('data-quran-surah-state')); });
		markers.forEach(function (marker) {
			if (marker.closest('[data-share-card], .hadith-share-root')) return;
			if (marker.closest('.quran-review-page-continuity')) return;
			if (!marker.closest('[data-quran-memorize-reader]')) return;
			var ref = refForMarker(marker);
			if (!ref || marker.dataset.quranAyahMemorizationBound === '1') return;
			marker.dataset.quranAyahMemorizationBound = '1';
			var stateControl = document.createElement('span');
			stateControl.className = 'quran-ayah-state-control';
			stateControl.setAttribute('data-quran-state-ref', ref);
			stateControl.dataset.currentState = 'later';
			stateControl.hidden = true;
			var trigger = document.createElement('button');
			trigger.type = 'button';
			trigger.className = 'quran-ayah-state-toggle';
			trigger.setAttribute('data-quran-ayah-state-toggle', '1');
			trigger.setAttribute('aria-haspopup', 'menu');
			trigger.setAttribute('aria-expanded', 'false');
			trigger.setAttribute('aria-controls', stateMenu.id);
			trigger.setAttribute('aria-label', `Memorization actions for Quran ${ref}. Current state: Later`);
			trigger.innerHTML = '<span class="bi bi-caret-down-square-fill" aria-hidden="true"></span><span class="visually-hidden" data-quran-ayah-state-current>Later</span>';
			var control = document.createElement('select');
			control.className = 'quran-ayah-state-select';
			control.setAttribute('data-quran-ref', ref);
			control.setAttribute('aria-label', `Quran ${ref} — Later`);
			control.setAttribute('aria-hidden', 'true');
			control.tabIndex = -1;
			control.hidden = true;
			stateOptions.forEach(function (state) {
				var option = document.createElement('option');
				option.value = state;
				option.textContent = stateLabels[state];
				control.appendChild(option);
			});
			stateControl.appendChild(trigger);
			stateControl.appendChild(control);
			var target = targetForMarker(marker);
			target.insertAdjacentElement('afterend', stateControl);
			refs.push(ref);
			if (stateCache.has(ref)) applyState(ref, stateCache.get(ref));
		});
		refs = Array.from(new Set(refs));
		getToken().then(function (token) {
			if (!token) return;
			return Promise.all([loadRefs(refs), loadSurahStateStatuses(surahs)]).then(function () {
				refs.forEach(function (ref) { setControlsHidden(ref, false); });
				scopePages.forEach(updatePageStateSummary);
			});
		}).catch(function () {});
	};
	bind(root || document);
	if (document.documentElement.dataset.quranAyahMemorizationBound !== '1') {
		document.documentElement.dataset.quranAyahMemorizationBound = '1';
		document.addEventListener('click', async function (event) {
			var pageStateTrigger = event.target.closest && event.target.closest('[data-quran-page-state]');
			if (pageStateTrigger) {
				event.preventDefault();
				if (!pageStateMenu.hidden && activePageStateControl === pageStateTrigger)
					closePageStateMenu(true);
				else
					showPageStateMenu(pageStateTrigger, event.detail === 0);
				return;
			}
			var pageOption = event.target.closest && event.target.closest('[data-quran-page-state-option]');
			if (pageOption && pageStateMenu.contains(pageOption) && activePageStateControl) {
				event.preventDefault();
				var pageButton = activePageStateControl;
				var pageNumber = Number(pageButton.getAttribute('data-quran-page-state'));
				var nextPageState = pageOption.getAttribute('data-quran-page-state-option');
				var currentPageState = pageButton.dataset.currentState || '';
				closePageStateMenu(true);
				if (!nextPageState || nextPageState === currentPageState) return;
				var matchingPageButtons = Array.from(document.querySelectorAll('[data-quran-page-state]')).filter(function (button) {
					return Number(button.getAttribute('data-quran-page-state')) === pageNumber;
				});
				matchingPageButtons.forEach(function (button) { button.disabled = true; });
				try {
					var pageToken = await getToken();
					if (!pageToken && window.hadithAuth && window.hadithAuth.requireToken)
						pageToken = await window.hadithAuth.requireToken('Please sign in to save Quran memorization progress.');
					if (!pageToken) throw new Error('Please sign in to save Quran memorization progress.');
					var pageResponse = await fetch(quranApiPath(`/memorization/pages/${pageNumber}/state`), {
						method: 'PUT', credentials: 'same-origin',
						headers: { 'Authorization': `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
						body: JSON.stringify({ lifecycle_state: nextPageState })
					});
					var pageData = await pageResponse.json().catch(function () { return {}; });
					if (!pageResponse.ok) throw new Error(pageData.error || 'Unable to update this Mushaf page.');
					if (currentPageState === 'later' && ['learning', 'weak', 'review'].includes(nextPageState)) trackQuranAnalyticsEvent('quran_memorization_enroll', {
						enrollment_scope: 'page', mushaf_page: pageNumber,
						enrolled_ayah_count: Number(pageData.changed_count || pageData.ayah_count || 0), initial_state: nextPageState
					});
					var affectedSurahs = new Set();
					(pageData.ayahs || []).forEach(function (record) {
						var ref = `${record.surah_number}:${record.ayah_number}`;
						affectedSurahs.add(Number(record.surah_number));
						stateCache.set(ref, record);
						applyState(ref, record);
					});
					await loadSurahStateStatuses(Array.from(affectedSurahs), true);
					var pageMessage = currentPageState === 'later'
						? `All ${Number(pageData.ayah_count || 0).toLocaleString()} ayat on Mushaf page ${pageNumber} received the ${assessmentLabel(nextPageState)} assessment.`
						: `All ${Number(pageData.ayah_count || 0).toLocaleString()} ayat on Mushaf page ${pageNumber} are now ${stateLabels[nextPageState]}.`;
					announce(pageMessage);
					if (window.toastr) window.toastr.success(pageMessage, 'Page updated');
				} catch (err) {
					announce(err.message || 'Unable to update this Mushaf page.');
					if (window.toastr) window.toastr.error(err.message || 'Unable to update this Mushaf page.', 'Memorization not saved');
				} finally {
					matchingPageButtons.forEach(function (button) { button.disabled = false; });
				}
				return;
			}
			var surahStateTrigger = event.target.closest && event.target.closest('[data-quran-surah-state]');
			if (surahStateTrigger) {
				event.preventDefault();
				if (!surahStateMenu.hidden && activeSurahStateControl === surahStateTrigger)
					closeSurahStateMenu(true);
				else
					showSurahStateMenu(surahStateTrigger, event.detail === 0);
				return;
			}
			var surahOption = event.target.closest && event.target.closest('[data-quran-surah-state-option]');
			if (surahOption && surahStateMenu.contains(surahOption) && activeSurahStateControl) {
				event.preventDefault();
				var surahButton = activeSurahStateControl;
				var surahNumber = Number(surahButton.getAttribute('data-quran-surah-state'));
				var surahName = surahButton.getAttribute('data-quran-surah-name') || `Surah ${surahNumber}`;
				var nextSurahState = surahOption.getAttribute('data-quran-surah-state-option');
				var currentSurahState = surahButton.dataset.currentState || '';
				closeSurahStateMenu(true);
				if (!nextSurahState || nextSurahState === currentSurahState) return;
				var surahChoiceLabel = currentSurahState === 'later' ? assessmentLabel(nextSurahState) : stateLabels[nextSurahState];
				if (!window.confirm(`Set every ayah in ${surahName} to ${surahChoiceLabel}?`)) return;
				var matchingSurahButtons = surahButtons(surahNumber);
				matchingSurahButtons.forEach(function (button) { button.disabled = true; });
				try {
					var token = await getToken();
					if (!token && window.hadithAuth && window.hadithAuth.requireToken)
						token = await window.hadithAuth.requireToken('Please sign in to save Quran memorization progress.');
					if (!token) throw new Error('Please sign in to save Quran memorization progress.');
					var response = await fetch(quranApiPath(`/memorization/surahs/${surahNumber}/state`), {
						method: 'PUT', credentials: 'same-origin',
						headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
						body: JSON.stringify({ lifecycle_state: nextSurahState })
					});
					var data = await response.json().catch(function () { return {}; });
					if (!response.ok) throw new Error(data.error || 'Unable to update this surah.');
					if (currentSurahState === 'later' && ['learning', 'weak', 'review'].includes(nextSurahState)) trackQuranAnalyticsEvent('quran_memorization_enroll', {
						enrollment_scope: 'surah', surah_number: surahNumber,
						enrolled_ayah_count: Number(data.changed_count || data.ayah_count || 0), initial_state: nextSurahState
					});
					(data.ayahs || []).forEach(function (record) {
						var ref = `${record.surah_number}:${record.ayah_number}`;
						stateCache.set(ref, record);
						applyState(ref, record);
					});
					var counts = {};
					stateOptions.forEach(function (state) { counts[state] = state === nextSurahState ? Number(data.ayah_count) || 0 : 0; });
					applySurahStateStatus({ surah_number: surahNumber, ayah_count: data.ayah_count, counts: counts, uniform_state: nextSurahState });
					var message = currentSurahState === 'later'
						? `All ${Number(data.ayah_count || 0).toLocaleString()} ayat in ${surahName} received the ${assessmentLabel(nextSurahState)} assessment.`
						: `All ${Number(data.ayah_count || 0).toLocaleString()} ayat in ${surahName} are now ${stateLabels[nextSurahState]}.`;
					announce(message);
					if (window.toastr) window.toastr.success(message, 'Surah updated');
				} catch (err) {
					announce(err.message || 'Unable to update this surah.');
					if (window.toastr) window.toastr.error(err.message || 'Unable to update this surah.', 'Memorization not saved');
				} finally {
					matchingSurahButtons.forEach(function (button) { button.disabled = false; });
				}
				return;
			}
			var trigger = event.target.closest && event.target.closest('[data-quran-ayah-state-toggle]');
			if (trigger) {
				event.preventDefault();
				var stateControl = trigger.closest('.quran-ayah-state-control');
				if (!stateMenu.hidden && activeStateControl === stateControl)
					closeStateMenu(true);
				else
					showStateMenu(stateControl, event.detail === 0);
				return;
			}
			var revealOption = event.target.closest && event.target.closest('[data-quran-ayah-reveal-option]');
			if (revealOption && stateMenu.contains(revealOption) && activeStateControl) {
				event.preventDefault();
				var revealRef = activeStateControl.getAttribute('data-quran-state-ref') || '';
				var revealAyah = revealOption.dataset.quranAyahRevealAction !== 'hide';
				closeStateMenu(true);
				document.querySelectorAll('[data-quran-memorize-page]').forEach(function (memorizePage) {
					var hasRef = Array.from(memorizePage.querySelectorAll('.quran-corpus-word[data-quran-ref]')).some(function (word) {
						return word.getAttribute('data-quran-ref') === revealRef && !word.closest('.quran-mushaf-line-basmallah');
					});
					if (hasRef) memorizePage.dispatchEvent(new CustomEvent('quranMemorizeRevealAyah', { detail: { ref: revealRef, revealed: revealAyah } }));
				});
				announce(`Quran ${revealRef} ${revealAyah ? 'revealed' : 'hidden'}.`);
				return;
			}
			var playOption = event.target.closest && event.target.closest('[data-quran-ayah-play-option]');
			if (playOption && stateMenu.contains(playOption) && activeStateControl) {
				event.preventDefault();
				var playRef = activeStateControl.getAttribute('data-quran-state-ref') || '';
				closeStateMenu(true);
				document.querySelectorAll('[data-quran-memorize-page]').forEach(function (memorizePage) {
					var hasRef = Array.from(memorizePage.querySelectorAll('.quran-corpus-word[data-quran-ref]')).some(function (word) {
						return word.getAttribute('data-quran-ref') === playRef && !word.closest('.quran-mushaf-line-basmallah');
					});
					if (hasRef) memorizePage.dispatchEvent(new CustomEvent('quranMemorizeRevealAyah', { detail: { ref: playRef, revealed: true } }));
				});
				if (startQuranAyahAudio(playRef)) announce(`Playing and revealing Quran ${playRef}.`);
				return;
			}
			var reviewOption = event.target.closest && event.target.closest('[data-quran-ayah-review-option]');
			if (reviewOption && stateMenu.contains(reviewOption) && activeStateControl) {
				event.preventDefault();
				var reviewRef = activeStateControl.getAttribute('data-quran-state-ref') || '';
				closeStateMenu(true);
				var reviewModal = document.getElementById('quran-memorize-review-modal');
				if (reviewModal && window.bootstrap && bootstrap.Modal) {
					var reviewTrigger = document.createElement('button');
					reviewTrigger.setAttribute('data-quran-memorize-review-ref', reviewRef);
					bootstrap.Modal.getOrCreateInstance(reviewModal).show(reviewTrigger);
				}
				return;
			}
			var option = event.target.closest && event.target.closest('[data-quran-ayah-state-option]');
			if (option && stateMenu.contains(option) && activeStateControl) {
				event.preventDefault();
				var control = activeStateControl.querySelector('.quran-ayah-state-select');
				var next = option.getAttribute('data-quran-ayah-state-option');
				var current = control && (control.dataset.currentState || control.value || 'later');
				closeStateMenu(true);
				if (!control || !next || next === current) return;
				control.value = next;
				control.dispatchEvent(new Event('change', { bubbles: true }));
				return;
			}
			if (!stateMenu.hidden && !stateMenu.contains(event.target))
				closeStateMenu(false);
			if (!surahStateMenu.hidden && !surahStateMenu.contains(event.target))
				closeSurahStateMenu(false);
			if (!pageStateMenu.hidden && !pageStateMenu.contains(event.target))
				closePageStateMenu(false);
		});
		stateMenu.addEventListener('keydown', function (event) {
			if (stateMenu.hidden) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				closeStateMenu(true);
				return;
			}
			if (event.key === 'Tab') {
				closeStateMenu(false);
				return;
			}
			var options = Array.from(stateMenu.querySelectorAll('[data-quran-ayah-play-option]:not([hidden]):not(:disabled), [data-quran-ayah-reveal-option]:not([hidden]):not(:disabled), [data-quran-ayah-review-option]:not([hidden]):not(:disabled), [data-quran-ayah-state-option]:not([hidden]):not(:disabled)'));
			var index = options.indexOf(document.activeElement);
			var nextIndex = null;
			if (event.key === 'ArrowDown') nextIndex = index < 0 ? 0 : (index + 1) % options.length;
			if (event.key === 'ArrowUp') nextIndex = index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length;
			if (event.key === 'Home') nextIndex = 0;
			if (event.key === 'End') nextIndex = options.length - 1;
			if (nextIndex === null || !options.length) return;
			event.preventDefault();
			options[nextIndex].focus();
		});
		surahStateMenu.addEventListener('keydown', function (event) {
			if (surahStateMenu.hidden) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				closeSurahStateMenu(true);
				return;
			}
			if (event.key === 'Tab') {
				closeSurahStateMenu(false);
				return;
			}
			var options = Array.from(surahStateMenu.querySelectorAll('[data-quran-surah-state-option]:not([hidden]):not(:disabled)'));
			var index = options.indexOf(document.activeElement);
			var nextIndex = null;
			if (event.key === 'ArrowDown') nextIndex = index < 0 ? 0 : (index + 1) % options.length;
			if (event.key === 'ArrowUp') nextIndex = index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length;
			if (event.key === 'Home') nextIndex = 0;
			if (event.key === 'End') nextIndex = options.length - 1;
			if (nextIndex === null || !options.length) return;
			event.preventDefault();
			options[nextIndex].focus();
		});
		pageStateMenu.addEventListener('keydown', function (event) {
			if (pageStateMenu.hidden) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				closePageStateMenu(true);
				return;
			}
			if (event.key === 'Tab') {
				closePageStateMenu(false);
				return;
			}
			var options = Array.from(pageStateMenu.querySelectorAll('[data-quran-page-state-option]:not([hidden]):not(:disabled)'));
			var index = options.indexOf(document.activeElement);
			var nextIndex = null;
			if (event.key === 'ArrowDown') nextIndex = index < 0 ? 0 : (index + 1) % options.length;
			if (event.key === 'ArrowUp') nextIndex = index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length;
			if (event.key === 'Home') nextIndex = 0;
			if (event.key === 'End') nextIndex = options.length - 1;
			if (nextIndex === null || !options.length) return;
			event.preventDefault();
			options[nextIndex].focus();
		});
		window.addEventListener('scroll', function () {
			if (!surahStateMenu.hidden) closeSurahStateMenu(false);
			if (!pageStateMenu.hidden) closePageStateMenu(false);
			if (stateMenu.hidden || !activeStateControl) return;
			var trigger = activeStateControl.querySelector('[data-quran-ayah-state-toggle]');
			if (!trigger) return closeStateMenu(false);
			var rect = trigger.getBoundingClientRect();
			if (rect.bottom < 0 || rect.top > window.innerHeight)
				closeStateMenu(false);
			else
				positionStateMenu(trigger);
		}, { passive: true });
		window.addEventListener('resize', function () {
			if (!surahStateMenu.hidden) closeSurahStateMenu(false);
			if (!pageStateMenu.hidden) closePageStateMenu(false);
			if (!stateMenu.hidden && activeStateControl) {
				var trigger = activeStateControl.querySelector('[data-quran-ayah-state-toggle]');
				if (trigger) positionStateMenu(trigger);
			}
		}, { passive: true });
		document.addEventListener('change', async function (event) {
			var control = event.target.closest('.quran-ayah-state-select');
			if (!control) return;
			var ref = control.getAttribute('data-quran-ref');
			var previous = control.dataset.currentState || 'later';
			var next = control.value;
			var oldRecord = stateCache.get(ref) || { lifecycle_state: previous, row_version: Number(control.dataset.rowVersion || 0), review_count: Number(control.dataset.reviewCount || 0) };
			var optimistic = Object.assign({}, oldRecord, { lifecycle_state: next });
			applyState(ref, optimistic);
			setControlsDisabled(ref, true);
			try {
				var token = await getToken();
				if (!token && window.hadithAuth && window.hadithAuth.requireToken)
					token = await window.hadithAuth.requireToken('Please sign in to save ayah memorization progress.');
				if (!token) throw new Error('Please sign in to save ayah memorization progress.');
				var parts = ref.split(':');
				var response = await fetch(quranApiPath(`/memorization/ayahs/${parts[0]}/${parts[1]}/state`), {
					method: 'PUT',
					credentials: 'same-origin',
					headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ lifecycle_state: next, expected_version: Number(oldRecord.row_version || 0) })
				});
				var data = await response.json().catch(function () { return {}; });
				if (!response.ok) throw new Error(data.error || 'Unable to update this ayah.');
				if (previous === 'later' && ['learning', 'weak', 'review'].includes(data.ayah.lifecycle_state)) trackQuranAnalyticsEvent('quran_memorization_enroll', {
					enrollment_scope: 'ayah', surah_number: Number(parts[0]), ayah_number: Number(parts[1]),
					enrolled_ayah_count: 1, initial_state: data.ayah.lifecycle_state
				});
				stateCache.set(ref, data.ayah);
				applyState(ref, data.ayah);
				adjustSurahStateStatus(ref, previous, data.ayah.lifecycle_state);
				var successMessage = previous === 'later'
					? `Quran ${ref} received the ${assessmentLabel(data.ayah.lifecycle_state)} assessment.`
					: `Quran ${ref} is now ${stateLabels[data.ayah.lifecycle_state]}.`;
				announce(successMessage);
				if (window.toastr) window.toastr.success(successMessage, 'Memorization updated');
			} catch (err) {
				stateCache.set(ref, oldRecord);
				applyState(ref, oldRecord);
				announce(err.message || 'Unable to update this ayah.');
				if (window.toastr) window.toastr.error(err.message || 'Unable to update this ayah.', 'Memorization not saved');
			} finally {
				setControlsDisabled(ref, false);
			}
		});
		var observer = new MutationObserver(function (mutations) {
			mutations.forEach(function (mutation) {
				mutation.addedNodes.forEach(function (node) {
					if (node.nodeType === 1) bind(node);
				});
			});
		});
		observer.observe(document.body, { childList: true, subtree: true });
		document.addEventListener('hadithAuthChanged', function (event) {
			tokenPromise = null;
			window.quranAyahMemorizationTokenPromise = null;
			stateCache.clear();
			surahStateCache.clear();
			closeStateMenu(false);
			closeSurahStateMenu(false);
			closePageStateMenu(false);
			var visiblePageButtons = Array.from(document.querySelectorAll('[data-quran-page-state]'));
			visiblePageButtons.forEach(function (button) {
				button.hidden = true;
				delete button.dataset.currentState;
			});
			var visibleSurahButtons = Array.from(document.querySelectorAll('[data-quran-surah-state]'));
			var surahs = Array.from(new Set(visibleSurahButtons.map(function (button) {
				button.hidden = true;
				delete button.dataset.currentState;
				return Number(button.getAttribute('data-quran-surah-state'));
			}).filter(Boolean)));
			var controls = Array.from(document.querySelectorAll('.quran-ayah-state-select'));
			var refs = controls.map(function (control) {
				var ref = control.getAttribute('data-quran-ref');
				setControlsHidden(ref, true);
				return ref;
			}).filter(Boolean);
			document.querySelectorAll('[data-quran-memorize-page] .quran-corpus-word[data-quran-ref]').forEach(function (word) {
				if (word.closest('.quran-mushaf-line-basmallah')) return;
				var ref = refForMarker(word);
				if (ref) refs.push(ref);
			});
			refs = Array.from(new Set(refs));
			refs.forEach(function (ref) { applyState(ref, { lifecycle_state: 'later', row_version: 0, review_count: 0 }); });
			if (!(event.detail && event.detail.user)) return;
			Promise.all([loadRefs(refs), loadSurahStateStatuses(surahs)]).then(function () {
				refs.forEach(function (ref) { setControlsHidden(ref, false); });
				document.querySelectorAll('[data-quran-memorize-page]').forEach(updatePageStateSummary);
			}).catch(function (err) {
				announce(err.message || 'Unable to load ayah memorization states.');
			});
		});
	}
}

function initQuranMemorizeView(root) {
	var scope = root || document;
	var pages = scope.matches && scope.matches('[data-quran-memorize-page]')
		? [scope]
		: Array.from(scope.querySelectorAll('[data-quran-memorize-page]'));
	pages.forEach(function (page) {
		if (page.dataset.quranMemorizeBound === '1')
			return;
		page.dataset.quranMemorizeBound = '1';
		var wordTimers = new WeakMap();
		var reviewPage = Boolean(page.closest('[data-quran-review-reader]'));
		var learningRef = new URLSearchParams(window.location.search).get('learningRef') || '';
		if (/^\d+:\d+$/.test(learningRef)) {
			var learningTargets = Array.from(page.querySelectorAll('[data-quran-ref]')).filter(function (element) {
				return element.getAttribute('data-quran-ref') === learningRef && !element.closest('.quran-mushaf-line-basmallah');
			});
			learningTargets.forEach(function (element) { element.classList.add('quran-learning-target-ayah'); });
			if (learningTargets.length && document.documentElement.dataset.quranLearningTargetScrolled !== '1') {
				document.documentElement.dataset.quranLearningTargetScrolled = '1';
				window.requestAnimationFrame(function () {
					var target = learningTargets.find(function (element) { return element.classList.contains('quran-ayah-end-marker'); }) || learningTargets[0];
					if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
				});
			}
		}
		var initialAutoHide = false;
		page.dataset.quranMemorizeAutoHide = 'false';
		var revealWord = function (word) {
			var existingTimer = wordTimers.get(word);
			if (existingTimer)
				window.clearTimeout(existingTimer);
			word.classList.add('quran-memorize-word-revealed');
			hideQuranAudioTranslationMarquee();
			showQuranRevealedWordTranslation(word);
			if (page.dataset.quranMemorizeAutoHide === 'false') {
				wordTimers.delete(word);
				return;
			}
			wordTimers.set(word, window.setTimeout(function () {
				word.classList.remove('quran-memorize-word-revealed');
				hideQuranRevealedWordTranslation(word);
				wordTimers.delete(word);
			}, 2000));
		};
		var syncAutoHideControls = function (autoHide) {
			page.querySelectorAll('[data-quran-memorize-autohide-toggle]').forEach(function (control) {
				control.classList.toggle('active', autoHide);
				control.setAttribute('aria-pressed', autoHide ? 'true' : 'false');
				control.setAttribute('aria-label', `${autoHide ? 'Turn off' : 'Turn on'} clicked word auto-hide on page ${page.getAttribute('data-quran-mushaf-page') || ''}`.trim());
				control.setAttribute('title', autoHide ? 'Clicked words hide after two seconds' : 'Clicked words stay visible');
			});
		};
		var syncAllControls = function (showAll) {
			page.querySelectorAll('[data-quran-memorize-all-toggle]').forEach(function (control) {
				control.classList.toggle('active', showAll);
				control.setAttribute('aria-pressed', showAll ? 'true' : 'false');
				control.setAttribute('aria-label', `${showAll ? 'Hide' : 'View'} all words on page ${page.getAttribute('data-quran-mushaf-page') || ''}`.trim());
				control.setAttribute('title', `${showAll ? 'Hide' : 'View'} all words`);
				var icon = control.querySelector('[data-quran-memorize-all-toggle-icon]');
				if (icon) {
					icon.classList.toggle('bi-eye', showAll);
					icon.classList.toggle('bi-eye-slash', !showAll);
				}
			});
		};
		var ayahWordsForRef = function (ref) {
			return Array.from(page.querySelectorAll('.quran-corpus-word[data-quran-ref]')).filter(function (word) {
				return word.getAttribute('data-quran-ref') === ref && !word.closest('.quran-mushaf-line-basmallah');
			});
		};
		var isReviewWordVisible = function (word) {
			return reviewPage && (page.classList.contains('quran-memorize-show-all')
				|| word.classList.contains('quran-memorize-word-revealed')
				|| word.classList.contains('quran-memorize-ayah-revealed')
				|| word.classList.contains('quran-review-session-revealed'));
		};
		var setReviewAyahRevealed = function (ref, revealed) {
			page.querySelectorAll('.quran-corpus-word[data-quran-ref], .quran-mushaf-ayah-marker[data-quran-ref]').forEach(function (element) {
				if (element.getAttribute('data-quran-ref') === ref && !element.closest('.quran-mushaf-line-basmallah'))
					element.classList.toggle('quran-review-session-revealed', revealed);
			});
		};
		var setAyahRevealed = function (ref, revealed, showTranslation) {
			ayahWordsForRef(ref).forEach(function (word) {
				var timer = wordTimers.get(word);
				if (timer)
					window.clearTimeout(timer);
				wordTimers.delete(word);
				hideQuranRevealedWordTranslation(word);
				word.classList.remove('quran-memorize-word-revealed');
				word.classList.toggle('quran-memorize-ayah-revealed', revealed);
			});
			setReviewAyahRevealed(ref, revealed);
			if (revealed && showTranslation !== false) showQuranSelectionTranslationMarquee(ref);
			else if (quranAudioTranslationMarqueeState.activeVerseKey === ref) hideQuranAudioTranslationMarquee();
		};
		var materializePageReveal = function () {
			if (!page.classList.contains('quran-memorize-show-all')) return;
			var refs = Array.from(page.querySelectorAll('.quran-mushaf-ayah-marker[data-quran-ref]')).map(function (marker) {
				return marker.getAttribute('data-quran-ref');
			}).filter(Boolean);
			Array.from(new Set(refs)).forEach(function (ref) { setAyahRevealed(ref, true, false); });
			page.classList.remove('quran-memorize-show-all');
			syncAllControls(false);
		};
		var recitationRecorder = null;
		var recitationStream = null;
		var recitationSegmentTimer = null;
		var recitationAudioContext = null;
		var recitationSilenceFrame = null;
		var recitationLastSpeechAt = 0;
		var recitationSegmentHadSpeech = false;
		var recitationSessionStopping = false;
		var recitationProcessing = Promise.resolve();
		var recitationMimeType = '';
		var recitationStatus = page.querySelector('[data-quran-recitation-feedback]');
		var announceRecitation = function (message, type, showToast) {
			if (recitationStatus)
				recitationStatus.textContent = message;
			if (showToast !== false && window.toastr) {
				var toast = window.toastr[type] || window.toastr.info;
				toast.call(window.toastr, message, 'Recitation');
			}
		};
		var recitationWords = function () {
			return Array.from(page.querySelectorAll('.quran-corpus-word[data-quran-word]'));
		};
		var normalizeRecitationText = function (text) {
			return (text || '').toString().normalize('NFKD')
				.replace(/[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
				.replace(/[ٱأإآ]/g, 'ا')
				.replace(/ؤ/g, 'و')
				.replace(/[ئىي]/g, 'ي')
				.replace(/ة/g, 'ه')
				.replace(/ء/g, '')
				.replace(/[^\u0621-\u063A\u0641-\u064A\s]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		};
		var clearRecitationResult = function () {
			recitationWords().forEach(function (word) {
				word.classList.remove('quran-recitation-correct', 'quran-recitation-missed', 'quran-recitation-different');
			});
		};
		var alignRecitation = function (transcript) {
			var wordElements = recitationWords();
			var expected = wordElements.map(function (word) {
				return normalizeRecitationText(word.getAttribute('data-quran-word'));
			});
			var spoken = normalizeRecitationText(transcript).split(' ').filter(Boolean);
			if (!spoken.length)
				return { matched: 0, missed: 0, different: 0, extra: 0, spoken: 0 };
			var rows = expected.length + 1;
			var cols = spoken.length + 1;
			var costs = Array.from({ length: rows }, function () { return new Array(cols).fill(0); });
			var steps = Array.from({ length: rows }, function () { return new Array(cols).fill(null); });
			for (var j = 1; j < cols; j++) {
				costs[0][j] = j;
				steps[0][j] = 'insert';
			}
			for (var i = 1; i < rows; i++) {
				costs[i][0] = 0;
				steps[i][0] = 'start';
				for (var k = 1; k < cols; k++) {
					var same = expected[i - 1] === spoken[k - 1];
					var choices = [
						{ cost: costs[i - 1][k - 1] + (same ? 0 : 1), step: same ? 'match' : 'substitute' },
						{ cost: costs[i - 1][k] + 1, step: 'delete' },
						{ cost: costs[i][k - 1] + 1, step: 'insert' }
					].sort(function (a, b) { return a.cost - b.cost; });
					costs[i][k] = choices[0].cost;
					steps[i][k] = choices[0].step;
				}
			}
			var end = 0;
			for (var row = 1; row < rows; row++) {
				if (costs[row][spoken.length] < costs[end][spoken.length])
					end = row;
			}
			var operations = [];
			var traceI = end;
			var traceJ = spoken.length;
			while (traceJ > 0) {
				var step = steps[traceI][traceJ];
				if (step === 'match' || step === 'substitute') {
					operations.push({ type: step, expected: traceI - 1 });
					traceI -= 1;
					traceJ -= 1;
				} else if (step === 'delete') {
					operations.push({ type: step, expected: traceI - 1 });
					traceI -= 1;
				} else {
					operations.push({ type: 'insert' });
					traceJ -= 1;
				}
			}
			operations.reverse();
			var result = { matched: 0, missed: 0, different: 0, extra: 0, spoken: spoken.length };
			operations.forEach(function (operation) {
				if (operation.type === 'insert') {
					result.extra += 1;
					return;
				}
				var word = wordElements[operation.expected];
				if (!word) return;
				word.classList.remove('quran-recitation-correct', 'quran-recitation-missed', 'quran-recitation-different');
				if (operation.type === 'match') {
					word.classList.add('quran-recitation-correct', 'quran-memorize-word-revealed');
					result.matched += 1;
				} else if (operation.type === 'delete') {
					word.classList.add('quran-recitation-missed', 'quran-memorize-word-revealed');
					result.missed += 1;
				} else {
					word.classList.add('quran-recitation-different', 'quran-memorize-word-revealed');
					result.different += 1;
				}
			});
			return result;
		};
		var syncRecitationControls = function (recording) {
			page.querySelectorAll('[data-quran-recitation-toggle]').forEach(function (control) {
				control.classList.toggle('active', recording);
				control.setAttribute('aria-pressed', recording ? 'true' : 'false');
				control.setAttribute('aria-label', `${recording ? 'Stop' : 'Start checking'} recitation on page ${page.getAttribute('data-quran-mushaf-page') || ''}`.trim());
				control.setAttribute('title', recording ? 'Stop and check recitation' : 'Check recitation');
				var icon = control.querySelector('[data-quran-recitation-icon]');
				if (icon) {
					icon.classList.toggle('bi-mic', !recording);
					icon.classList.toggle('bi-record-circle-fill', recording);
				}
			});
		};
		var finishRecitationStream = function () {
			if (recitationSegmentTimer)
				window.clearTimeout(recitationSegmentTimer);
			recitationSegmentTimer = null;
			if (recitationSilenceFrame)
				window.cancelAnimationFrame(recitationSilenceFrame);
			recitationSilenceFrame = null;
			if (recitationAudioContext)
				recitationAudioContext.close().catch(function () {});
			recitationAudioContext = null;
			if (recitationStream)
				recitationStream.getTracks().forEach(function (track) { track.stop(); });
			recitationStream = null;
			recitationRecorder = null;
			recitationSessionStopping = false;
			syncRecitationControls(false);
		};
		var submitRecitation = async function (blob) {
			if (!blob || blob.size < 1000)
				throw new Error('No recitation was heard. Please try again.');
			var auth = window.hadithAuth;
			var token = auth && auth.getToken ? await auth.getToken() : null;
			if (!token && auth && auth.requireToken)
				token = await auth.requireToken('Please sign in to check your recitation.');
			if (!token)
				throw new Error('Please sign in to check your recitation.');
			var pageNumber = page.getAttribute('data-quran-mushaf-page');
			var response = await fetch(quranApiPath(`/memorization/pages/${encodeURIComponent(pageNumber)}/transcribe`), {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': blob.type || 'audio/webm'
				},
				body: blob
			});
			var data = await response.json().catch(function () { return {}; });
			if (!response.ok)
				throw new Error(data.error || 'Unable to check the recitation.');
			var result = alignRecitation(data.text);
			if (!result.spoken || !result.matched) {
				announceRecitation('I could not confidently find that recitation on this page. Please try a shorter passage.', 'warning', false);
				return;
			}
			var issues = result.missed + result.different + result.extra;
			announceRecitation(issues === 0
				? `${result.matched} words matched in order.`
				: `${result.matched} matched; ${result.missed} missed; ${result.different} different; ${result.extra} extra or repeated.`,
				issues === 0 ? 'success' : 'warning',
				false);
		};
		var enqueueRecitationSegment = function (blob) {
			recitationProcessing = recitationProcessing.then(function () {
				return submitRecitation(blob);
			}).catch(function (err) {
				announceRecitation(err.message, 'error');
			});
		};
		var beginRecitationSegment = function () {
			if (!recitationStream || recitationSessionStopping)
				return;
			var chunks = [];
			recitationSegmentHadSpeech = false;
			var recorder = recitationMimeType
				? new MediaRecorder(recitationStream, { mimeType: recitationMimeType })
				: new MediaRecorder(recitationStream);
			recitationRecorder = recorder;
			recorder.addEventListener('dataavailable', function (event) {
				if (event.data && event.data.size)
					chunks.push(event.data);
			});
			recorder.addEventListener('stop', function () {
				if (recitationSegmentTimer)
					window.clearTimeout(recitationSegmentTimer);
				recitationSegmentTimer = null;
				var blob = new Blob(chunks, { type: recorder.mimeType || recitationMimeType || 'audio/webm' });
				if (recitationSegmentHadSpeech && blob.size >= 1000)
					enqueueRecitationSegment(blob);
				if (recitationSessionStopping)
					finishRecitationStream();
				else
					beginRecitationSegment();
			}, { once: true });
			recorder.start(500);
			recitationSegmentTimer = window.setTimeout(function () {
				if (recorder.state === 'recording')
					recorder.stop();
			}, 12000);
		};
		var stopRecitationSession = function () {
			if (!recitationStream || recitationSessionStopping)
				return;
			recitationSessionStopping = true;
			if (recitationSegmentTimer)
				window.clearTimeout(recitationSegmentTimer);
			recitationSegmentTimer = null;
			if (recitationSilenceFrame)
				window.cancelAnimationFrame(recitationSilenceFrame);
			recitationSilenceFrame = null;
			if (recitationRecorder && recitationRecorder.state === 'recording')
				recitationRecorder.stop();
			else
				finishRecitationStream();
		};
		var monitorRecitationSilence = function () {
			if (!recitationAudioContext || !recitationStream)
				return;
			var analyser = recitationAudioContext.createAnalyser();
			analyser.fftSize = 2048;
			var source = recitationAudioContext.createMediaStreamSource(recitationStream);
			source.connect(analyser);
			var samples = new Uint8Array(analyser.fftSize);
			var inspectAudio = function () {
				if (!recitationStream || recitationSessionStopping)
					return;
				analyser.getByteTimeDomainData(samples);
				var energy = 0;
				for (var i = 0; i < samples.length; i++) {
					var amplitude = (samples[i] - 128) / 128;
					energy += amplitude * amplitude;
				}
				var rms = Math.sqrt(energy / samples.length);
				if (rms >= 0.015) {
					recitationLastSpeechAt = Date.now();
					recitationSegmentHadSpeech = true;
				} else if (Date.now() - recitationLastSpeechAt >= 10000) {
					stopRecitationSession();
					return;
				}
				recitationSilenceFrame = window.requestAnimationFrame(inspectAudio);
			};
			recitationSilenceFrame = window.requestAnimationFrame(inspectAudio);
		};
		var startRecitation = async function () {
			if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
				throw new Error('Audio recording is not supported by this browser.');
			clearRecitationResult();
			announceRecitation('Listening continuously… Recording will stop after 10 seconds of silence or when you press stop.', 'info');
			recitationStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			var preferredTypes = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
			recitationMimeType = preferredTypes.find(function (type) {
				return !window.MediaRecorder.isTypeSupported || window.MediaRecorder.isTypeSupported(type);
			}) || '';
			recitationSessionStopping = false;
			recitationProcessing = Promise.resolve();
			recitationLastSpeechAt = Date.now();
			var AudioContext = window.AudioContext || window.webkitAudioContext;
			if (AudioContext) {
				recitationAudioContext = new AudioContext();
				if (recitationAudioContext.state === 'suspended')
					await recitationAudioContext.resume();
				monitorRecitationSilence();
			}
			beginRecitationSegment();
			syncRecitationControls(true);
		};
		page.querySelectorAll('[data-quran-recitation-toggle]').forEach(function (control) {
			control.addEventListener('click', function (event) {
				event.preventDefault();
				event.stopPropagation();
				if (recitationStream) {
					stopRecitationSession();
					return;
				}
				startRecitation().catch(function (err) {
					finishRecitationStream();
					announceRecitation(err.message, 'error');
				});
			});
		});
		syncAutoHideControls(initialAutoHide);
		syncAllControls(false);
		page.addEventListener('click', function (event) {
			var autoHideToggle = event.target.closest('[data-quran-memorize-autohide-toggle]');
			if (autoHideToggle && page.contains(autoHideToggle)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				var autoHide = page.dataset.quranMemorizeAutoHide === 'false';
				page.dataset.quranMemorizeAutoHide = autoHide ? 'true' : 'false';
				syncAutoHideControls(autoHide);
				page.querySelectorAll('.quran-memorize-word-revealed').forEach(function (word) {
					var timer = wordTimers.get(word);
					if (timer)
						window.clearTimeout(timer);
					wordTimers.delete(word);
					if (autoHide)
						revealWord(word);
				});
				return;
			}
			var toggle = event.target.closest('[data-quran-memorize-all-toggle]');
			if (toggle && page.contains(toggle)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				page.querySelectorAll('.quran-corpus-word').forEach(function (word) {
					var timer = wordTimers.get(word);
					if (timer)
						window.clearTimeout(timer);
					wordTimers.delete(word);
					word.classList.remove('quran-memorize-word-revealed', 'quran-memorize-ayah-revealed');
				});
				var showAll = !page.classList.contains('quran-memorize-show-all');
				page.classList.toggle('quran-memorize-show-all', showAll);
				syncAllControls(showAll);
				return;
			}
			var ayahStep = event.target.closest('[data-quran-memorize-ayah-reveal], [data-quran-memorize-ayah-hide]');
			if (ayahStep && page.contains(ayahStep)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				var refs = Array.from(page.querySelectorAll('.quran-mushaf-ayah-marker[data-quran-ref]')).map(function (marker) {
					return marker.getAttribute('data-quran-ref');
				}).filter(Boolean);
				materializePageReveal();
				var revealOne = ayahStep.hasAttribute('data-quran-memorize-ayah-reveal');
				var stepRefs = revealOne ? refs : refs.slice().reverse();
				var stepRef = stepRefs.find(function (ayahRef) {
					var words = ayahWordsForRef(ayahRef);
					return words.length > 0 && (revealOne
						? !words.every(function (word) { return word.classList.contains('quran-memorize-ayah-revealed'); })
						: words.some(function (word) { return word.classList.contains('quran-memorize-ayah-revealed'); }));
				});
				if (stepRef)
					setAyahRevealed(stepRef, revealOne);
				return;
			}
			var marker = event.target.closest('.quran-mushaf-ayah-marker[data-quran-ref]');
			if (marker && page.contains(marker)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				materializePageReveal();
				var ref = marker.getAttribute('data-quran-ref');
				var targetRefs = [ref];
				if (event.altKey || event.metaKey || event.ctrlKey) {
					var previousRefs = [];
					page.querySelectorAll('.quran-corpus-word[data-quran-ref], .quran-mushaf-ayah-marker[data-quran-ref]').forEach(function (element) {
						if (element === marker)
							return;
						if (marker.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
							return;
						if (!element.classList.contains('quran-corpus-word') || element.closest('.quran-mushaf-line-basmallah'))
							return;
						var previousRef = element.getAttribute('data-quran-ref');
						if (previousRef && previousRef !== ref && previousRefs.indexOf(previousRef) < 0)
							previousRefs.push(previousRef);
					});
					targetRefs = previousRefs.concat(ref);
				}
				var ayahWords = Array.from(page.querySelectorAll('.quran-corpus-word[data-quran-ref]')).filter(function (word) {
					return targetRefs.indexOf(word.getAttribute('data-quran-ref')) >= 0
						&& !word.closest('.quran-mushaf-line-basmallah');
				});
				var hideAyah = ayahWords.length > 0 && ayahWords.every(function (word) {
					return word.classList.contains('quran-memorize-ayah-revealed');
				});
				if (hideAyah && page.dataset.quranReviewAnswerRevealed === '1')
					return;
				targetRefs.forEach(function (targetRef) { setAyahRevealed(targetRef, !hideAyah); });
				if (marker.hasAttribute('aria-expanded'))
					marker.setAttribute('aria-expanded', 'false');
				return;
			}
			var word = event.target.closest('.quran-corpus-word[data-quran-ref]');
			if (!word || !page.contains(word) || word.closest('.quran-mushaf-line-basmallah'))
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (isReviewWordVisible(word)) {
				hideQuranAudioTranslationMarquee();
				showQuranRevealedWordTranslation(word);
				return;
			}
			materializePageReveal();
			if (word.classList.contains('quran-memorize-word-revealed') || word.classList.contains('quran-memorize-ayah-revealed')) {
				if (page.dataset.quranReviewAnswerRevealed === '1')
					return;
				var wordTimer = wordTimers.get(word);
				if (wordTimer)
					window.clearTimeout(wordTimer);
				wordTimers.delete(word);
				word.classList.remove('quran-memorize-word-revealed', 'quran-memorize-ayah-revealed');
				hideQuranRevealedWordTranslation(word);
				return;
			}
			revealWord(word);
		});
		page.addEventListener('quranMemorizeRevealAyah', function (event) {
			var ref = event.detail && event.detail.ref || '';
			if (!ref) return;
			var revealed = !(event.detail && event.detail.revealed === false);
			if (!revealed && page.dataset.quranReviewAnswerRevealed === '1') return;
			if (!revealed) materializePageReveal();
			setAyahRevealed(ref, revealed);
		});
		page.addEventListener('keydown', function (event) {
			if (event.key !== 'Enter' && event.key !== ' ')
				return;
			var word = event.target.closest('.quran-corpus-word[data-quran-ref]');
			if (!word || !page.contains(word) || word.closest('.quran-mushaf-line-basmallah'))
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (isReviewWordVisible(word)) {
				hideQuranAudioTranslationMarquee();
				showQuranRevealedWordTranslation(word);
			} else if (!word.classList.contains('quran-memorize-ayah-revealed'))
				revealWord(word);
		});
	});
}

function initQuranAyahReview(root) {
	var scope = root || document;
	var ratings = scope.matches && scope.matches('[data-quran-ayah-review-rating]')
		? [scope]
		: Array.from(scope.querySelectorAll('[data-quran-ayah-review-rating]'));
	ratings.forEach(function (rating) {
		if (rating.dataset.quranAyahReviewBound === '1') return;
		rating.dataset.quranAyahReviewBound = '1';
		var ref = rating.getAttribute('data-quran-ref') || '';
		var reviewTargetRefs = new Set([ref]);
		var sessionId = '';
		var attemptToken = '';
		var reviewedRefs = new Set();
		var localReviewDayStart = window.HadithDbQuranReview.localDayStart();
		var presentedAt = Date.now();
		var help = rating.querySelector('.quran-ayah-review-help');
		var buttons = rating.querySelector('.quran-ayah-review-buttons');
		var revealControls = rating.querySelector('[data-quran-review-reveal-controls]');
		var gradeControls = rating.querySelector('[data-quran-review-grade-controls]');
		var undoButton = rating.querySelector('[data-quran-review-undo]');
		var undoAttemptToken = '';
		var undoInProgress = false;
		var status = rating.querySelector('[data-quran-review-status]');
		var sessionActions = rating.querySelector('.quran-review-session-actions');
		var footer = document.querySelector('.mobile-bottom-nav');
		var answerSnapshot = null;
		var revealReviewedAyah = function () {
			if (!reviewReader) return false;
			var words = Array.from(reviewReader.querySelectorAll('.quran-corpus-word[data-quran-ref]')).filter(function (word) {
				return reviewTargetRefs.has(word.getAttribute('data-quran-ref')) && !word.closest('.quran-mushaf-line-basmallah');
			});
			if (!words.length) return false;
			answerSnapshot = words.map(function (word) {
				return {
					word: word,
					ayahRevealed: word.classList.contains('quran-memorize-ayah-revealed'),
					wordRevealed: word.classList.contains('quran-memorize-word-revealed')
				};
			});
			words.forEach(function (word) {
				word.classList.add('quran-memorize-ayah-revealed');
			});
			page.dataset.quranReviewAnswerRevealed = '1';
			showQuranSelectionTranslationMarquee(ref);
			return true;
		};
		var restoreReviewedAyah = function () {
			if (!answerSnapshot) return;
			answerSnapshot.forEach(function (entry) {
				entry.word.classList.toggle('quran-memorize-ayah-revealed', entry.ayahRevealed);
				entry.word.classList.toggle('quran-memorize-word-revealed', entry.wordRevealed);
			});
			answerSnapshot = null;
			if (page) delete page.dataset.quranReviewAnswerRevealed;
			if (quranAudioTranslationMarqueeState.activeVerseKey === ref) hideQuranAudioTranslationMarquee();
		};
		var syncReviewControls = function (revealed) {
			if (revealControls) revealControls.hidden = revealed;
			if (gradeControls) gradeControls.hidden = !revealed;
		};
		var syncUndoReview = function (undoableReview) {
			undoAttemptToken = undoableReview && undoableReview.attempt_token || '';
			if (undoButton) undoButton.disabled = !undoAttemptToken;
		};
		var syncSessionProgress = function (session) {
			if (!session) return;
			var categories = {
				again: { label: 'Again', totals: ['again_queued'], backlog: true },
				learning: { label: 'Learning', completed: ['learning_completed'], totals: ['learning_queued'] },
				weak: { label: 'Hard', completed: ['relearning_completed', 'weak_completed'], totals: ['relearning_queued', 'weak_queued'] },
				review: { label: 'Good', completed: ['memorized_completed'], totals: ['memorized_queued'] },
				core: { label: 'Easy', completed: ['core_completed'], totals: ['core_queued'] },
				suspended: { label: 'Paused', completed: ['paused_completed'], totals: ['paused_queued'] }
			};
			var sessionCount = function (keys) {
				return keys.reduce(function (total, key) {
					return total + Math.max(0, Number(session[key]) || 0);
				}, 0);
			};
			document.querySelectorAll('[data-quran-review-session-total]').forEach(function (element) {
				element.textContent = `${Math.max(0, Number(session.completed) || 0).toLocaleString()}/${Math.max(0, Number(session.queued) || 0).toLocaleString()} āyāt`;
			});
				document.querySelectorAll('[data-quran-review-session-category]').forEach(function (pill) {
				var category = categories[pill.getAttribute('data-quran-review-session-category')];
				if (!category) return;
				var total = sessionCount(category.totals);
				pill.hidden = total < 1;
				var completed = category.backlog ? null : sessionCount(category.completed);
				pill.title = category.backlog
					? `${category.label}: ${total} queued`
					: `${category.label}: ${completed} of ${total} complete`;
				pill.setAttribute('aria-label', pill.title);
				var count = pill.querySelector('[data-quran-review-session-category-count]');
				if (count) count.textContent = category.backlog ? total.toLocaleString() : `${completed}/${total}`;
			});
		};
		var enableReviewButtons = function () {
			if (buttons) buttons.querySelectorAll('button').forEach(function (item) { item.disabled = false; });
			if (undoButton) undoButton.disabled = !undoAttemptToken;
		};
		syncReviewControls(false);
		syncUndoReview(null);
		var revealReviewContextAyahs = function () {
			if (!reviewReader) return;
			var targetParts = ref.split(':').map(Number);
			var isBeforeTarget = function (elementRef) {
				var elementParts = elementRef.split(':').map(Number);
				if (elementParts.length !== 2 || elementParts.some(Number.isNaN)) return false;
				return elementParts[0] < targetParts[0]
					|| (elementParts[0] === targetParts[0] && elementParts[1] < targetParts[1]);
			};
			reviewReader.querySelectorAll('.quran-corpus-word[data-quran-ref], .quran-ayah-end-marker[data-quran-ref]').forEach(function (element) {
				var elementRef = element.getAttribute('data-quran-ref');
				if (reviewTargetRefs.has(elementRef)
					|| (!isBeforeTarget(elementRef) && !reviewedRefs.has(elementRef))
					|| element.closest('.quran-mushaf-line-basmallah')) return;
				element.classList.add('quran-review-session-revealed');
				if (element.classList.contains('quran-corpus-word'))
					element.classList.add('quran-memorize-ayah-revealed');
			});
		};
		var syncReviewedAyahsFromSession = async function () {
			var auth = window.hadithAuth;
			var token = auth && auth.getToken ? await auth.getToken() : null;
			if (!token) return;
			var parts = ref.split(':');
			if (parts.length !== 2) return;
			var response = await fetch(quranApiPath(`/memorization/review/active/${parts[0]}/${parts[1]}/reviewed?day_start=${encodeURIComponent(localReviewDayStart)}`), {
				credentials: 'same-origin',
				headers: { 'Authorization': `Bearer ${token}` }
			});
			var data = await response.json().catch(function () { return {}; });
			if (!response.ok) throw new Error(data.error || 'Unable to restore the active review.');
			if (!data.session_id || !data.attempt_token)
				throw new Error('The active review attempt could not be restored.');
			sessionId = data.session_id;
			attemptToken = data.attempt_token;
			if (data.passage && Array.isArray(data.passage.refs) && data.passage.refs.length)
				reviewTargetRefs = new Set(data.passage.refs);
			if (reviewReader) reviewReader.querySelectorAll('[data-quran-ref]').forEach(function (element) {
				element.classList.toggle('quran-review-target-ayah', reviewTargetRefs.has(element.getAttribute('data-quran-ref')));
			});
			trackQuranAnalyticsEvent('quran_review_item_presented', {
				mushaf_page: Number(page && page.getAttribute('data-quran-mushaf-page')) || undefined,
				surah_number: Number(parts[0]), ayah_number: Number(parts[1])
			});
			syncUndoReview(data.undoable_review);
			syncSessionProgress(data.session_progress);
			if (!Array.isArray(data.reviewed_refs)) data.reviewed_refs = [];
			data.reviewed_refs.forEach(function (reviewedRef) {
				if (/^\d+:\d+$/.test(reviewedRef)) reviewedRefs.add(reviewedRef);
			});
			revealReviewContextAyahs();
			enableReviewButtons();
			if (sessionActions) sessionActions.querySelectorAll('button').forEach(function (item) { item.disabled = false; });
		};
		if (help && !help.id) help.id = `quran-ayah-review-help-${ref.replace(':', '-')}`;
		if (buttons && help) buttons.querySelectorAll('button').forEach(function (button) {
			button.setAttribute('aria-describedby', help.id);
		});
		if (footer && buttons) {
			footer.classList.add('mobile-bottom-nav-review-controls');
			footer.setAttribute('aria-label', `Recall result for Quran ${ref}`);
			footer.appendChild(buttons);
		}
		if (buttons) buttons.querySelectorAll('button').forEach(function (item) { item.disabled = true; });
		if (sessionActions) {
			sessionActions.addEventListener('click', async function (event) {
				var actionButton = event.target.closest('[data-quran-review-session-pause], [data-quran-review-session-end]');
				if (!actionButton || actionButton.disabled || !sessionId) return;
				event.preventDefault();
				var action = actionButton.hasAttribute('data-quran-review-session-pause') ? 'pause' : 'end';
				if (action === 'end' && !window.confirm('End this review session? Completed reviews will remain saved, but the remaining ayat will leave this session.')) return;
				sessionActions.querySelectorAll('button').forEach(function (item) { item.disabled = true; });
				if (buttons) buttons.querySelectorAll('button').forEach(function (item) { item.disabled = true; });
				if (status) status.textContent = action === 'pause' ? 'Pausing review session...' : 'Ending review session...';
				try {
					var auth = window.hadithAuth;
					var token = auth && auth.getToken ? await auth.getToken() : null;
					if (!token) throw new Error('Please sign in to manage this review session.');
					var response = await fetch(quranApiPath(`/memorization/review/sessions/${encodeURIComponent(sessionId)}/${action}`), {
						method: 'POST', credentials: 'same-origin', headers: { 'Authorization': `Bearer ${token}` }
					});
					var data = await response.json().catch(function () { return {}; });
					if (!response.ok) throw new Error(data.error || `Unable to ${action} this review session.`);
					window.navigateWithPageNotice(quranUrl('/quran/review'), action === 'pause'
						? { type:'info', title:'Review paused', message:'Resume it whenever you are ready.' }
						: { type:'info', title:'Review ended', message:'Completed reviews remain saved.' },
						action === 'pause' ? 'Pausing your review...' : 'Ending your review...');
				} catch (err) {
					if (status) status.textContent = err.message;
					if (window.toastr) window.toastr.error(err.message, 'Review session');
					sessionActions.querySelectorAll('button').forEach(function (item) { item.disabled = false; });
					enableReviewButtons();
				}
			});
		}
		var page = rating.closest('[data-quran-mushaf-page]');
		var reviewReader = rating.closest('[data-quran-mushaf-reader]') || page;
		if (page) {
			page.setAttribute('data-quran-review-ref', ref);
			page.querySelectorAll('[data-quran-ref]').forEach(function (element) {
				element.classList.toggle('quran-review-target-ayah', reviewTargetRefs.has(element.getAttribute('data-quran-ref')));
			});
			revealReviewContextAyahs();
			syncReviewedAyahsFromSession().catch(function (err) {
				if (status) status.textContent = err.message;
				if (window.toastr) window.toastr.error(err.message, 'Review unavailable');
			});
			window.requestAnimationFrame(function () {
				var target = Array.from(page.querySelectorAll('.quran-review-target-ayah')).find(function (element) {
					return element.classList.contains('quran-ayah-end-marker');
				}) || page.querySelector('.quran-review-target-ayah');
				if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
			});
		}
		if (!buttons) return;
		buttons.addEventListener('click', async function (event) {
			var undoControl = event.target.closest('[data-quran-review-undo]');
			if (undoControl && !undoControl.disabled && undoAttemptToken && sessionId) {
				event.preventDefault();
				undoInProgress = true;
				buttons.querySelectorAll('button').forEach(function (item) { item.disabled = true; });
				if (status) status.textContent = 'Undoing the last review grade...';
				try {
					var undoAuth = window.hadithAuth;
					var undoToken = undoAuth && undoAuth.getToken ? await undoAuth.getToken() : null;
					if (!undoToken) throw new Error('Please sign in to undo this review grade.');
					var undoResponse = await fetch(quranApiPath(`/memorization/review/sessions/${encodeURIComponent(sessionId)}/undo`), {
						method: 'POST', credentials: 'same-origin',
						headers: { 'Authorization': `Bearer ${undoToken}`, 'Content-Type': 'application/json' },
						body: JSON.stringify({ attempt_token: undoAttemptToken })
					});
					var undoData = await undoResponse.json().catch(function () { return {}; });
					if (!undoResponse.ok) throw new Error(undoData.error || 'Unable to undo this review grade.');
					var undoAyah = undoData.ayah || {};
					var undoRef = `${undoData.surah_number}:${undoData.ayah_number}`;
					reviewedRefs.delete(undoRef);
					syncUndoReview(null);
					window.navigateWithPageLoading(quranUrl(`/quran/page/${undoAyah.page_number || 1}?review=${undoRef}`), 'Loading the previous āyah...');
				} catch (err) {
					undoInProgress = false;
					if (status) status.textContent = err.message;
					if (window.toastr) window.toastr.error(err.message || 'Unable to undo this review grade.', 'Review not changed');
					enableReviewButtons();
				}
				return;
			}
			var revealButton = event.target.closest('[data-quran-review-reveal]');
			if (revealButton && !revealButton.disabled) {
				event.preventDefault();
				if (reviewReader && reviewReader.quranMushafReviewPagesReady) {
					if (status) status.textContent = 'Loading the complete passage…';
					await reviewReader.quranMushafReviewPagesReady;
				}
				if (!revealReviewedAyah()) {
					if (status) status.textContent = 'Unable to reveal this āyah.';
					return;
				}
				syncReviewControls(true);
				if (status) status.textContent = reviewTargetRefs.size > 1 ? 'Passage revealed. Grade your recall.' : 'Āyah revealed. Grade your recall.';
				var firstGrade = gradeControls && gradeControls.querySelector('[data-quran-review-grade]');
				if (firstGrade) firstGrade.focus();
				return;
			}
			var button = event.target.closest('[data-quran-review-grade]');
			if (!button || button.disabled) return;
			event.preventDefault();
			var grade = button.getAttribute('data-quran-review-grade');
			if (grade !== 'skip' && (!page || page.dataset.quranReviewAnswerRevealed !== '1')) {
				if (status) status.textContent = 'Reveal the āyah before grading.';
				return;
			}
			buttons.querySelectorAll('button').forEach(function (item) { item.disabled = true; });
			if (status) status.textContent = grade === 'skip' ? 'Skipping...' : 'Saving review...';
			try {
				var auth = window.hadithAuth;
				var token = auth && auth.getToken ? await auth.getToken() : null;
				if (!token && auth && auth.requireToken)
					token = await auth.requireToken('Please sign in to continue this review.');
				if (!token) throw new Error('Please sign in to continue this review.');
				var parts = ref.split(':');
				var response = await fetch(quranApiPath(`/memorization/ayahs/${parts[0]}/${parts[1]}/reviews`), {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
					body: JSON.stringify(window.HadithDbQuranReview.gradeRequestBody({
						grade: grade,
						sessionId: sessionId,
						attemptToken: attemptToken,
						dayStart: localReviewDayStart,
						durationSeconds: (Date.now() - presentedAt) / 1000
					}))
				});
				var data = await response.json().catch(function () { return {}; });
				if (!response.ok) throw new Error(data.error || 'Unable to save this review.');
				trackQuranAnalyticsEvent('quran_review_grade', {
					mushaf_page: Number(page && page.getAttribute('data-quran-mushaf-page')) || undefined,
					surah_number: Number(parts[0]), ayah_number: Number(parts[1]), review_grade: grade
				});
				if (data.undoable_review) syncUndoReview(data.undoable_review);
				// Resolve the next persisted queue item while the graded āyah remains
				// visible. This removes the intermediate /quran/review redirect and
				// hides most of the next-card lookup behind the required reveal delay.
				if (grade !== 'skip') reviewedRefs.add(ref);
				window.showQuranReviewLoading('Loading your next ayah...');
				if (undoInProgress) return;
				try {
					if (!data.next_review) throw new Error(data.next_review_error || 'Unable to load the next review.');
					var nextData = data.next_review;
					if (nextData.complete || !nextData.ayah) {
						window.navigateWithPageNotice(quranUrl('/quran/review'),
							{ type:'success', title:'Review complete', message:'You completed this review session.', scrollToTop:true },
							'Finishing your review...');
						return;
					}
					var nextAyah = nextData.ayah;
					var nextQuery = [`review=${nextAyah.surah_number}:${nextAyah.ayah_number}`];
					if (nextData.passage && Array.isArray(nextData.passage.ayahs)) {
						var passageEndPage = Math.max.apply(null, nextData.passage.ayahs.map(function (item) { return Number(item.page_number) || 0; }));
						if (passageEndPage > Number(nextAyah.page_number || 1)) nextQuery.push(`reviewPassageEndPage=${passageEndPage}`);
					}
					if (nextAyah.retry) nextQuery.push('reviewRetry=1');
					window.navigateWithQuranReviewLoading(quranUrl(`/quran/page/${nextAyah.page_number || 1}?${nextQuery.join('&')}`), 'Loading your next ayah...');
				} catch (_nextErr) {
					// The grade is already saved. Fall back to the existing recovery
					// loader, which can resume the current persisted queue safely.
					window.navigateWithQuranReviewLoading(quranUrl('/quran/review?continue=1'), 'Loading your next ayah...');
				}
			} catch (err) {
				restoreReviewedAyah();
				syncReviewControls(false);
				if (status) status.textContent = err.message;
				if (window.toastr) window.toastr.error(err.message || 'Unable to save this review.', 'Review not saved');
				enableReviewButtons();
			}
		});
	});
}

function initPageHelpTips(root) {
	var scope = root || document;
	var owner = scope.matches && scope.matches('[data-page-help-tour]')
		? scope
		: scope.querySelector('[data-page-help-tour]');
	if (!owner || owner.dataset.pageHelpTipsBound === '1') return;
	owner.dataset.pageHelpTipsBound = '1';
	var mode = owner.getAttribute('data-page-help-tour') || '';
	var labels = { mushaf: 'Mushaf', memorize: 'Memorize', review: 'Review', progress: 'Review summary', study: 'Study', tafsir: 'Tafsir' };
	if (!labels[mode]) return;
	var sessionStorageKey = `hadithdb.pageHelpTour.session.${mode}`;
	var permanentStorageKey = `hadithdb.pageHelpTour.permanent.${mode}`;
	var stepsByMode = {
		mushaf: [
		{
			title: 'Move around the Mushaf',
			copy: 'Use the **surah name** to open the surah list, or enter a surah number from 1 through 114. The Juz number beside it can also take you directly to another Juz.',
			selector: '.quran-mushaf-page-heading .quran-mushaf-page-meta'
		},
		{
			title: 'Change the Mushaf page',
			copy: 'Select the **page number** and enter a Mushaf page to jump directly to it. The page address updates as you read.',
			selector: '.quran-mushaf-page-heading .quran-mushaf-page-number'
		},
		{
			title: 'Bookmark this Mushaf page',
			copy: 'Choose the **bookmark** in the page toolbar to save this Mushaf page. A filled bookmark shows that the page is saved; choose it again to remove the bookmark.',
			selector: '.quran-mushaf-page-toolbar [data-quran-mushaf-bookmark-page]'
		},
		{
			title: 'Return to your bookmarked page',
			copy: 'Choose the **bookmark icon** in the top menu to open My Bookmarks. Your saved Mushaf page appears there so you can return to it directly.',
			selector: '.top-nav-icon-link[aria-label="Bookmarks"], .offcanvas-quick-action[aria-label="My Bookmarks"]'
		},
		{
			title: 'Play the page',
			copy: 'Choose **Play** to hear the āyāt on this page. Use **Stop** to end playback or **Repeat** to keep practicing the page or its passage ranges.',
			selector: '.quran-mushaf-page-toolbar [data-quran-passage-audio="1"]'
		},
		{
			title: 'Follow the translation marquee',
			copy: 'Choose the **translation** used during playback. When audio starts, its translation marquee appears above the sticky footer and follows the current āyah.',
			selector: '.quran-mushaf-page-toolbar .quran-audio-translation-toggle'
		},
		{
			title: 'Choose a reciter',
			copy: 'Use the **headphones** to choose the reciter you want to hear before you play the page.',
			selector: '.quran-mushaf-page-toolbar .quran-passage-reciter-toggle[aria-label^="Choose reciter"]'
		},
		{
			title: 'Read and study an āyah',
			copy: 'Read down the Arabic Mushaf page. Open the **chevron** beside any āyah marker, then choose **Play** to hear that āyah or **Study** to open its translation, tafsir, and other study tools.',
			selector: '.quran-mushaf-line:not(.quran-mushaf-line-basmallah) .quran-mushaf-ayah-actions-toggle'
		},
		{
			title: 'Use the headings below each page',
			copy: 'The bottom of every Mushaf page shows its **section** and **subsection** headings. Choose a heading to open that complete passage in Study view.',
			selector: '.quran-mushaf-page-footer .quran-mushaf-page-passage'
		},
		{
			title: 'Keep reading as you scroll',
			copy: '**Scroll** beyond the bottom of the page and the next Mushaf page loads automatically. Its page number, section headings, and address follow you as you continue.',
			selector: '[data-quran-mushaf-sentinel]'
		}
	],
		review: [
		{
			title: 'Recite before looking',
			copy: 'The current āyah is hidden. Recite it from memory before revealing the answer.',
			selector: '.quran-mushaf-sheet'
		},
		{
			title: 'Reveal, then grade your recall',
			copy: 'Select **Reveal** only after your attempt. Choose **Again** if you needed help, **Hard** for significant hesitation, **Good** for ordinary effort, or **Easy** for fluent recall. **Skip** changes neither the learning stage nor the schedule.',
			selector: '.quran-ayah-review-buttons'
		},
		{
			title: 'Let grades manage the stage',
			copy: 'Your initial self-assessment was the only manual stage choice. In Review, one **Easy** or two consecutive **Good** reviews move Learning or Hard to Good. **Again** on a Good āyah begins Hard recovery until you recall it successfully.',
			selector: '.mobile-bottom-nav-review-controls .quran-memorize-rating-buttons, .quran-ayah-review-buttons'
		},
		{
			title: 'Follow the adaptive schedule',
			copy: 'Each grade updates the āyah\'s next review from its recall history and loads the next Learning or due āyah. **Undo** restores the most recent grade, learning stage, and review date if you tapped the wrong one.',
			selector: '.mobile-bottom-nav-review-controls .quran-memorize-rating-buttons, .quran-ayah-review-buttons'
		},
		{
			title: 'Pause or end when you need to',
			copy: '**Pause** keeps the remaining āyāt ready for you to resume later. **End** closes the session and removes its remaining queue; every completed review stays saved.',
			selector: '.quran-review-session-actions'
		}
	],
	progress: [
		{
			title: 'See your review activity',
			copy: 'Your activity history shows how consistently you are reviewing and how your practice is building over time.',
			selector: '.quran-review-activity'
		},
		{
			title: 'Understand what needs attention',
			copy: 'Use the summary cards to see what is due now and how many āyāt are Learning, Hard, Good, Easy, Paused, or Later.',
			selector: '.quran-memorization-summary'
		},
		{
			title: 'Find your memorization progress',
			copy: 'Filter by page, Juz, surah, state, or Arabic text to quickly find the āyāt you want to check.',
			selector: '.memorization-progress-filter'
		},
		{
			title: 'Begin your hifz journey',
			copy: 'Select **Get Started** to choose the surah you want to memorize.',
			selector: '#quran-memorization-progress [data-bs-target="#quran-get-started-modal"]',
			action: 'click-target',
			actionLabel: 'Get started'
		}
	],
	memorize: [
		{
			title: 'Practice with hidden text',
			copy: 'Select a hidden word to reveal it. Use the **eye** to show the whole page, the **clock** to hide clicked words again, and minus or plus to hide or reveal one complete āyah at a time.',
			selector: '.quran-mushaf-page-toolbar .quran-memorize-controls'
		},
		{
			title: 'Begin your hifz journey',
			copy: 'For an āyah you have not started, open its chevron and honestly assess your current recall: **Learn**, **Hard**, **Good**, or **Easy**. This one-time self-assessment tells the app where your hifz journey should begin. The same menu can **Play**, **Reveal**, or **Hide** the āyah while you practice.',
			selector: '[data-quran-ayah-state-menu]',
			requiresMemorizationMenu: 'ayah',
			requiresMemorizationState: 'later'
		},
		{
			title: 'Assess a complete surah',
			copy: 'When you have not started any āyah in a surah, use the surah dropdown to give the complete surah one starting assessment. Choose **Learn**, **Hard**, **Good**, or **Easy**, then work through its āyāt.',
			selector: '[data-quran-surah-state-menu]',
			requiresMemorizationMenu: 'surah',
			requiresMemorizationState: 'later'
		},
		{
			title: 'Let Review manage progress',
			copy: 'Your self-assessment is the only time you choose a starting stage. After enrollment, Review updates Learning, Hard, and Good from your grades. You can still choose **Easy**, **Pause learning**, or **Learn later** when needed.',
			selector: '[data-quran-ayah-state-menu]',
			requiresMemorizationMenu: 'ayah',
			requiresMemorizationState: 'enrolled'
		},
		{
			title: 'Pause learning or learn later',
			copy: 'After enrollment, choose **Pause learning** to stop reviews temporarily without losing history, or **Learn later** to remove the āyah from the current plan. Choose **Easy** when it no longer needs scheduled Review.',
			selector: '[data-quran-ayah-state-menu]',
			requiresMemorizationMenu: 'ayah',
			requiresMemorizationState: 'enrolled'
		},
		{
			title: 'Build recall one word at a time',
			copy: 'Try to recite first, then select only the word you need. Repeat until you can reveal less and recite the complete āyah without help.',
			selector: '.quran-mushaf-line:not(.quran-mushaf-line-basmallah) .quran-corpus-word'
		},
		{
			title: 'Test your learning in Review',
			copy: 'When you are ready to test yourself, select **Review** and choose this page or a surah. The Review guide will show you how to reveal, grade, pause, and finish a session.',
			selector: '.quran-memorize-launch-actions [data-quran-memorize-review-page]'
		}
	],
	study: [
		{
			title: 'Start with an āyah',
			copy: 'In the Arabic passage, open the chevron beside an āyah marker. Choose **Study** to open that āyah in the hero, or **Play** to hear it without leaving the passage.',
			selector: '.quran-passage-section .h[lang="ar"] .quran-mushaf-ayah-actions-toggle:not([data-quran-ref$=":0"])'
		},
		{
			title: 'Study from the āyah hero',
			copy: 'The hero keeps the Arabic āyah and its translation together. You can return to the full passage with the **close** button.',
			selector: '.quran-selected-ayah-hero .quran-ayah-hero',
			requiresHero: true
		},
		{
			title: 'Explore the āyah hero',
			copy: 'The action links beneath the hero let you **Play** the āyah, open **Tafsir** or **Translations**, and **Share** it.',
			selector: '.quran-selected-ayah-hero .quran-ayah-hero-toolbar',
			requiresHero: true
		},
		{
			title: 'Play and control the audio',
			copy: 'Choose **Play** beneath the hero to hear this āyah. While it plays, the sticky footer becomes audio controls for previous, repeat, pause or play, stop, speed, and next.',
			selector: '.quran-selected-ayah-hero .quran-ayah-hero-toolbar',
			requiresHero: true
		},
		{
			title: 'Move to the next āyah',
			copy: 'Use the **left** and **right chevrons** around the hero, or press the **Left Arrow** and **Right Arrow** keys. The same shortcuts move through āyāt while the Tafsir or Translations viewer is open.',
			selector: '.quran-selected-ayah-hero .quran-ayah-hero-nav',
			requiresHero: true
		},
		{
			title: 'Share an āyah',
			copy: 'Choose **Share** beneath the hero. In the sharing screen, use **Share image** to send the āyah to social media or another app, or **Copy image** to paste it yourself.',
			selector: '.quran-selected-ayah-hero [aria-label="Share selected ayah image"]',
			requiresHero: true
		},
		{
			title: 'Open tafsir from the hero',
			copy: 'Choose **Tafsir** beneath the hero to open commentary for the selected āyah.',
			selector: '.quran-selected-ayah-hero [data-quran-ayah-modal-type="tafsirs"]',
			requiresHero: true
		},
		{
			title: 'Switch tafsir language',
			copy: 'After opening **Tafsir** from the hero, choose **Arabic** or **English** above the tafsir list. Your most recent language and tafsir stay selected during this browser session.',
			selector: '.quran-ayah-modal.show .quran-tafsir-language-toggle, .quran-tafsir-language-toggle',
			requiresHero: true,
			requiresModal: 'tafsirs'
		},
		{
			title: 'Open the detailed tafsir page',
			copy: 'The tafsir carousel changes which commentary is selected. Use the **expand icon** in the top toolbar to open that selected tafsir\'s detailed reading page.',
			selector: '.quran-ayah-modal.show[data-quran-ayah-modal-type="tafsirs"] .quran-ayah-modal-tafsir-expand',
			requiresHero: true,
			requiresModal: 'tafsirs'
		},
		{
			title: 'Compare translations',
			copy: 'Use the **Translations** viewer to compare the selected āyah across the translations you have enabled.',
			selector: '.quran-ayah-modal.show[data-quran-ayah-modal-type="translations"] .quran-translation-list',
			requiresHero: true,
			requiresModal: 'translations'
		},
		{
			title: 'Read or add reflections',
			copy: 'The **reflections** action opens the community discussion for this āyah. Read existing reflections, reply, or add your own from the reflection box.',
			selector: '.quran-ayah-modal.show[data-quran-ayah-modal-type="reflections"] .comment-feed',
			requiresHero: true,
			requiresModal: 'reflections'
		},
		{
			title: 'Choose a reciter',
			copy: 'Use the **headphones** beside the passage audio controls to choose a reciter before you press Play.',
			selector: '.quran-passage-reciter-toggle[aria-label^="Choose reciter"]',
			requiresHero: true
		},
		{
			title: 'Change the translation',
			copy: 'Use the **translation menu** in the passage toolbar to choose which translation appears beside the Arabic.',
			selector: '.quran-dynamic-translation-toggle',
			requiresHero: true
		},
		{
			title: 'Share multiple āyāt',
			copy: 'Choose **Select ayat**, then select the āyāt you want from the passage. Choose **View selected**, followed by **Share**, to create one image for the selected range and send it to social media.',
			selector: '.quran-ayah-select-toolbar',
			requiresPassage: true
		},
		{
			title: 'Change script or reading mode',
			copy: 'Use **Script** to choose **Uthmani**, **Indo-Pak**, or **Warsh**. Switch between **Study**, **Mushaf**, **Memorize**, and **Review** from the same reading-mode bar.',
			selector: '.quran-reader-modes'
		},
		{
			title: 'Keep reading with infinite scroll',
			copy: '**Scroll** past the end of the passage and the next Quran passage loads automatically. The page address and **Previous** and **Next** controls update as you continue.',
			selector: '[data-quran-infinite-page="1"], .quran-infinite-status'
		}
	],
	tafsir: [
		{
			title: 'Read the dedicated tafsir',
			copy: 'This page keeps one Quran passage and its selected tafsir in a focused reading view. The highlighted commentary loads below the heading.',
			selector: '.tafsir-only-page .quran-tafsirs'
		},
		{
			title: 'Choose Arabic or English',
			copy: 'Use the **Arabic** and **English** buttons to switch the tafsir catalog. The page remembers your latest language for this browser session.',
			selector: '.tafsir-only-page .quran-tafsir-language-toggle'
		},
		{
			title: 'Switch tafsir books',
			copy: 'Use the horizontal tafsir list to choose another commentary. **Swipe** the list on a phone when more tafsirs are available off screen.',
			selector: '.tafsir-only-page .quran-tafsir-tabs'
		},
		{
			title: 'Compare translations',
			copy: 'Select **Translations** in the tafsir heading to read the same passage across available Quran translations.',
			selector: '.tafsir-only-page .quran-section-heading-action[aria-label="Open translations page"], .tafsir-only-page .quran-section-heading-action[aria-label="View translations"]'
		},
		{
			title: 'Continue reading',
			copy: 'Use **Prev** and **Next** in the sticky footer, or press the **Left Arrow** and **Right Arrow** keys, to move through detailed tafsir passages.',
			selector: '.mobile-bottom-nav [data-mobile-bottom-nav-prev], .mobile-bottom-nav [data-mobile-bottom-nav-next]'
		}
	]
	};
	var steps = stepsByMode[mode];
	var tour = null;
	var currentStep = 0;
	var previousFocus = null;
	var activeTarget = null;
	var resizeFrame = 0;
	var sessionStorage = function () {
		try { return window.sessionStorage || null; }
		catch (_err) { return null; }
	};
	var permanentStorage = function () {
		try { return window.localStorage || null; }
		catch (_err) { return null; }
	};
	var wasDismissedLocally = function () {
		var session = sessionStorage();
		var permanent = permanentStorage();
		try { return Boolean(session && session.getItem(sessionStorageKey) || permanent && permanent.getItem(permanentStorageKey)); }
		catch (_err) { return false; }
	};
	var wasPermanentlyDismissedLocally = function () {
		var permanent = permanentStorage();
		try { return Boolean(permanent && permanent.getItem(permanentStorageKey)); }
		catch (_err) { return false; }
	};
	var waitForAuth = function () {
		return new Promise(function (resolve) {
			if (window.hadithAuth && window.hadithAuth.getUser) {
				resolve(window.hadithAuth);
				return;
			}
			var attempts = 0;
			var timer = window.setInterval(function () {
				attempts += 1;
				if (window.hadithAuth && window.hadithAuth.getUser) {
					window.clearInterval(timer);
					resolve(window.hadithAuth);
				} else if (attempts >= 50) {
					window.clearInterval(timer);
					resolve(null);
				}
			}, 100);
		});
	};
	var loadUserSettings = function (fresh) {
		return waitForAuth().then(function (auth) {
			return Promise.resolve(auth && auth.getUser ? auth.getUser() : null).then(function (user) {
				if (!user) return { auth: auth, user: null, settings: null };
				var cached = !fresh && window.hadithUserSettingsCache && window.hadithUserSettingsCache.read
					? window.hadithUserSettingsCache.read(user)
					: null;
				if (cached) return { auth: auth, user: user, settings: cached };
				return Promise.resolve(auth.getToken ? auth.getToken() : null).then(function (token) {
					return fetch(quranApiPath('/user-settings?optional=1'), {
						credentials: 'same-origin',
						cache: 'no-store',
						headers: token ? { 'Authorization': `Bearer ${token}` } : {}
					}).then(function (response) {
						if (!response.ok) throw new Error('Unable to load tour preferences.');
						return response.json();
					}).then(function (data) {
						var settings = data && data.settings || {};
						updateCachedQuranUserSettings(user, settings);
						return { auth: auth, user: user, token: token, settings: settings };
					});
				});
			});
		});
	};
	var wasDismissedForUser = function () {
		return loadUserSettings(true).then(function (context) {
			var quran = context.settings && context.settings.quran;
			return Boolean(quran && Array.isArray(quran.dismissedHelpTours) && quran.dismissedHelpTours.indexOf(mode) >= 0);
		}).catch(function () { return false; });
	};
	var savePermanentDismissal = function () {
		return loadUserSettings(true).then(function (context) {
			if (!context.user || !context.settings) return;
			var quran = context.settings.quran && typeof context.settings.quran === 'object'
				? context.settings.quran
				: {};
			var existingDismissed = Array.isArray(quran.dismissedHelpTours) ? quran.dismissedHelpTours : [];
			if (existingDismissed.indexOf(mode) >= 0) return;
			var dismissed = Array.from(new Set(existingDismissed.concat(mode)));
			var nextSettings = Object.assign({}, context.settings, {
				quran: Object.assign({}, quran, { dismissedHelpTours: dismissed })
			});
			return Promise.resolve(context.token || (context.auth && context.auth.getToken ? context.auth.getToken() : null)).then(function (token) {
				return fetch(quranApiPath('/user-settings'), {
					method: 'PUT',
					credentials: 'same-origin',
					headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {}),
					body: JSON.stringify({ settings: nextSettings })
				}).then(function (response) {
					if (!response.ok) throw new Error('Unable to save tour preference.');
					return response.json();
				}).then(function (data) {
					updateCachedQuranUserSettings(context.user, data.settings || nextSettings);
				});
			});
		});
	};
	var rememberDismissal = function (dismissal) {
		var storage = dismissal === 'permanent' ? permanentStorage() : sessionStorage();
		var key = dismissal === 'permanent' ? permanentStorageKey : sessionStorageKey;
		try { if (storage) storage.setItem(key, '1'); }
		catch (_err) {}
		if (dismissal === 'permanent') {
			savePermanentDismissal().catch(function (err) {
				if (window.toastr) window.toastr.error(err.message || 'Unable to save tour preference.', 'Preference not saved');
			});
		}
	};
	var visibleTarget = function (selector) {
		return Array.from(document.querySelectorAll(selector || '')).find(function (candidate) {
			var rect = candidate.getBoundingClientRect();
			var style = window.getComputedStyle(candidate);
			return !candidate.hidden && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
		}) || null;
	};
	var positionTour = function () {
		if (!tour) return;
		var card = tour.querySelector('[data-quran-help-tips-card]');
		var spotlight = tour.querySelector('[data-quran-help-tips-spotlight]');
		if (!card || !spotlight) return;
		activeTarget = visibleTarget(steps[currentStep].selector);
		spotlight.classList.toggle('is-centered', !activeTarget);
		if (!activeTarget) {
			spotlight.removeAttribute('style');
			card.style.left = `${Math.max(12, Math.round((window.innerWidth - card.offsetWidth) / 2))}px`;
			card.style.top = `${Math.max(12, Math.round((window.innerHeight - card.offsetHeight) / 2))}px`;
			return;
		}
		var rect = activeTarget.getBoundingClientRect();
		var padding = 7;
		spotlight.style.left = `${Math.max(4, Math.round(rect.left - padding))}px`;
		spotlight.style.top = `${Math.max(4, Math.round(rect.top - padding))}px`;
		spotlight.style.width = `${Math.min(window.innerWidth - 8, Math.round(rect.width + padding * 2))}px`;
		spotlight.style.height = `${Math.min(window.innerHeight - 8, Math.round(rect.height + padding * 2))}px`;
		if (window.matchMedia('(max-width: 575.98px)').matches) {
			card.removeAttribute('style');
			return;
		}
		var gap = 14;
		var left = rect.left + (rect.width - card.offsetWidth) / 2;
		left = Math.max(12, Math.min(left, window.innerWidth - card.offsetWidth - 12));
		var below = rect.bottom + gap;
		var top = below + card.offsetHeight <= window.innerHeight - 12
			? below
			: Math.max(12, rect.top - card.offsetHeight - gap);
		card.style.left = `${Math.round(left)}px`;
		card.style.top = `${Math.round(top)}px`;
	};
	var schedulePosition = function () {
		window.cancelAnimationFrame(resizeFrame);
		resizeFrame = window.requestAnimationFrame(positionTour);
	};
	var renderCopy = function (element, value) {
		element.replaceChildren();
		String(value || '').split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
			if (part.slice(0, 2) === '**' && part.slice(-2) === '**') {
				var strong = document.createElement('strong');
				strong.textContent = part.slice(2, -2);
				element.appendChild(strong);
			} else if (part) {
				element.appendChild(document.createTextNode(part));
			}
		});
	};
	var waitForCondition = function (condition, timeout) {
		var startedAt = Date.now();
		return new Promise(function (resolve) {
			var check = function () {
				if (condition() || Date.now() - startedAt >= (timeout || 1200)) {
					resolve();
					return;
				}
				window.setTimeout(check, 40);
			};
			check();
		});
	};
	var ensureStudyHero = function () {
		if (visibleTarget('.quran-selected-ayah-hero .quran-ayah-hero'))
			return Promise.resolve();
		var trigger = visibleTarget('.quran-passage-section .h[lang="ar"] .body.passage .quran-ayah-hero-trigger[data-quran-href]:not([data-quran-ref$=":0"])');
		if (!trigger)
			return Promise.resolve();
		var detail = { trigger: trigger, promise: null };
		document.dispatchEvent(new CustomEvent('quran:help-tour-open-hero', { detail: detail }));
		return detail.promise || Promise.resolve();
	};
	var closeStudyModal = function () {
		var modal = document.querySelector('.quran-ayah-modal.show');
		if (!modal)
			return Promise.resolve();
		var close = modal.querySelector('[data-bs-dismiss="modal"]');
		if (close)
			close.click();
		return waitForCondition(function () {
			return !modal.classList.contains('show') && window.getComputedStyle(modal).display === 'none';
		}, 1800).then(closeStudyModal);
	};
	var openStudyModal = function (type, selector) {
		if (visibleTarget(selector))
			return Promise.resolve();
		return ensureStudyHero().then(function () {
			var openTarget = function () {
				var trigger = visibleTarget(`.quran-selected-ayah-hero [data-quran-ayah-modal-type="${type}"]`);
				if (trigger)
					trigger.click();
				return waitForCondition(function () { return Boolean(visibleTarget(selector)); });
			};
			var shownModal = visibleTarget('.quran-ayah-modal.show');
			if (!shownModal)
				return openTarget();
			if (shownModal.getAttribute('data-quran-ayah-modal-type') === type)
				return waitForCondition(function () { return Boolean(visibleTarget(selector)); });
			var switcher = visibleTarget(`.quran-ayah-modal.show [data-quran-ayah-modal-switch="${type}"]`);
			if (switcher) {
				switcher.click();
				return waitForCondition(function () { return Boolean(visibleTarget(selector)); });
			}
			return closeStudyModal().then(openTarget);
		});
	};
	var closeMemorizationMenus = function () {
		document.querySelectorAll('[data-quran-ayah-state-toggle][aria-expanded="true"], [data-quran-surah-state][aria-expanded="true"], [data-quran-page-state][aria-expanded="true"]').forEach(function (trigger) {
			trigger.click();
		});
		document.querySelectorAll('[data-quran-help-tour-assessment-preview]').forEach(function (menu) {
			menu.removeAttribute('data-quran-help-tour-assessment-preview');
		});
		document.querySelectorAll('[data-quran-help-tour-temporary-trigger]').forEach(function (trigger) {
			if (!trigger.hasAttribute('data-current-state')) trigger.hidden = true;
			trigger.removeAttribute('data-quran-help-tour-temporary-trigger');
		});
	};
	var openMemorizationMenu = function (type, requiredState) {
		var menuSelectors = {
			ayah: '[data-quran-ayah-state-menu]',
			surah: '[data-quran-surah-state-menu]'
		};
		var triggerSelectors = {
			ayah: '[data-quran-memorize-page] [data-quran-ayah-state-toggle]',
			surah: '[data-quran-memorize-page] [data-quran-surah-state]'
		};
		var menuSelector = menuSelectors[type];
		var baseTriggerSelector = triggerSelectors[type];
		var triggerSelector = baseTriggerSelector;
		if (requiredState === 'later') {
			triggerSelector = type === 'ayah'
				? '[data-quran-memorize-page] .quran-ayah-state-control[data-current-state="later"] [data-quran-ayah-state-toggle]'
				: '[data-quran-memorize-page] [data-quran-surah-state][data-current-state="later"]';
		} else if (requiredState === 'enrolled') {
			triggerSelector = type === 'ayah'
				? '[data-quran-memorize-page] .quran-ayah-state-control:not([data-current-state="later"]):not([data-current-state=""]) [data-quran-ayah-state-toggle]'
				: '[data-quran-memorize-page] [data-quran-surah-state]:not([data-current-state="later"]):not([data-current-state=""])';
		}
		if (!menuSelector || !triggerSelector)
			return Promise.resolve();
		return waitForCondition(function () {
			return Boolean(visibleTarget(triggerSelector) || visibleTarget(baseTriggerSelector)
				|| type === 'surah' && document.querySelector(baseTriggerSelector));
		}, 1200).then(function () {
			closeMemorizationMenus();
			var trigger = visibleTarget(triggerSelector);
			var assessmentPreview = requiredState === 'later' && !trigger;
			if (!trigger && assessmentPreview) trigger = visibleTarget(baseTriggerSelector);
			if (!trigger && assessmentPreview && type === 'surah') {
				trigger = document.querySelector(baseTriggerSelector);
				if (trigger) {
					trigger.hidden = false;
					trigger.setAttribute('data-quran-help-tour-temporary-trigger', '1');
				}
			}
			if (!trigger) return;
			trigger.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
			return new Promise(function (resolve) {
				window.setTimeout(function () {
					trigger.click();
					waitForCondition(function () { return Boolean(visibleTarget(menuSelector)); }, 1200).then(function () {
						if (assessmentPreview) {
							var menu = document.querySelector(menuSelector);
							var optionSelector = type === 'ayah' ? '[data-quran-ayah-state-option]' : '[data-quran-surah-state-option]';
							var initialOptions = ['learning', 'weak', 'review', 'core', 'later'];
							if (menu) {
								menu.setAttribute('data-quran-help-tour-assessment-preview', '1');
								menu.setAttribute('aria-label', 'Initial memorization self-assessment example');
								menu.querySelectorAll(optionSelector).forEach(function (option) {
									var optionState = option.getAttribute(type === 'ayah' ? 'data-quran-ayah-state-option' : 'data-quran-surah-state-option');
									option.hidden = initialOptions.indexOf(optionState) === -1;
									option.classList.remove('is-current');
									option.setAttribute('aria-checked', 'false');
								});
							}
						}
						resolve();
					});
				}, 50);
			});
		});
	};
	var prepareStep = function (index) {
		var step = steps[index];
		if (mode === 'memorize') {
			if (step.requiresMemorizationMenu)
				return openMemorizationMenu(step.requiresMemorizationMenu, step.requiresMemorizationState);
			closeMemorizationMenus();
			return Promise.resolve();
		}
		if (mode !== 'study')
			return Promise.resolve();
		if (step.requiresPassage) {
			return closeStudyModal().then(function () {
				var displayedHero = visibleTarget('.quran-selected-ayah-hero .quran-ayah-hero');
				if (!displayedHero)
					return;
				var closeDetail = { hero: displayedHero.closest('[data-quran-selected-ayah-hero]'), promise: null };
				document.dispatchEvent(new CustomEvent('quran:help-tour-close-hero', { detail: closeDetail }));
				return closeDetail.promise || Promise.resolve();
			});
		}
		if (step.requiresModal)
			return openStudyModal(step.requiresModal, step.selector);
		if (step.requiresHero)
			return closeStudyModal().then(ensureStudyHero);
		return closeStudyModal();
	};
	var showStep = function (index) {
		if (!tour) return;
		var targetStep = Math.max(0, Math.min(index, steps.length - 1));
		prepareStep(targetStep).catch(function () {}).then(function () {
			if (!tour) return;
			currentStep = targetStep;
			var step = steps[currentStep];
			var heading = tour.querySelector('[data-quran-help-tips-heading]');
			var copy = tour.querySelector('[data-quran-help-tips-copy]');
			var progress = tour.querySelector('[data-quran-help-tips-progress]');
			var back = tour.querySelector('[data-quran-help-tips-back]');
			var next = tour.querySelector('[data-quran-help-tips-next]');
			heading.textContent = step.title;
			renderCopy(copy, step.copy);
			progress.textContent = `${currentStep + 1} of ${steps.length}`;
			back.hidden = currentStep === 0;
			next.textContent = currentStep === steps.length - 1 ? (step.actionLabel || 'Done') : 'Next';
			activeTarget = visibleTarget(step.selector);
			if (activeTarget && activeTarget.scrollIntoView)
				activeTarget.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
			window.requestAnimationFrame(function () {
				positionTour();
				next.focus();
			});
		});
	};
	var closeTour = function (dismissal) {
		if (!tour) return;
		if (mode === 'memorize') closeMemorizationMenus();
		if (dismissal) rememberDismissal(dismissal);
		window.cancelAnimationFrame(resizeFrame);
		window.removeEventListener('resize', schedulePosition);
		window.removeEventListener('scroll', schedulePosition, true);
		document.removeEventListener('keydown', handleKeydown);
		tour.remove();
		tour = null;
		activeTarget = null;
		if (previousFocus && previousFocus.focus) previousFocus.focus();
	};
	var handleKeydown = function (event) {
		if (!tour) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeTour('session');
			return;
		}
		if (event.key !== 'Tab') return;
		var controls = Array.from(tour.querySelectorAll('button:not([hidden])'));
		if (!controls.length) return;
		var first = controls[0];
		var last = controls[controls.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	var startTour = function () {
		if (tour) return;
		previousFocus = document.activeElement;
		tour = document.createElement('div');
		tour.className = 'quran-help-tips';
		tour.setAttribute('data-quran-help-tips', mode);
		tour.innerHTML = '<div class="quran-help-tips-click-shield" aria-hidden="true"></div>'
			+ '<div class="quran-help-tips-spotlight" data-quran-help-tips-spotlight aria-hidden="true"></div>'
			+ '<section class="quran-help-tips-card" data-quran-help-tips-card role="dialog" aria-modal="true" aria-labelledby="quran-help-tips-heading" aria-describedby="quran-help-tips-copy">'
			+ '<button type="button" class="quran-help-tips-close" data-quran-help-tips-close aria-label="Dismiss tips for this session"><span class="bi bi-x-lg" aria-hidden="true"></span></button>'
			+ `<span class="quran-help-tips-kicker">${labels[mode]} guide</span>`
			+ '<h2 id="quran-help-tips-heading" data-quran-help-tips-heading></h2>'
			+ '<p id="quran-help-tips-copy" data-quran-help-tips-copy></p>'
			+ '<div class="quran-help-tips-footer"><span class="quran-help-tips-progress" data-quran-help-tips-progress></span>'
			+ '<div class="quran-help-tips-nav-actions">'
			+ '<button type="button" class="btn btn-sm btn-outline-secondary" data-quran-help-tips-back>Back</button>'
			+ '<button type="button" class="btn btn-sm btn-primary" data-quran-help-tips-next>Next</button>'
			+ '</div><div class="quran-help-tips-dismiss-actions">'
			+ '<button type="button" class="btn btn-sm btn-link" data-quran-help-tips-dismiss aria-label="Dismiss this tour for the current browser session">Hide for now</button>'
			+ '<span aria-hidden="true">·</span>'
			+ '<button type="button" class="btn btn-sm btn-link" data-quran-help-tips-dismiss-permanent aria-label="Permanently stop showing this tour automatically for your account">Don\'t show again</button>'
			+ '</div></div></section>';
		document.body.appendChild(tour);
		tour.addEventListener('click', function (event) {
			if (event.target.closest('[data-quran-help-tips-dismiss-permanent]')) {
				closeTour('permanent');
				return;
			}
			if (event.target.closest('[data-quran-help-tips-close], [data-quran-help-tips-dismiss]')) {
				closeTour('session');
				return;
			}
			if (event.target.closest('[data-quran-help-tips-back]')) {
				showStep(currentStep - 1);
				return;
			}
			if (event.target.closest('[data-quran-help-tips-next]')) {
				if (currentStep === steps.length - 1) {
					var finalStep = steps[currentStep];
					var finalTarget = activeTarget;
					closeTour('session');
					if (finalStep.action === 'click-target' && finalTarget) finalTarget.click();
				}
				else showStep(currentStep + 1);
			}
		});
		window.addEventListener('resize', schedulePosition);
		window.addEventListener('scroll', schedulePosition, true);
		document.addEventListener('keydown', handleKeydown);
		showStep(0);
	};
	document.addEventListener('click', function (event) {
		var trigger = event.target.closest('[data-page-help-tour-trigger]');
		if (!trigger || trigger.getAttribute('data-page-help-tour-trigger') !== mode) return;
		event.preventDefault();
		startTour();
	});
	if (wasPermanentlyDismissedLocally()) {
		savePermanentDismissal().catch(function () {});
	} else if (!wasDismissedLocally()) {
		wasDismissedForUser().then(function (dismissed) {
			if (!dismissed && !wasDismissedLocally()) window.setTimeout(startTour, 450);
		});
	}
}

function initQuranMushafAyahMarkerActions(root) {
	if (document.documentElement.dataset.quranMushafAyahMarkerActionsBound === '1')
		return;
	document.documentElement.dataset.quranMushafAyahMarkerActionsBound = '1';
	var menu = document.createElement('div');
	menu.id = 'quran-mushaf-ayah-actions';
	menu.className = 'quran-mushaf-ayah-actions';
	menu.setAttribute('role', 'menu');
	menu.setAttribute('lang', 'en');
	menu.setAttribute('dir', 'ltr');
	menu.setAttribute('aria-label', 'Ayah actions');
	menu.hidden = true;
	menu.innerHTML = '<button type="button" class="quran-mushaf-ayah-action" role="menuitem" data-quran-mushaf-ayah-play><span class="bi bi-play-fill" aria-hidden="true"></span> Play</button><a class="quran-mushaf-ayah-action" role="menuitem" data-quran-mushaf-ayah-view><span class="bi bi-text-paragraph" aria-hidden="true"></span> Study</a>';
	document.body.appendChild(menu);
	var activeMarker = null;
	var markerShowTimer = null;
	var markerHideTimer = null;
	var closeMenu = function (restoreFocus) {
		window.clearTimeout(markerShowTimer);
		window.clearTimeout(markerHideTimer);
		if (activeMarker)
			activeMarker.setAttribute('aria-expanded', 'false');
		menu.hidden = true;
		if (restoreFocus && activeMarker)
			activeMarker.focus();
		activeMarker = null;
	};
	var positionMenu = function (marker) {
		var rect = marker.getBoundingClientRect();
		var menuRect = menu.getBoundingClientRect();
		var left = rect.left + (rect.width - menuRect.width) / 2;
		left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
		var top = rect.bottom + 6;
		if (top + menuRect.height > window.innerHeight - 8)
			top = Math.max(8, rect.top - menuRect.height - 6);
		menu.style.left = `${Math.round(left)}px`;
		menu.style.top = `${Math.round(top)}px`;
	};
	var showMenu = function (marker, focusAction) {
		window.clearTimeout(markerShowTimer);
		window.clearTimeout(markerHideTimer);
		if (activeMarker && activeMarker !== marker)
			activeMarker.setAttribute('aria-expanded', 'false');
		activeMarker = marker;
		activeMarker.setAttribute('aria-expanded', 'true');
		var view = menu.querySelector('[data-quran-mushaf-ayah-view]');
		view.setAttribute('href', marker.getAttribute('href') || marker.getAttribute('data-quran-href') || '#');
		view.setAttribute('aria-label', `Study Quran ${marker.getAttribute('data-quran-ref') || ''}`);
		menu.hidden = false;
		positionMenu(marker);
		if (focusAction)
			menu.querySelector('.quran-mushaf-ayah-action').focus();
	};
	var scheduleMenuClose = function () {
		window.clearTimeout(markerHideTimer);
		markerHideTimer = window.setTimeout(function () {
			closeMenu(false);
		}, 120);
	};
	document.addEventListener('pointerover', function (event) {
		var marker = event.target.closest('[data-quran-ayah-actions="1"][data-quran-ref]');
		if (!marker || marker.closest('[data-quran-memorize-page]'))
			return;
		window.clearTimeout(markerHideTimer);
		if (activeMarker === marker && !menu.hidden)
			return;
		window.clearTimeout(markerShowTimer);
		markerShowTimer = window.setTimeout(function () {
			showMenu(marker, false);
		}, 750);
	});
	document.addEventListener('pointerout', function (event) {
		var marker = event.target.closest('[data-quran-ayah-actions="1"][data-quran-ref]');
		if (!marker)
			return;
		var markerWrap = marker.closest('.quran-mushaf-ayah-marker-state-wrap');
		if (event.relatedTarget && (marker.contains(event.relatedTarget) || menu.contains(event.relatedTarget)
			|| (markerWrap && markerWrap.contains(event.relatedTarget))))
			return;
		window.clearTimeout(markerShowTimer);
		if (activeMarker === marker)
			scheduleMenuClose();
	});
	document.addEventListener('focusin', function (event) {
		var marker = event.target.closest('[data-quran-ayah-actions="1"][data-quran-ref]');
		if (!marker || marker.closest('[data-quran-memorize-page]'))
			return;
		window.clearTimeout(markerShowTimer);
		markerShowTimer = window.setTimeout(function () {
			showMenu(marker, false);
		}, 750);
	});
	document.addEventListener('focusout', function (event) {
		var marker = event.target.closest('[data-quran-ayah-actions="1"][data-quran-ref]');
		var markerWrap = marker && marker.closest('.quran-mushaf-ayah-marker-state-wrap');
		if (!marker || (event.relatedTarget && (menu.contains(event.relatedTarget)
			|| (markerWrap && markerWrap.contains(event.relatedTarget)))))
			return;
		window.clearTimeout(markerShowTimer);
		if (activeMarker === marker)
			scheduleMenuClose();
	});
	menu.addEventListener('pointerenter', function () {
		window.clearTimeout(markerHideTimer);
	});
	menu.addEventListener('pointerleave', scheduleMenuClose);
	document.addEventListener('click', function (event) {
		var marker = event.target.closest('[data-quran-ayah-actions="1"][data-quran-ref]');
		if (marker) {
			event.preventDefault();
			event.stopPropagation();
			if (activeMarker === marker && !menu.hidden) {
				closeMenu(false);
				return;
			}
			showMenu(marker, true);
			return;
		}
		var play = event.target.closest('[data-quran-mushaf-ayah-play]');
		if (play && menu.contains(play) && activeMarker) {
			event.preventDefault();
			var ref = quranAudioRefParts(activeMarker.getAttribute('data-quran-ref') || '');
			var page = activeMarker.closest('[data-quran-mushaf-page]');
			var control = page && page.querySelector('[data-quran-passage-audio="1"]');
			if (!control)
				control = matchingQuranPassageAudioControl(ref);
			closeMenu(false);
			if (control && Number.isInteger(ref.surah) && Number.isInteger(ref.ayah)) {
				startQuranPassageAudio(control, {
					startSurah: ref.surah,
					startAyah: ref.ayah,
					restart: true
				});
			}
			return;
		}
		if (!menu.contains(event.target))
			closeMenu(false);
	});
	document.addEventListener('keydown', function (event) {
		if (menu.hidden)
			return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu(true);
		}
	});
	window.addEventListener('scroll', function () {
		if (!menu.hidden)
			closeMenu(false);
	}, { passive: true });
	window.addEventListener('resize', function () {
		if (!menu.hidden && activeMarker)
			positionMenu(activeMarker);
	}, { passive: true });
}

function initQuranMushafSurahPicker(root) {
	if (document.documentElement.dataset.quranMushafSurahPickerBound === '1')
		return;
	document.documentElement.dataset.quranMushafSurahPickerBound = '1';
	document.addEventListener('shown.bs.dropdown', function (event) {
		var dropdown = event.target.closest && event.target.closest('.quran-mushaf-surah-picker-dropdown');
		var menu = dropdown && dropdown.querySelector('.quran-mushaf-surah-picker-menu');
		var active = menu && menu.querySelector('.dropdown-item.active, .dropdown-item[aria-current="true"]');
		if (!menu || !active)
			return;
		window.requestAnimationFrame(function () {
			var menuRect = menu.getBoundingClientRect();
			var activeRect = active.getBoundingClientRect();
			menu.scrollTop += activeRect.top - menuRect.top - ((menu.clientHeight - activeRect.height) / 2);
		});
	});
}

function updateQuranMushafFooterPageLinks(pageNumber) {
	pageNumber = parseInt(pageNumber, 10);
	if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 604)
		return;
	var targets = {
		prev: pageNumber > 1 ? pageNumber - 1 : 604,
		next: pageNumber < 604 ? pageNumber + 1 : 1
	};
	var memorizeSuffix = document.querySelector('[data-quran-memorize-reader]') ? '?memorize' : '';
	Object.keys(targets).forEach(function (direction) {
		var selector = direction === 'prev' ? '[data-mobile-bottom-nav-prev]' : '[data-mobile-bottom-nav-next]';
		var current = document.querySelector(selector);
		if (!current)
			return;
		var targetPage = targets[direction];
		var replacement = document.createElement('a');
		replacement.className = 'mobile-bottom-nav-item';
		replacement.innerHTML = current.innerHTML;
		replacement.setAttribute(selector.slice(1, -1), '');
		replacement.setAttribute('href', `/quran/page/${targetPage}${memorizeSuffix}`);
		replacement.setAttribute('rel', direction);
		replacement.setAttribute('title', `${direction === 'prev' ? 'Previous' : 'Next'} Mushaf page ${targetPage}`);
		replacement.setAttribute('aria-label', `${direction === 'prev' ? 'Previous' : 'Next'} Mushaf page ${targetPage}`);
		current.replaceWith(replacement);
	});
}

function updateLazyReaderDocumentTitle(title) {
	title = (title || '').toString().trim();
	if (!title)
		return;
	document.title = title;
	var ogTitle = document.querySelector('meta[property="og:title"]');
	var twitterTitle = document.querySelector('meta[name="twitter:title"]');
	if (ogTitle)
		ogTitle.setAttribute('content', title);
	if (twitterTitle)
		twitterTitle.setAttribute('content', title);
	document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
		try {
			var data = JSON.parse(script.textContent || '');
			if (data && data['@type'] === 'WebPage') {
				data.name = title;
				data.headline = title;
				script.textContent = JSON.stringify(data);
			}
		} catch (err) {}
	});
}

function copyQuranReaderModeHrefs(source, target) {
	if (!source || !target)
		return;
	['passage', 'ayat', 'mushaf', 'memorize', 'review'].forEach(function (mode) {
		var link = source.querySelector(`[data-quran-reader-mode-link="${mode}"]`);
		var href = link && link.getAttribute('href');
		if (href)
			target.setAttribute(`data-quran-reader-${mode}-href`, href);
	});
}

function updateQuranReaderModeHrefs(marker) {
	if (!marker)
		return;
	['passage', 'ayat', 'mushaf', 'memorize', 'review'].forEach(function (mode) {
		var href = marker.getAttribute(`data-quran-reader-${mode}-href`);
		if (!href)
			return;
		document.querySelectorAll(`[data-quran-reader-mode-link="${mode}"]`).forEach(function (link) {
			link.setAttribute('href', href);
		});
	});
}

function scrollQuranMushafJuzMenuToCurrent() {
	var panel = document.querySelector('.site-navbar #toc2');
	var current = panel && panel.querySelector('[data-quran-mushaf-header-juz].is-current');
	if (!panel || !current)
		return;
	panel.scrollTop = Math.max(0, current.offsetTop - ((panel.clientHeight - current.offsetHeight) / 2));
}

function initQuranMenuRows(root) {
	var rows = root.querySelectorAll('[data-quran-mushaf-juz-href], [data-quran-menu-href]');
	rows.forEach(function (row) {
		row.addEventListener('click', function (event) {
			if (event.target.closest('a, button, input, select, textarea'))
				return;
			var href = row.getAttribute('data-quran-mushaf-juz-href') || row.getAttribute('data-quran-menu-href');
			if (!href)
				return;
			if (event.metaKey || event.ctrlKey || event.shiftKey)
				window.open(href, '_blank');
			else
				window.location.href = href;
		});
	});
}

function updateQuranMushafHeaderJuz(pageNumber, pageElement) {
	pageNumber = parseInt(pageNumber, 10);
	var input = pageElement && pageElement.querySelector('[data-quran-mushaf-juz-form] input');
	var juzNumber = parseInt(input && input.value, 10);
	if (!Number.isInteger(pageNumber) || !Number.isInteger(juzNumber) || juzNumber < 1 || juzNumber > 30)
		return;
	var currentRow = null;
	document.querySelectorAll('[data-quran-mushaf-header-juz]').forEach(function (row) {
		var current = Number(row.getAttribute('data-quran-mushaf-header-juz')) === juzNumber;
		row.classList.toggle('is-current', current);
		if (current)
			currentRow = row;
		row.querySelectorAll('a').forEach(function (link) {
			if (current)
				link.setAttribute('aria-current', 'page');
			else
				link.removeAttribute('aria-current');
		});
	});
	var currentLabel = document.querySelector('[data-quran-mushaf-current-juz]');
	if (currentLabel && currentRow) {
		var startPage = parseInt(currentRow.getAttribute('data-quran-mushaf-juz-start-page'), 10);
		var endPage = parseInt(currentRow.getAttribute('data-quran-mushaf-juz-end-page'), 10);
		var completedPages = Math.max(1, pageNumber - startPage + 1);
		var totalPages = Math.max(1, endPage - startPage + 1);
		var progress = Math.max(0, Math.min(100, Math.round((completedPages / totalPages) * 100)));
		currentLabel.textContent = `${juzNumber} · ${progress}%`;
	}
	var panel = document.querySelector('.site-navbar #toc2');
	if (panel && panel.classList.contains('show'))
		scrollQuranMushafJuzMenuToCurrent();
}

function updateQuranMushafVisiblePage(pageNumber, pageElement) {
	pageNumber = parseInt(pageNumber, 10);
	if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 604)
		return;
	try {
		if (window.localStorage)
			window.localStorage.setItem('hadithdb.quranMushafLastPage', pageNumber.toString());
	} catch (_err) {}
	updateQuranMushafFooterPageLinks(pageNumber);
	var subtitle = document.querySelector('.site-header-brand [data-page-subtitle]');
	if (subtitle)
		subtitle.textContent = `Page ${pageNumber}`;
	pageElement = pageElement || document.querySelector(`[data-quran-mushaf-page="${pageNumber}"]`);
	updateQuranReaderModeHrefs(pageElement);
	updateQuranMushafHeaderJuz(pageNumber, pageElement);
	updateLazyReaderDocumentTitle(pageElement && pageElement.getAttribute('data-page-title'));
}

function initQuranMushafLastPageLinks(root) {
	var scope = root || document;
	if (scope !== document || document.documentElement.dataset.quranMushafLastPageLinksBound === '1')
		return;
	document.documentElement.dataset.quranMushafLastPageLinksBound = '1';
	document.addEventListener('click', function (event) {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		var link = event.target.closest && event.target.closest('a[href]');
		if (!link || link.target || link.hasAttribute('download'))
			return;
		var url;
		try {
			url = new URL(link.href, window.location.href);
		} catch (_err) {
			return;
		}
		if (url.origin !== window.location.origin || url.pathname !== '/quran/page' || url.search || url.hash)
			return;
		var pageNumber = 0;
		try {
			pageNumber = parseInt(window.localStorage && window.localStorage.getItem('hadithdb.quranMushafLastPage'), 10);
		} catch (_err) {}
		if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 604)
			return;
		event.preventDefault();
		window.location.href = `${url.origin}/quran/page/${pageNumber}`;
	});
}

var pendingQuranMushafLineFitRoots = new Set();
var quranMushafLineFitFrame = 0;

function fitQuranMushafLines(root) {
	var scope = root || document;
	var lines = scope.matches && scope.matches('.quran-mushaf-line')
		? [scope]
		: Array.from(scope.querySelectorAll('.quran-mushaf-line'));
	lines.filter(function (line) {
		return !line.classList.contains('quran-mushaf-line-surah_name');
	}).forEach(function (line) {
		var sheet = line.closest('.quran-mushaf-sheet');
		if (!sheet)
			return;
		var mobileSize = window.getComputedStyle(sheet).getPropertyValue('--quran-mushaf-mobile-font-size').trim();
		line.style.removeProperty('--quran-mushaf-line-font-size');
		line.style.removeProperty('--quran-mushaf-fitted-line-height');
		line.style.removeProperty('--quran-mushaf-fitted-min-height');
		if (!mobileSize || !line.clientWidth)
			return;
		var baseStyle = window.getComputedStyle(line);
		var baseSize = parseFloat(baseStyle.fontSize) || parseFloat(mobileSize) || 16;
		var baseLineHeight = (parseFloat(baseStyle.lineHeight) || baseSize * 1.85) / baseSize;
		var baseMinHeight = parseFloat(baseStyle.minHeight) || baseSize * 1.95;
		for (var attempt = 0; attempt < 3; attempt += 1) {
			var items = Array.from(line.children).filter(function (item) {
				return !item.classList.contains('quran-mushaf-ayah-highlight-bg') && item.getClientRects().length > 0;
			});
			if (items.length < 1)
				return;
			var itemRects = items.map(function (item) { return item.getBoundingClientRect(); });
			var required = Math.max.apply(null, itemRects.map(function (rect) { return rect.right; }))
				- Math.min.apply(null, itemRects.map(function (rect) { return rect.left; }));
			var available = line.clientWidth;
			if (required <= available + .5)
				return;
			var currentSize = parseFloat(window.getComputedStyle(line).fontSize) || parseFloat(mobileSize) || 16;
			var nextSize = currentSize * available / required * .985;
			var fitScale = nextSize / baseSize;
			line.style.setProperty('--quran-mushaf-line-font-size', `${nextSize}px`);
			line.style.setProperty('--quran-mushaf-fitted-line-height', `${baseLineHeight * fitScale}`);
			line.style.setProperty('--quran-mushaf-fitted-min-height', `${baseMinHeight * fitScale * fitScale}px`);
		}
	});
}

function scheduleQuranMushafLineFit(root) {
	pendingQuranMushafLineFitRoots.add(root || document);
	if (quranMushafLineFitFrame)
		return;
	quranMushafLineFitFrame = window.requestAnimationFrame(function () {
		quranMushafLineFitFrame = window.requestAnimationFrame(function () {
			quranMushafLineFitFrame = 0;
			var roots = Array.from(pendingQuranMushafLineFitRoots);
			pendingQuranMushafLineFitRoots.clear();
			roots.forEach(fitQuranMushafLines);
		});
	});
}

function initQuranMushafLineFitting(root) {
	scheduleQuranMushafLineFit(root || document);
	if (document.documentElement.dataset.quranMushafLineFittingBound === '1')
		return;
	document.documentElement.dataset.quranMushafLineFittingBound = '1';
	window.addEventListener('resize', function () {
		scheduleQuranMushafLineFit(document);
	}, { passive: true });
	if (document.fonts && document.fonts.ready)
		document.fonts.ready.then(function () { scheduleQuranMushafLineFit(document); }).catch(function () {});
	if (document.fonts && document.fonts.addEventListener)
		document.fonts.addEventListener('loadingdone', function () { scheduleQuranMushafLineFit(document); });
}

function initQuranMushafInfinite(root) {
	var reader = (root || document).querySelector('[data-quran-mushaf-reader]');
	if (!reader || reader.dataset.quranMushafBound === '1')
		return;
	var reviewPassageEndPage = Math.max(0, Number(new URLSearchParams(window.location.search).get('reviewPassageEndPage')) || 0);
	if (reader.hasAttribute('data-quran-review-reader') && !reviewPassageEndPage)
		return;
	reader.dataset.quranMushafBound = '1';
	var sentinel = reader.querySelector('[data-quran-mushaf-sentinel]');
	var loading = false;
	var pageInstance = 0;
	var pageObserver = null;
	var pendingPageNumber = '';
	var pageUrlTimer = null;
	var schedulePageUrlUpdate = function (pageNumber) {
		pendingPageNumber = pageNumber || pendingPageNumber;
		if (pageUrlTimer)
			window.clearTimeout(pageUrlTimer);
		pageUrlTimer = window.setTimeout(function () {
			pageUrlTimer = null;
			var querySuffix = reader.hasAttribute('data-quran-memorize-reader') ? '?memorize' : '';
			var selectedRef = new URLSearchParams(window.location.search).get('ayah') || '';
			var pendingPage = reader.querySelector(`[data-quran-mushaf-page="${pendingPageNumber}"]`);
			if (!querySuffix && /^\d+:\d+$/.test(selectedRef) && pendingPage && pendingPage.querySelector(`[data-quran-ref="${selectedRef}"]`))
				querySuffix = `?ayah=${encodeURIComponent(selectedRef)}`;
			var nextLocation = `/quran/page/${pendingPageNumber}${querySuffix}`;
			if (pendingPageNumber && window.history && window.history.replaceState && `${window.location.pathname}${window.location.search}` !== nextLocation)
				window.history.replaceState({ quranMushafPage: Number(pendingPageNumber) }, '', nextLocation);
			pendingPageNumber = '';
		}, 180);
	};
	if ('IntersectionObserver' in window) {
		pageObserver = new IntersectionObserver(function (entries) {
			entries.filter(function (entry) { return entry.isIntersecting; }).sort(function (a, b) {
				return b.intersectionRatio - a.intersectionRatio;
			}).slice(0, 1).forEach(function (entry) {
				var pageNumber = entry.target.getAttribute('data-quran-mushaf-page');
				if (!pageNumber)
					return;
				updateQuranMushafVisiblePage(pageNumber, entry.target);
				schedulePageUrlUpdate(pageNumber);
			});
		}, { rootMargin: '-35% 0px -35% 0px', threshold: [0, 0.25, 0.5, 0.75] });
		reader.querySelectorAll('[data-quran-mushaf-page]').forEach(function (page) { pageObserver.observe(page); });
	}
	var initialPage = reader.querySelector('[data-quran-mushaf-page]');
	if (initialPage) {
		initialPage.setAttribute('data-page-title', document.title);
		copyQuranReaderModeHrefs(document, initialPage);
		updateQuranMushafVisiblePage(initialPage.getAttribute('data-quran-mushaf-page'), initialPage);
	}
	var loadNextPage = function () {
		var nextUrl = reader.getAttribute('data-next-url') || '';
		if (!nextUrl || loading)
			return Promise.resolve();
		loading = true;
		if (sentinel)
			sentinel.textContent = 'Loading the next page…';
		return fetch(quranApiPath(nextUrl), { credentials: 'same-origin' }).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load the next Mushaf page.');
			return response.text();
		}).then(function (html) {
			var parsed = new DOMParser().parseFromString(html, 'text/html');
			var remoteReader = parsed.querySelector('[data-quran-mushaf-reader]');
			var page = remoteReader && remoteReader.querySelector('[data-quran-mushaf-page]');
			if (!page)
				throw new Error('The next Mushaf page was not found.');
			var pageNumber = page.getAttribute('data-quran-mushaf-page');
			var importedPage = document.importNode(page, true);
			if (reader.hasAttribute('data-quran-review-reader'))
				importedPage.querySelectorAll('.quran-memorize-rating').forEach(function (controls) { controls.remove(); });
			importedPage.setAttribute('data-page-title', parsed.title || '');
			copyQuranReaderModeHrefs(parsed, importedPage);
			pageInstance += 1;
			var originalScope = importedPage.getAttribute('data-quran-audio-scope') || '';
			if (originalScope) {
				var instanceScope = `${originalScope}-infinite-${pageInstance}`;
				importedPage.setAttribute('data-quran-audio-scope', instanceScope);
				importedPage.querySelectorAll('[data-quran-audio-scope]').forEach(function (control) {
					if (control.getAttribute('data-quran-audio-scope') === originalScope)
						control.setAttribute('data-quran-audio-scope', instanceScope);
				});
			}
			importedPage.style.visibility = 'hidden';
			reader.insertBefore(importedPage, sentinel);
			initQuranScriptPreference(importedPage).then(function () {
				scheduleQuranMushafLineFit(importedPage);
			}).catch(function () {
				scheduleQuranMushafLineFit(importedPage);
			});
			initQuranMushafLineFitting(importedPage);
			fitQuranMushafLines(importedPage);
			initQuranMemorizeView(importedPage);
			initQuranMushafAyahSelection(importedPage);
			if (window.refreshHadithActions)
				window.refreshHadithActions();
			importedPage.style.removeProperty('visibility');
			initQuranPassageAudioControls(importedPage);
			if (pageObserver)
				pageObserver.observe(importedPage);
			reader.setAttribute('data-next-url', remoteReader.getAttribute('data-next-url') || '');
			return true;
		}).catch(function (error) {
			reader.setAttribute('data-next-url', '');
			if (sentinel)
				sentinel.textContent = error.message || 'Unable to load the next page.';
		}).finally(function () {
			loading = false;
			if (sentinel && reader.getAttribute('data-next-url'))
				sentinel.textContent = '';
			else if (sentinel && !sentinel.textContent)
				sentinel.textContent = 'End of the Mushaf';
		});
	};
	reader.addEventListener('submit', function (event) {
		var form = event.target.closest('[data-quran-mushaf-page-form], [data-quran-mushaf-juz-form], [data-quran-mushaf-surah-form]');
		if (!form)
			return;
		event.preventDefault();
		var input = form.querySelector('input');
		var value = parseInt(input && input.value, 10);
		var isJuz = form.hasAttribute('data-quran-mushaf-juz-form');
		var isSurah = form.hasAttribute('data-quran-mushaf-surah-form');
		var min = isJuz || isSurah ? 1 : 2;
		var max = isJuz ? 30 : (isSurah ? 114 : 604);
		var label = isJuz ? 'Juz' : (isSurah ? 'Surah' : 'Mushaf page');
		if (!Number.isInteger(value) || value < min || value > max) {
			if (input) {
				input.setCustomValidity(`Enter a ${label} from ${min} through ${max}.`);
				input.reportValidity();
			}
			return;
		}
		input.setCustomValidity('');
		var memorizeSuffix = reader.hasAttribute('data-quran-memorize-reader') ? '?memorize' : '';
		window.location.href = isJuz ? `/quran/juz/${value}?mushaf${memorizeSuffix ? '&memorize' : ''}` : (isSurah ? `/quran/${value}?mushaf${memorizeSuffix ? '&memorize' : ''}` : `/quran/page/${value}${memorizeSuffix}`);
	});
	reader.addEventListener('input', function (event) {
		if (event.target.matches('[data-quran-mushaf-page-form] input, [data-quran-mushaf-juz-form] input, [data-quran-mushaf-surah-form] input'))
			event.target.setCustomValidity('');
	});
	reader.addEventListener('click', function (event) {
		if (event.target.matches('[data-quran-mushaf-page-form] input, [data-quran-mushaf-juz-form] input, [data-quran-mushaf-surah-form] input'))
			event.target.select();
	});
	var maybeLoadNextPage = function () {
		if (loading || !sentinel || !reader.getAttribute('data-next-url'))
			return;
		if (sentinel.getBoundingClientRect().top <= window.innerHeight + 1800)
			loadNextPage().then(function () { window.requestAnimationFrame(maybeLoadNextPage); });
	};
	window.addEventListener('scroll', function () {
		maybeLoadNextPage();
		if (pendingPageNumber)
			schedulePageUrlUpdate(pendingPageNumber);
	}, { passive: true });
	window.addEventListener('resize', function () {
		maybeLoadNextPage();
	});
	var loadReviewPassagePages = function () {
		if (!reviewPassageEndPage) return loadNextPage().then(function () { window.requestAnimationFrame(maybeLoadNextPage); });
		var loadedPages = Array.from(reader.querySelectorAll('[data-quran-mushaf-page]')).map(function (page) {
			return Number(page.getAttribute('data-quran-mushaf-page')) || 0;
		});
		if (Math.max.apply(null, loadedPages) >= reviewPassageEndPage) return Promise.resolve();
		return loadNextPage().then(loadReviewPassagePages);
	};
	reader.quranMushafReviewPagesReady = loadReviewPassagePages();
	reader.quranMushafLoadNext = loadNextPage;
}

function initQuranDynamicPassageHero(root) {
	var scope = root || document;
	if (!$(scope).find('[data-quran-selected-ayah-hero]').length)
		return;
	if ($(document).data('quranDynamicPassageHeroBound'))
		return;
	$(document).data('quranDynamicPassageHeroBound', true);
	var pendingRequest = null;
	var selectedRefFromPath = function () {
		var match = window.location.pathname.match(/\/quran:(\d+):(\d+)(?:-\d+)?$/);
		if (match)
			return `${match[1]}:${match[2]}`;
		if (/\/quran\/page\/\d+$/.test(window.location.pathname)) {
			var queryRef = new URLSearchParams(window.location.search).get('ayah') || '';
			return /^\d+:\d+$/.test(queryRef) ? queryRef : '';
		}
		return '';
	};
	var setSelectedPassageAyah = function (ref) {
		ref = (ref || '').toString();
		$('.quran-passage-section .body.passage .ayah').each(function () {
			$(this).toggleClass('ayah-selected', ($(this).attr('data-quran-ref') || '') === ref);
		});
		var parts = ref.split(/:/);
		if (parts.length >= 2) {
			$('.quran-passage-surah').val(parts[0]);
			$('.quran-passage-ayah').val(parts[1]);
		}
	};
	var setMushafSearchAyahHighlight = function (ref) {
		if (!/^\/quran\/page\/\d+$/.test(window.location.pathname))
			return false;
		document.querySelectorAll('[data-quran-mushaf-page]').forEach(function (page) {
			page.querySelectorAll('[data-quran-ref]').forEach(function (element) {
				var matches = !!ref && element.getAttribute('data-quran-ref') === ref;
				if (element.classList.contains('quran-mushaf-search-ayah') || matches)
					element.classList.toggle('quran-audio-active-ayah', matches);
				element.classList.toggle('quran-mushaf-search-ayah', matches);
			});
		});
		refreshQuranMushafAyahBackgrounds([document]);
		return true;
	};
	var scrollSelectedAyahHeroIntoView = function (hero) {
		if (!hero || !hero.length)
			return;
		window.requestAnimationFrame(function () {
			var navbar = document.querySelector('.site-navbar.fixed-top');
			var navbarOffset = navbar ? navbar.getBoundingClientRect().height : 0;
			window.scrollTo({
				top: window.pageYOffset + hero[0].getBoundingClientRect().top - navbarOffset - 12,
				behavior: 'smooth'
			});
		});
	};
	var heroForTrigger = function (trigger) {
		var chunk = $(trigger).closest('[data-quran-infinite-page="1"]');
		var hero = chunk.length ? chunk.find('[data-quran-selected-ayah-hero]').first() : $();
		return hero.length ? hero : $('[data-quran-selected-ayah-hero]').first();
	};
	var syncHeroToolbar = function (hero) {
		var scope = hero && $(hero).length ? $(hero).closest('[data-quran-infinite-page="1"], [data-quran-infinite-passage="1"]') : $();
		syncQuranAyahSelectorHeroState(scope.length ? scope[0] : document);
	};
	var clearSelectedAyahHero = function (href, pushHistory, heroTarget) {
		var hero = heroTarget && $(heroTarget).length ? $(heroTarget) : $('[data-quran-selected-ayah-hero]').first();
		hero.empty();
		setSelectedPassageAyah('');
		syncHeroToolbar(hero);
		if (pushHistory && href && window.history && window.history.pushState)
			window.history.pushState({ quranDynamicAyahRef: '' }, '', href);
		document.title = document.title.replace(/^Quran\s+\d+:\d+(?:-\d+)?\s+\|\s+/, '');
	};
	var loadAyahHero = function (href, pushHistory, heroTarget) {
		var target = new URL(href, window.location.origin);
		var refMatch = target.pathname.match(/\/quran:(\d+):(\d+)$/);
		if (!refMatch)
			return Promise.reject(new Error('Only single Quran ayah links can update the hero dynamically.'));
		var ref = `${refMatch[1]}:${refMatch[2]}`;
		if (pendingRequest && pendingRequest.abort)
			pendingRequest.abort();
		pendingRequest = new AbortController();
		return fetch(quranUrl(`${target.pathname}?json=1`), {
			credentials: 'same-origin',
			signal: pendingRequest.signal
		}).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load selected ayah.');
			return response.json();
		}).then(function (data) {
			var ayah = Array.isArray(data) ? data[0] : data;
			if (!ayah)
				throw new Error('Selected ayah was not found.');
			var hero = heroTarget && $(heroTarget).length ? $(heroTarget) : $('[data-quran-selected-ayah-hero]').first();
			var clearHref = hero.attr('data-quran-clear-href') || '';
			ensureQuranShareModal(ayah, quranAyahShareId(ref));
			hero.empty().append(quranAyahHeroHtml(ayah, clearHref, hero[0]));
			if (typeof window.bindInlineEditors === 'function')
				window.bindInlineEditors(hero[0]);
			if (window.refreshHadithActions)
				window.refreshHadithActions();
			setSelectedPassageAyah(ref);
			syncHeroToolbar(hero);
			var corpusContainer = hero.closest('[data-quran-corpus-url]');
			if (!corpusContainer.length)
				corpusContainer = $('[data-quran-corpus-url]').first();
			var corpusUrl = corpusContainer.attr('data-quran-corpus-url');
			if (corpusContainer.length)
				initQuranScriptPreference(corpusContainer[0]).then(function () {
					initQuranCorpusTooltips(corpusContainer[0]);
				}).catch(function () {
					initQuranCorpusTooltips(corpusContainer[0]);
				});
			if (corpusUrl && quranCorpusPayloadCache[corpusUrl]) {
				quranCorpusPayloadCache[corpusUrl].then(function (payload) {
					annotateQuranCorpusWords(hero, payload.wordsByAyah || {}, payload.juzStartsByAyah || {});
				});
			}
			if (pushHistory && window.history && window.history.pushState)
				window.history.pushState({ quranDynamicAyahRef: ref }, '', `${target.pathname}${target.search}${target.hash}`);
			if (pushHistory)
				scrollSelectedAyahHeroIntoView(hero);
			document.title = `Quran ${ref} | ${document.title.replace(/^Quran\s+\d+:\d+(?:-\d+)?\s+\|\s+/, '')}`;
		}).catch(function (err) {
			if (err && err.name === 'AbortError')
				return;
			throw err;
		}).finally(function () {
			pendingRequest = null;
		});
	};
	document.addEventListener('quran:help-tour-open-hero', function (event) {
		var detail = event.detail || {};
		var trigger = detail.trigger;
		if (!trigger || !trigger.matches('.quran-passage-section .body.passage .quran-ayah-hero-trigger[data-quran-href]'))
			return;
		var ayah = trigger.closest('.ayah');
		var href = trigger.getAttribute('data-quran-href') || ayah && ayah.getAttribute('data-quran-href') || '';
		if (!/\/quran:\d+:\d+$/.test(new URL(href, window.location.origin).pathname))
			return;
		detail.promise = loadAyahHero(href, false, heroForTrigger(trigger));
	});
	document.addEventListener('quran:help-tour-close-hero', function (event) {
		var detail = event.detail || {};
		var hero = detail.hero ? $(detail.hero) : $('[data-quran-selected-ayah-hero]').filter(function () {
			return quranSelectedAyahHeroIsDisplayed(this);
		}).first();
		if (!hero.length)
			return;
		var href = hero.attr('data-quran-clear-href') || '';
		clearSelectedAyahHero(href, false, hero);
		detail.promise = Promise.resolve();
	});

	var initialSelectedRef = selectedRefFromPath();
	setSelectedPassageAyah(initialSelectedRef);
	setMushafSearchAyahHighlight(initialSelectedRef);
	$(document).on('click.quranDynamicPassageHeroClear', '[data-quran-selected-ayah-hero] .quran-ayah-hero-clear[href]', function (event) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		if ($('body').hasClass('quran-ayah-selecting'))
			return;
		var hero = $(this).closest('[data-quran-selected-ayah-hero]');
		var href = $(this).attr('href') || hero.attr('data-quran-clear-href') || $('[data-quran-selected-ayah-hero]').first().attr('data-quran-clear-href') || '';
		if (!href)
			return;
		event.preventDefault();
		event.stopPropagation();
		clearSelectedAyahHero(href, true, hero);
	});
	$(document).on('click.quranDynamicPassageToolbarHeroClear', '.quran-ayah-select-toolbar.has-selected-ayah-hero .quran-ayah-select-clear', function (event) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		var toolbar = $(this).closest('.quran-ayah-select-toolbar');
		var heroElement = quranSelectedAyahHeroForToolbar(toolbar[0]);
		var hero = heroElement ? $(heroElement) : $('[data-quran-selected-ayah-hero]').first();
		var href = $(this).attr('href') || hero.attr('data-quran-clear-href') || '';
		if (!href)
			return;
		event.preventDefault();
		event.stopPropagation();
		clearSelectedAyahHero(href, true, hero);
	});
	$(document).on('click.quranDynamicPassageHero', '.quran-passage-section .body.passage .quran-ayah-hero-trigger[data-quran-href], .quran-mushaf-page .quran-ayah-hero-trigger[data-quran-href]', function (event) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		if ($(this).is('[data-quran-ayah-actions="1"]'))
			return;
		if ($('body').hasClass('quran-ayah-selecting'))
			return;
		var href = $(this).attr('data-quran-href') || $(this).closest('.ayah').attr('data-quran-href') || '';
		if (!/\/quran:\d+:\d+$/.test(new URL(href, window.location.origin).pathname))
			return;
		event.preventDefault();
		event.stopPropagation();
		loadAyahHero(href, true, heroForTrigger(this)).catch(function (err) {
			if (window.toastr)
				toastr.error(err.message || 'Unable to update selected ayah.');
			else
				window.location.href = href;
		});
	});
	$(document).on('click.quranDynamicPassageHeroNav', '[data-quran-selected-ayah-hero] .quran-ayah-hero-nav[href]', function (event) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		var href = $(this).attr('href') || '';
		var target = new URL(href, window.location.origin);
		var refMatch = target.pathname.match(/\/quran:(\d+):(\d+)$/);
		if (!refMatch)
			return;
		var ref = `${refMatch[1]}:${refMatch[2]}`;
		var hero = $(this).closest('[data-quran-selected-ayah-hero]');
		var passageScope = hero.closest('[data-quran-infinite-page="1"], [data-quran-infinite-passage="1"]');
		if (!passageScope.find(`.ayah[data-quran-ref="${ref}"]`).length)
			return;
		event.preventDefault();
		event.stopPropagation();
		loadAyahHero(href, true, hero).catch(function (err) {
			if (window.toastr)
				toastr.error(err.message || 'Unable to update selected ayah.');
			else
				window.location.href = href;
		});
	});
	window.addEventListener('popstate', function () {
		var ref = selectedRefFromPath();
		if (setMushafSearchAyahHighlight(ref))
			return;
		if (!ref) {
			clearSelectedAyahHero('', false);
			return;
		}
		loadAyahHero(`/quran:${ref}`, false).catch(function () {
			setSelectedPassageAyah(ref);
		});
	});
}

function initQuranInfinitePassageNavigation(root) {
	var scope = root || document;
	var main = $(scope).find('[data-quran-infinite-passage="1"]').addBack('[data-quran-infinite-passage="1"]').first();
	if (!main.length || main.data('quranInfinitePassageBound'))
		return;
	main.data('quranInfinitePassageBound', true);

	var prefetchAhead = 1;
	var ensuring = false;
	var loadingPromise = null;
	var retryAfter = 0;
	var exhausted = false;
	var nextUrl = main.attr('data-quran-next-url') || '';
	var loadedUrls = new Set();
	var currentUrl = main.attr('data-quran-current-url') || `${window.location.pathname}${window.location.search}`;
	var activeUrl = normalizeQuranInfiniteUrl(currentUrl);
	var lastSurah = main.attr('data-quran-surah') || quranSurahFromInfiniteUrl(currentUrl);
	loadedUrls.add(normalizeQuranInfiniteUrl(currentUrl));

	var status = $('<div class="quran-infinite-status text-muted small" aria-live="polite"></div>').appendTo(main);
	var sentinel = $('<div class="quran-infinite-sentinel" aria-hidden="true"></div>').appendTo(main);
	var initialAnchor = $('<span class="quran-infinite-url-marker" aria-hidden="true" data-quran-infinite-anchor="1"></span>').attr({
		'data-quran-url': currentUrl,
		'data-page-title': document.title,
		'data-quran-surah': lastSurah,
		'data-quran-prev-url': main.attr('data-quran-prev-url') || '',
		'data-quran-prev-title': main.attr('data-quran-prev-title') || 'Previous',
		'data-quran-next-url': main.attr('data-quran-next-url') || '',
		'data-quran-next-title': main.attr('data-quran-next-title') || 'Next'
	});
	copyQuranReaderModeHrefs(document, initialAnchor[0]);
	var firstHeading = main.children('article.col-12.mt-4').first();
	if (firstHeading.length)
		initialAnchor.insertBefore(firstHeading);
	else
		main.prepend(initialAnchor);
	var scrollTimer = null;
	var scrollFrame = null;
	var fadeNav = function () {
		document.body.classList.add('quran-passage-nav-faded');
		window.clearTimeout(scrollTimer);
		scrollTimer = window.setTimeout(function () {
			document.body.classList.remove('quran-passage-nav-faded');
		}, 240);
	};
	var pageMarkers = function () {
		return Array.from(main[0].querySelectorAll('[data-quran-infinite-anchor="1"], [data-quran-infinite-page="1"]'));
	};
	var currentPageIndex = function () {
		var markers = pageMarkers();
		var position = window.pageYOffset + (window.innerHeight * 0.65);
		var index = 0;
		markers.forEach(function (marker, markerIndex) {
			var top = marker.getBoundingClientRect().top + window.pageYOffset;
			if (top <= position)
				index = markerIndex;
		});
		return index;
	};
	var pagesAhead = function () {
		var markers = pageMarkers();
		return Math.max(0, markers.length - currentPageIndex() - 1);
	};
	var setMobileBottomNavLink = function (direction, href, title) {
		var selector = direction === 'prev' ? '[data-mobile-bottom-nav-prev]' : '[data-mobile-bottom-nav-next]';
		var current = document.querySelector(selector);
		if (!current)
			return;
		var label = direction === 'prev' ? 'Previous' : 'Next';
		var enabled = !!href;
		var replacement = document.createElement(enabled ? 'a' : 'span');
		replacement.className = 'mobile-bottom-nav-item' + (enabled ? '' : ' mobile-bottom-nav-item-disabled');
		replacement.innerHTML = current.innerHTML;
		replacement.setAttribute(selector.slice(1, -1), '');
		if (enabled) {
			replacement.setAttribute('href', href);
			replacement.setAttribute('rel', direction);
			replacement.setAttribute('title', title || label);
			replacement.setAttribute('aria-label', label);
		} else {
			replacement.setAttribute('aria-disabled', 'true');
		}
		current.replaceWith(replacement);
	};
	var updateInfiniteNavigation = function () {
		var marker = pageMarkers()[currentPageIndex()];
		if (!marker)
			return;
		activateInfinitePassageLazyLoaders(marker);
		updateQuranReaderModeHrefs(marker);
		var prevHref = marker.getAttribute('data-quran-prev-url') || '';
		var nextHref = marker.getAttribute('data-quran-next-url') || '';
		setMobileBottomNavLink('prev', prevHref, marker.getAttribute('data-quran-prev-title') || 'Previous');
		setMobileBottomNavLink('next', nextHref, marker.getAttribute('data-quran-next-title') || 'Next');
	};
	var updateInfiniteUrl = function () {
		var marker = pageMarkers()[currentPageIndex()];
		var url = marker && marker.getAttribute('data-quran-url');
		var normalized = normalizeQuranInfiniteUrl(url);
		updateLazyReaderDocumentTitle(marker && marker.getAttribute('data-page-title'));
		if (!window.history || !window.history.replaceState)
			return;
		if (!url || !normalized || normalized === activeUrl)
			return;
		activeUrl = normalized;
		window.history.replaceState(window.history.state || {}, '', url);
	};
	var scheduleInfiniteWork = function () {
		if (scrollFrame)
			return;
		scrollFrame = window.requestAnimationFrame(function () {
			scrollFrame = null;
			updateInfiniteUrl();
			updateInfiniteNavigation();
			ensureLoadedAhead();
		});
	};
	var activateInfinitePassageLazyLoaders = function (marker) {
		if (!marker || marker.getAttribute('data-quran-infinite-page') !== '1' || marker.getAttribute('data-quran-infinite-lazy-bound') === '1')
			return;
		marker.setAttribute('data-quran-infinite-lazy-bound', '1');
		initQuranPreferredTranslationDisplays(marker);
		initQuranPassageTranslationSelects(marker);
		initQuranPassageAudioControls(marker);
		initQuranScriptPreference(marker).then(function () {
			initQuranCorpusTooltips(marker);
		}).catch(function () {
			initQuranCorpusTooltips(marker);
		});
		initQuranPassageShareLinks(marker);
	};
	var normalizeModalRef = function (ref) {
		return (ref || '').toString().replace(/^\/+/, '').replace(/^quran:/, '');
	};
	var modalForType = function (rootNode, modalType) {
		return Array.from(rootNode.querySelectorAll('.quran-ayah-modal')).find(function (modal) {
			return (modal.getAttribute('data-quran-ayah-modal-type') || 'tafsirs') === modalType;
		}) || null;
	};
	var paneForRef = function (modal, ref) {
		var normalized = normalizeModalRef(ref);
		if (!modal || !normalized)
			return null;
		return Array.from(modal.querySelectorAll('[data-quran-ayah-modal-pane]')).find(function (pane) {
			return normalizeModalRef(pane.getAttribute('data-quran-ayah-ref')) === normalized;
		}) || null;
	};
	var remapQuranModalTriggers = function (rootNode, modalIndexMaps) {
		if (!rootNode || !modalIndexMaps)
			return;
		rootNode.querySelectorAll('.quran-ayah-modal-trigger[data-quran-ayah-modal-index]').forEach(function (trigger) {
			var modalType = trigger.getAttribute('data-quran-ayah-modal-type') || 'tafsirs';
			var sourceIndex = parseInt(trigger.getAttribute('data-quran-ayah-modal-index'), 10);
			var indexMap = modalIndexMaps[modalType] || modalIndexMaps.tafsirs || {};
			if (!Number.isInteger(sourceIndex) || indexMap[sourceIndex] === undefined)
				return;
			trigger.setAttribute('data-quran-ayah-modal-index', indexMap[sourceIndex]);
		});
	};
	var mergeQuranAyahModalPanes = function (parsed) {
		var modalIndexMaps = {};
		parsed.querySelectorAll('.quran-ayah-modal').forEach(function (sourceModal) {
			var modalType = sourceModal.getAttribute('data-quran-ayah-modal-type') || 'tafsirs';
			var targetModal = modalForType(document, modalType);
			var targetBody = targetModal ? targetModal.querySelector('.modal-body') : null;
			if (!targetModal || !targetBody)
				return;
			var indexMap = modalIndexMaps[modalType] = modalIndexMaps[modalType] || {};
			var nextIndex = targetModal.querySelectorAll('[data-quran-ayah-modal-pane]').length;
			Array.from(sourceModal.querySelectorAll('[data-quran-ayah-modal-pane]')).forEach(function (sourcePane, fallbackIndex) {
				var sourceIndex = parseInt(sourcePane.getAttribute('data-quran-ayah-modal-pane'), 10);
				if (!Number.isInteger(sourceIndex))
					sourceIndex = fallbackIndex;
				var ref = sourcePane.getAttribute('data-quran-ayah-ref') || '';
				var existingPane = paneForRef(targetModal, ref);
				if (existingPane) {
					indexMap[sourceIndex] = existingPane.getAttribute('data-quran-ayah-modal-pane') || '0';
					return;
				}
				var targetIndex = nextIndex++;
				indexMap[sourceIndex] = targetIndex;
				var paneHtml = sourcePane.outerHTML
					.replace(/data-quran-ayah-modal-pane="[^"]*"/g, `data-quran-ayah-modal-pane="${targetIndex}"`)
					.replace(/quran-ayah-(?:tafsir|translations|reflections)-modal-pane-\d+/g, `${targetModal.getAttribute('id')}-pane-${targetIndex}`)
					.replace(/quran-ayah-comments-\d+/g, `quran-ayah-comments-dynamic-${modalType}-${targetIndex}`);
				var template = document.createElement('template');
				template.innerHTML = paneHtml.trim();
				var importedPane = template.content.firstElementChild;
				if (!importedPane)
					return;
				importedPane.classList.add('d-none');
				targetBody.appendChild(importedPane);
				executeInlineScripts(importedPane);
			});
		});
		initQuranAyahModals(document);
		return modalIndexMaps;
	};
	$(window).on('scroll.quranInfinitePassageNav', function () {
		fadeNav();
		scheduleInfiniteWork();
	});
	$(window).on('resize.quranInfinitePassageNav', scheduleInfiniteWork);

	var appendPassage = function (html, url) {
		var parsed = new DOMParser().parseFromString(html, 'text/html');
		var remoteMain = parsed.querySelector('[data-quran-infinite-passage="1"]');
		if (!remoteMain)
			throw new Error('Next Quran passage was not found.');
		var modalIndexMaps = mergeQuranAyahModalPanes(parsed);
		var remoteSurah = remoteMain.getAttribute('data-quran-surah') || quranSurahFromInfiniteUrl(url);
		var remoteCorpusUrl = remoteMain.getAttribute('data-quran-corpus-url') || '';
		var chunk = $('<section class="quran-infinite-page" data-quran-infinite-page="1"></section>').attr({
			'data-quran-url': remoteMain.getAttribute('data-quran-current-url') || url,
			'data-page-title': parsed.title || '',
			'data-quran-surah': remoteSurah,
			'data-quran-prev-url': remoteMain.getAttribute('data-quran-prev-url') || '',
			'data-quran-prev-title': remoteMain.getAttribute('data-quran-prev-title') || 'Previous',
			'data-quran-next-url': remoteMain.getAttribute('data-quran-next-url') || '',
			'data-quran-next-title': remoteMain.getAttribute('data-quran-next-title') || 'Next'
		});
		copyQuranReaderModeHrefs(parsed, chunk[0]);
		if (remoteCorpusUrl)
			chunk.attr('data-quran-corpus-url', remoteCorpusUrl);
		var remoteChildren = Array.from(remoteMain.children);
		var nodes = [];
		var chapterHeading = remoteChildren.find(function (node) {
			return node.matches && node.matches('heading.row.major');
		});
		var breadcrumbs = remoteChildren.find(function (node) {
			return node.matches && node.matches('section.breadcrumbs.pagination');
		});
		var selectedAyahHero = remoteChildren.find(function (node) {
			return node.matches && node.matches('[data-quran-selected-ayah-hero]');
		});
		var sectionHeading = remoteChildren.find(function (node) {
			return node.matches && node.matches('article.col-12.mt-4');
		});
		var passageToolbar = remoteChildren.find(function (node) {
			return node.matches && node.matches('.quran-ayah-select-toolbar');
		});
		var shareModals = remoteChildren.filter(function (node) {
			return node.matches && node.matches('.quran-share-root');
		});
		if (remoteSurah && remoteSurah !== lastSurah && chapterHeading) {
			nodes.push(chapterHeading);
			lastSurah = remoteSurah;
		}
		if (breadcrumbs)
			nodes.push(breadcrumbs);
		if (selectedAyahHero)
			nodes.push(selectedAyahHero);
		if (sectionHeading)
			nodes.push(sectionHeading);
		if (passageToolbar)
			nodes.push(passageToolbar);
		remoteChildren.forEach(function (node) {
			if (!node.matches || nodes.indexOf(node) >= 0)
				return;
			if (node.matches('.quran-heading-audio-toolbar') || node.matches('.quran-passage-section') || node.matches('.quran-passage-actions') || node.matches('.quran-share-root') || node.matches('.quran-passage-separator'))
				nodes.push(node);
		});
		if (nodes.length < 1)
			throw new Error('Next Quran passage did not include readable content.');
		nodes.forEach(function (node) {
			var imported = document.importNode(node, true);
			if (imported.matches && imported.matches('.quran-share-root') && imported.id && document.getElementById(imported.id))
				return;
			imported.querySelectorAll('.quran-section-heading-actions').forEach(function (actions) {
				actions.remove();
			});
			remapQuranModalTriggers(imported, modalIndexMaps);
			chunk[0].appendChild(imported);
		});
		shareModals.forEach(function (node) {
			if (nodes.indexOf(node) >= 0 || !node.id || document.getElementById(node.id))
				return;
			var imported = document.importNode(node, true);
			chunk[0].appendChild(imported);
		});
		chunk.insertBefore(status);
		initQuranAyahHoverPairs(chunk[0]);
		initQuranAyahSelector(chunk[0]);
		initQuranPassageDisplayToggles(chunk[0]);
		initQuranScriptPreference(chunk[0]).catch(function () {});
		initHadithShareModals(chunk[0]);
		initHadithContentTranslationControls(chunk[0]);
		initQuranAyahModals(document);
		if (typeof window.bindInlineEditors === 'function')
			window.bindInlineEditors(chunk[0]);
        if (typeof window.initQuranSubheadingAdminControls === 'function')
          window.initQuranSubheadingAdminControls(chunk[0]);
        if (typeof window.initQuranRangeAdminControls === 'function')
          window.initQuranRangeAdminControls(chunk[0]);
		if (window.refreshHadithActions)
			window.refreshHadithActions();
		nextUrl = remoteMain.getAttribute('data-quran-next-url') || '';
		if (nextUrl)
			main.attr('data-quran-next-url', nextUrl);
		else
			main.removeAttr('data-quran-next-url');
		return chunk[0];
	};

	var loadNext = function () {
		if (loadingPromise)
			return loadingPromise;
		if (exhausted || !nextUrl)
			return Promise.resolve(false);
		if (retryAfter && Date.now() < retryAfter)
			return Promise.resolve(false);
		var targetUrl = nextUrl;
		var normalized = normalizeQuranInfiniteUrl(targetUrl);
		if (!normalized)
			return Promise.resolve(false);
		if (loadedUrls.has(normalized)) {
			exhausted = true;
			nextUrl = '';
			main.removeAttr('data-quran-next-url');
			return Promise.resolve(false);
		}
		retryAfter = 0;
		status.removeAttr('data-infinite-load-error').text('Loading next passage...');
		loadingPromise = fetch(quranApiPath(targetUrl), {
			credentials: 'same-origin',
			headers: { 'Accept': 'text/html' }
		}).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load next Quran passage.');
			return response.text();
		}).then(function (html) {
			var chunk = appendPassage(html, targetUrl);
			loadedUrls.add(normalized);
			status.text('');
			return chunk || true;
		}).catch(function (err) {
			retryAfter = Date.now() + 2500;
			showInfiniteLoadFailure(status, err && err.message ? err.message : 'Unable to load next Quran passage.', targetUrl, 'Open next Quran passage');
			return false;
		}).finally(function () {
			loadingPromise = null;
		});
		return loadingPromise;
	};

	var ensureLoadedAhead = function () {
		if (ensuring || exhausted || !nextUrl || pagesAhead() >= prefetchAhead)
			return;
		ensuring = true;
		var run = function () {
			if (exhausted || !nextUrl || pagesAhead() >= prefetchAhead) {
				ensuring = false;
				return;
			}
			loadNext().then(function (loaded) {
				if (!loaded || pagesAhead() >= prefetchAhead) {
					ensuring = false;
					return;
				}
				window.requestAnimationFrame(run);
			});
		};
		run();
	};

	main[0].quranInfiniteLoadNext = loadNext;
	main[0].quranInfiniteEnsureLoadedAhead = ensureLoadedAhead;

	if (window.IntersectionObserver) {
		var sentinelObserver = new IntersectionObserver(function (entries) {
			if (entries.some(function (entry) { return entry.isIntersecting; }))
				ensureLoadedAhead();
		}, { rootMargin: '2400px 0px' });
		sentinelObserver.observe(sentinel[0]);
	}

	window.setTimeout(scheduleInfiniteWork, 100);
}

function initReaderInfiniteNavigation(root) {
	var scope = root || document;
	$(scope).find('[data-reader-infinite]').addBack('[data-reader-infinite]').each(function () {
		var main = $(this);
		if (main.data('readerInfiniteBound'))
			return;
		main.data('readerInfiniteBound', true);

		var mode = main.attr('data-reader-infinite') || '';
		var prefetchAhead = mode === 'tafsir' ? 1 : 3;
		var ensuring = false;
		var loadingPromise = null;
		var retryAfter = 0;
		var exhausted = false;
		var nextUrl = main.attr('data-reader-next-url') || '';
		var loadedUrls = new Set();
		var currentUrl = main.attr('data-reader-current-url') || `${window.location.pathname}${window.location.search}`;
		var activeUrl = normalizeReaderInfiniteUrl(currentUrl);
		var lastContextKey = main.attr('data-reader-context-key') || '';
		loadedUrls.add(activeUrl);

		var status = $('<div class="reader-infinite-status text-muted small" aria-live="polite"></div>').appendTo(main);
		var sentinel = $('<div class="reader-infinite-sentinel" aria-hidden="true"></div>').appendTo(main);
		var initialAnchor = $('<span class="reader-infinite-url-marker" aria-hidden="true" data-reader-infinite-anchor="1"></span>').attr({
			'data-reader-mode': mode,
			'data-reader-url': currentUrl,
			'data-page-title': document.title,
			'data-reader-context-key': lastContextKey,
			'data-reader-prev-url': main.attr('data-reader-prev-url') || '',
			'data-reader-prev-title': main.attr('data-reader-prev-title') || 'Previous',
			'data-reader-next-url': main.attr('data-reader-next-url') || '',
			'data-reader-next-title': main.attr('data-reader-next-title') || 'Next'
		});
		var firstContent = main.children('heading.row.major, article, section').filter(function () {
			return !this.matches('.reader-infinite-status, .reader-infinite-sentinel');
		}).first();
		if (firstContent.length)
			initialAnchor.insertBefore(firstContent);
		else
			main.prepend(initialAnchor);

		var scrollTimer = null;
		var scrollFrame = null;
		var fadeNav = function () {
			document.body.classList.add('reader-infinite-nav-faded');
			window.clearTimeout(scrollTimer);
			scrollTimer = window.setTimeout(function () {
				document.body.classList.remove('reader-infinite-nav-faded');
			}, 240);
		};
		var pageMarkers = function () {
			return Array.from(main[0].querySelectorAll('[data-reader-infinite-anchor="1"], [data-reader-infinite-page="1"]'));
		};
		var currentPageIndex = function () {
			var markers = pageMarkers();
			var position = window.pageYOffset + (window.innerHeight * 0.65);
			var index = 0;
			markers.forEach(function (marker, markerIndex) {
				var top = marker.getBoundingClientRect().top + window.pageYOffset;
				if (top <= position)
					index = markerIndex;
			});
			return index;
		};
		var pagesAhead = function () {
			var markers = pageMarkers();
			return Math.max(0, markers.length - currentPageIndex() - 1);
		};
		var setMobileBottomNavLink = function (direction, href, title) {
			var selector = direction === 'prev' ? '[data-mobile-bottom-nav-prev]' : '[data-mobile-bottom-nav-next]';
			var current = document.querySelector(selector);
			if (!current)
				return;
			var label = direction === 'prev' ? 'Previous' : 'Next';
			var enabled = !!href;
			var replacement = document.createElement(enabled ? 'a' : 'span');
			replacement.className = 'mobile-bottom-nav-item' + (enabled ? '' : ' mobile-bottom-nav-item-disabled');
			replacement.innerHTML = current.innerHTML;
			replacement.setAttribute(selector.slice(1, -1), '');
			if (enabled) {
				replacement.setAttribute('href', href);
				replacement.setAttribute('rel', direction);
				replacement.setAttribute('title', title || label);
				replacement.setAttribute('aria-label', label);
			} else {
				replacement.setAttribute('aria-disabled', 'true');
			}
			current.replaceWith(replacement);
		};
		var updateInfiniteNavigation = function () {
			var marker = pageMarkers()[currentPageIndex()];
			if (!marker)
				return;
			var prevHref = marker.getAttribute('data-reader-prev-url') || '';
			var nextHref = marker.getAttribute('data-reader-next-url') || '';
			setMobileBottomNavLink('prev', prevHref, marker.getAttribute('data-reader-prev-title') || 'Previous');
			setMobileBottomNavLink('next', nextHref, marker.getAttribute('data-reader-next-title') || 'Next');
		};
		var updateInfiniteUrl = function () {
			var marker = pageMarkers()[currentPageIndex()];
			var url = marker && marker.getAttribute('data-reader-url');
			var normalized = normalizeReaderInfiniteUrl(url);
			updateLazyReaderDocumentTitle(marker && marker.getAttribute('data-page-title'));
			if (!window.history || !window.history.replaceState)
				return;
			if (!url || !normalized || normalized === activeUrl)
				return;
			activeUrl = normalized;
			try {
				window.history.replaceState(window.history.state || {}, '', url);
			} catch (err) {}
		};
		var scheduleInfiniteWork = function () {
			if (scrollFrame)
				return;
			scrollFrame = window.requestAnimationFrame(function () {
				scrollFrame = null;
				updateInfiniteUrl();
				updateInfiniteNavigation();
				ensureLoadedAhead();
			});
		};
		$(window).on(`scroll.readerInfiniteNav.${mode}`, function () {
			fadeNav();
			scheduleInfiniteWork();
		});
		$(window).on(`resize.readerInfiniteNav.${mode}`, scheduleInfiniteWork);

		var appendTafsirPage = function (remoteMain, chunk) {
			var remoteChildren = Array.from(remoteMain.children);
			var nodes = [];
			var remoteContextKey = remoteMain.getAttribute('data-reader-context-key') || '';
			var chapterHeading = remoteChildren.find(function (node) {
				return node.matches && node.matches('heading.row.major');
			});
			var breadcrumbs = remoteChildren.find(function (node) {
				return node.matches && node.matches('section.breadcrumbs.pagination');
			});
			var tafsirArticle = remoteChildren.find(function (node) {
				return node.matches && node.matches('.quran-tafsirs');
			});
			if (remoteContextKey && remoteContextKey !== lastContextKey && chapterHeading) {
				nodes.push(chapterHeading);
				lastContextKey = remoteContextKey;
			}
			if (breadcrumbs)
				nodes.push(breadcrumbs);
			if (tafsirArticle)
				nodes.push(tafsirArticle);
			if (nodes.length < 1)
				throw new Error('Next tafsir passage did not include readable content.');
			nodes.forEach(function (node) {
				var imported = document.importNode(node, true);
				imported.querySelectorAll('[id="tafsir"]').forEach(function (tafsirRoot) {
					tafsirRoot.removeAttribute('id');
				});
				imported.querySelectorAll('.quran-ayah-modal-trigger').forEach(function (trigger) {
					trigger.remove();
				});
				if (imported.matches && imported.matches('.quran-tafsirs'))
					imported.querySelectorAll('.h-menu-wrap').forEach(function (menuWrap) {
						menuWrap.classList.add('d-none');
						menuWrap.setAttribute('aria-hidden', 'true');
					});
				chunk[0].appendChild(imported);
			});
		};
		var appendHadithPage = function (remoteMain, chunk) {
			Array.from(remoteMain.children).forEach(function (node) {
				if (!node.matches)
					return;
				if (node.matches('.reader-infinite-status, .reader-infinite-sentinel, [data-reader-infinite-anchor]'))
					return;
				chunk[0].appendChild(document.importNode(node, true));
			});
			if (!chunk[0].children.length)
				throw new Error('Next hadith page did not include readable content.');
		};
		var reinitializeChunk = function (chunk) {
			initMarkdownEditablePreviews(chunk);
			initHadithSharhLinks(chunk);
			initHadithShareModals(chunk);
			initHadithContentTranslationControls(chunk);
			if (mode === 'tafsir') {
				initDropdownFilterSearch(chunk);
				initTafsirSearchFilterPills(chunk);
				initQuranPassageNavigator();
				initQuranTafsirTabs(chunk);
				initQuranTafsirFootnotePopups(chunk);
			}
			if (typeof window.bindInlineEditors === 'function')
				window.bindInlineEditors(chunk);
			if (window.refreshHadithActions)
				window.refreshHadithActions();
		};
		var appendReaderPage = function (html, url) {
			var parsed = new DOMParser().parseFromString(html, 'text/html');
			var remoteMain = Array.from(parsed.querySelectorAll('[data-reader-infinite]')).find(function (node) {
				return (node.getAttribute('data-reader-infinite') || '') === mode;
			});
			if (!remoteMain)
				throw new Error('Next page was not found.');
			var remoteUrl = remoteMain.getAttribute('data-reader-current-url') || url;
			var remoteContextKey = remoteMain.getAttribute('data-reader-context-key') || '';
			var chunk = $('<section class="reader-infinite-page" data-reader-infinite-page="1"></section>').attr({
				'data-reader-mode': mode,
				'data-reader-url': remoteUrl,
				'data-page-title': parsed.title || '',
				'data-reader-context-key': remoteContextKey,
				'data-reader-prev-url': remoteMain.getAttribute('data-reader-prev-url') || '',
				'data-reader-prev-title': remoteMain.getAttribute('data-reader-prev-title') || 'Previous',
				'data-reader-next-url': remoteMain.getAttribute('data-reader-next-url') || '',
				'data-reader-next-title': remoteMain.getAttribute('data-reader-next-title') || 'Next'
			});
			if (mode === 'tafsir')
				appendTafsirPage(remoteMain, chunk);
			else
				appendHadithPage(remoteMain, chunk);
			chunk.insertBefore(status);
			reinitializeChunk(chunk[0]);
			nextUrl = remoteMain.getAttribute('data-reader-next-url') || '';
			if (nextUrl)
				main.attr('data-reader-next-url', nextUrl);
			else
				main.removeAttr('data-reader-next-url');
			return chunk[0];
		};
		var loadNext = function () {
			if (loadingPromise)
				return loadingPromise;
			if (exhausted || !nextUrl)
				return Promise.resolve(false);
			if (retryAfter && Date.now() < retryAfter)
				return Promise.resolve(false);
			var targetUrl = nextUrl;
			var normalized = normalizeReaderInfiniteUrl(targetUrl);
			if (!normalized)
				return Promise.resolve(false);
			if (loadedUrls.has(normalized)) {
				exhausted = true;
				nextUrl = '';
				main.removeAttr('data-reader-next-url');
				return Promise.resolve(false);
			}
			retryAfter = 0;
			status.removeAttr('data-infinite-load-error').text('Loading next page...');
			loadingPromise = fetch(mode === 'tafsir' ? quranApiPath(targetUrl) : hadithUrl(`/api${targetUrl}`), {
				credentials: 'same-origin',
				headers: { 'Accept': 'text/html' }
			}).then(function (response) {
				if (!response.ok)
					throw new Error('Unable to load next page.');
				return response.text();
			}).then(function (html) {
				appendReaderPage(html, targetUrl);
				loadedUrls.add(normalized);
				status.text('');
				return true;
			}).catch(function (err) {
				retryAfter = Date.now() + 2500;
				showInfiniteLoadFailure(status, err && err.message ? err.message : 'Unable to load next page.', targetUrl, 'Open next page');
				return false;
			}).finally(function () {
				loadingPromise = null;
			});
			return loadingPromise;
		};
		var ensureLoadedAhead = function () {
			if (ensuring || exhausted || !nextUrl || pagesAhead() >= prefetchAhead)
				return;
			ensuring = true;
			var run = function () {
				if (exhausted || !nextUrl || pagesAhead() >= prefetchAhead) {
					ensuring = false;
					return;
				}
				loadNext().then(function (loaded) {
					if (!loaded || pagesAhead() >= prefetchAhead) {
						ensuring = false;
						return;
					}
					window.requestAnimationFrame(run);
				});
			};
			run();
		};

		if (window.IntersectionObserver) {
			var sentinelObserver = new IntersectionObserver(function (entries) {
				if (entries.some(function (entry) { return entry.isIntersecting; }))
					ensureLoadedAhead();
			}, { rootMargin: '2400px 0px' });
			sentinelObserver.observe(sentinel[0]);
		}

		window.setTimeout(scheduleInfiniteWork, 100);
	});
}

function normalizeQuranInfiniteUrl(url) {
	try {
		var parsed = new URL(url, window.location.origin);
		parsed.hash = '';
		return `${parsed.pathname}${parsed.search}`;
	} catch (err) {
		return '';
	}
}

function showInfiniteLoadFailure(status, message, href, linkText) {
	var target = $(status);
	target.empty().attr('data-infinite-load-error', '1');
	$('<span>').text(`${message} `).appendTo(target);
	if (href) {
		$('<a>').addClass('infinite-load-fallback-link').attr({
			href: href,
			rel: 'next'
		}).text(linkText || 'Open next page').appendTo(target);
	}
}

function normalizeReaderInfiniteUrl(url) {
	try {
		var parsed = new URL(url, window.location.origin);
		parsed.hash = '';
		return `${parsed.pathname}${parsed.search}`;
	} catch (err) {
		return '';
	}
}

function quranSurahFromInfiniteUrl(url) {
	try {
		var parsed = new URL(url, window.location.origin);
		var path = parsed.pathname;
		var pathMatch = path.match(/^\/quran\/(\d+)\//) || path.match(/^\/quran:(\d+):/);
		return pathMatch ? pathMatch[1] : '';
	} catch (err) {
		return '';
	}
}

var quranCorpusPayloadCache = {};
var quranScriptPayloadCache = {};

function quranScriptDisplayText(text, script) {
	text = (text || '').toString();
	if (script === 'indo-pak') {
		text = text.replace(/\s+\S*[\uE000-\uF8FF]\S*\s*$/u, '');
		text = text.replace(/\s+۝\S*\s*$/u, '');
	}
	return text.trim();
}

function updateQuranAyahMarkersForScript(root, script) {
	var scope = root || document;
	var markers = Array.from(scope.querySelectorAll ? scope.querySelectorAll('.quran-ayah-end-marker') : []);
	if (scope.matches && scope.matches('.quran-ayah-end-marker'))
		markers.unshift(scope);
	markers.forEach(function (marker) {
		if (marker.childElementCount > 0)
			return;
		var originalText = marker.getAttribute('data-quran-marker-text');
		if (!originalText) {
			originalText = marker.textContent || '';
			if (originalText.indexOf('۝') !== 0)
				return;
			marker.setAttribute('data-quran-marker-text', originalText);
		}
		marker.textContent = script === 'warsh' ? originalText.replace(/^۝/, '') : originalText;
	});
}

function replaceQuranScriptWordNodes(nodes, sourceWords, script) {
	nodes = Array.from(nodes || []);
	if (sourceWords === undefined)
		return;
	sourceWords = Array.from(sourceWords || []);
	if (script === 'indo-pak' && sourceWords.length > 0 && (/^[۝]/u.test(sourceWords[sourceWords.length - 1].text || '') || /[\uE000-\uF8FF]/u.test(sourceWords[sourceWords.length - 1].text || '')))
		sourceWords.pop();
	if (nodes.length < 1)
		return;
	if (sourceWords.length < 1) {
		nodes.forEach(function (node) { node.remove(); });
		return;
	}
	while (nodes.length < sourceWords.length) {
		var clone = nodes[nodes.length - 1].cloneNode(false);
		clone.removeAttribute('data-quran-word-translation');
		clone.removeAttribute('data-quran-word-grammar');
		nodes[nodes.length - 1].after(clone);
		nodes.push(clone);
	}
	while (nodes.length > sourceWords.length) {
		nodes.pop().remove();
	}
	nodes.forEach(function (node, index) {
		var word = sourceWords[index];
		node.textContent = word.text;
		node.setAttribute('data-quran-word', word.text);
		node.setAttribute('data-quran-word-number', word.word);
		node.setAttribute('data-quran-script-applied', script);
	});
}

function applyQuranScriptPayload(root, script, payload) {
	var scope = root || document;
	var ayahsByRef = payload && payload.ayahsByRef || {};
	var wordsByAyah = payload && payload.wordsByAyah || {};
	$(scope).find('[data-quran-script-text="ayah"][data-quran-ref]').addBack('[data-quran-script-text="ayah"][data-quran-ref]').each(function () {
		if (this.classList.contains('_e'))
			return;
		var ref = this.getAttribute('data-quran-ref') || '';
		if (!Object.prototype.hasOwnProperty.call(ayahsByRef, ref))
			return;
		var text = quranScriptDisplayText(ayahsByRef[ref], script);
		this.textContent = text;
		this.setAttribute('data-quran-script-applied', script);
		var ayah = this.closest('.ayah, .quran-ayah-hero-ayah');
		if (ayah)
			ayah.classList.toggle('quran-script-empty-ayah', !text);
	});
	$(scope).find('[data-quran-script-text="range"][data-quran-refs]').addBack('[data-quran-script-text="range"][data-quran-refs]').each(function () {
		var rangeRefs = (this.getAttribute('data-quran-refs') || '').split(',').filter(Boolean);
		var texts = rangeRefs.filter(function (ref) {
			return Object.prototype.hasOwnProperty.call(ayahsByRef, ref);
		}).map(function (ref) {
			return quranScriptDisplayText(ayahsByRef[ref], script);
		}).filter(Boolean);
		if (texts.length < 1)
			return;
		this.textContent = texts.join(' ');
		this.setAttribute('data-quran-script-applied', script);
	});
	var pages = $(scope).find('[data-quran-mushaf-page]').addBack('[data-quran-mushaf-page]').get();
	pages.forEach(function (page) {
		var refs = new Set(Array.from(page.querySelectorAll('[data-quran-script-text="word"][data-quran-ref]')).map(function (word) {
			return word.getAttribute('data-quran-ref');
		}).filter(Boolean));
		refs.forEach(function (ref) {
			var selector = `[data-quran-script-text="word"][data-quran-ref="${cssEscape(ref)}"]`;
			var mainWords = Array.from(page.querySelectorAll(selector)).filter(function (word) {
				return !word.closest('.quran-mushaf-line-basmallah');
			});
			replaceQuranScriptWordNodes(mainWords, wordsByAyah[ref], script);
		});
		page.querySelectorAll('.quran-mushaf-line-basmallah').forEach(function (line) {
			replaceQuranScriptWordNodes(line.querySelectorAll('[data-quran-script-text="word"][data-quran-ref]'), wordsByAyah['1:1'], script);
		});
	});
	if (pages.length > 0)
		scheduleQuranMushafLineFit(scope);
}

function initQuranScriptPreference(root) {
	var scope = root || document;
	var refs = Array.from(new Set($(scope)
		.find('[data-quran-script-text][data-quran-ref], [data-quran-script-text][data-quran-refs]')
		.addBack('[data-quran-script-text][data-quran-ref], [data-quran-script-text][data-quran-refs]')
		.map(function () { return [this.getAttribute('data-quran-ref'), ...(this.getAttribute('data-quran-refs') || '').split(',')]; })
		.get()
		.flat()
		.filter(function (ref) { return /^\d{1,3}:\d{1,3}$/.test(ref || ''); })));
	return getQuranTafsirSettings().then(function (settings) {
		var script = settings && settings.quran && settings.quran.script || 'uthmani';
		document.body.classList.remove('quran-script-indo-pak', 'quran-script-warsh');
		document.body.dataset.quranScript = script;
		trackQuranScriptDefault(script, 'resolved');
		updateQuranAyahMarkersForScript(scope, script);
		if (script === 'uthmani' || refs.length < 1)
			return script;
		document.body.classList.add(`quran-script-${script}`);
		var cacheKey = `${script}:${refs.slice().sort().join(',')}`;
		quranScriptPayloadCache[cacheKey] = quranScriptPayloadCache[cacheKey] || fetch(
			`${quranApiPath(`/quran/script/${encodeURIComponent(script)}`)}?refs=${encodeURIComponent(refs.join(','))}`,
			{ credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' } }
		).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load the selected Quran script.');
			return response.json();
		});
		return quranScriptPayloadCache[cacheKey].then(function (payload) {
			applyQuranScriptPayload(scope, script, payload);
			return script;
		});
	});
}

function normalizeQuranScriptChoice(value) {
	value = (value || '').toString().trim().toLowerCase();
	return ['uthmani', 'indo-pak', 'warsh'].indexOf(value) >= 0 ? value : '';
}

function trackQuranScriptDefault(value, source) {
	var script = normalizeQuranScriptChoice(value) || 'uthmani';
	if (typeof window.gtag !== 'function') return;
	window.gtag('set', 'user_properties', { quran_script_default: script });
	if (document.documentElement.dataset.quranScriptAnalytics === script) return;
	document.documentElement.dataset.quranScriptAnalytics = script;
	trackQuranAnalyticsEvent('quran_script_default', {
		quran_script: script,
		preference_source: source || 'resolved',
		non_interaction: true
	});
}

window.trackQuranScriptDefault = trackQuranScriptDefault;

function quranScriptChoiceLabel(script) {
	return { uthmani: 'Uthmani', 'indo-pak': 'Indo-Pak', warsh: 'Warsh' }[script] || 'Script';
}

function saveQuranScriptChoice(script) {
	script = normalizeQuranScriptChoice(script);
	if (!script)
		return Promise.reject(new Error('Unsupported Quran script.'));
	return waitForHadithAuthClient().then(function (auth) {
		if (!auth)
			throw new Error('Please sign in to save your Quran script.');
		return Promise.resolve(auth.requireToken
			? auth.requireToken('Please sign in to save your Quran script.')
			: (auth.getToken ? auth.getToken() : null)).then(function (token) {
			if (!token)
				throw new Error('Please sign in to save your Quran script.');
			return fetch(quranApiPath('/user-settings?optional=1'), {
				credentials: 'same-origin',
				headers: { 'Authorization': `Bearer ${token}` }
			}).then(function (response) {
				if (!response.ok)
					return responseErrorMessage(response, 'Unable to load settings.').then(function (message) { throw new Error(message); });
				return response.json();
			}).then(function (data) {
				var settings = data && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : {};
				var nextSettings = Object.assign({}, settings, {
					quran: Object.assign({}, settings.quran || {}, { script: script })
				});
				delete nextSettings.personalized;
				return fetch(quranApiPath('/user-settings'), {
					method: 'PUT',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
					body: JSON.stringify({ settings: nextSettings })
				}).then(function (response) {
					if (!response.ok)
						return responseErrorMessage(response, 'Unable to save Quran script.').then(function (message) { throw new Error(message); });
					return response.json();
				}).then(function (saved) {
					return Promise.resolve(auth.getUser ? auth.getUser() : null).then(function (user) {
						updateCachedQuranUserSettings(user, saved.settings || nextSettings);
						return saved.settings || nextSettings;
					});
				});
			});
		});
	});
}

function updateQuranScriptSwitcher(switcher, script) {
	script = normalizeQuranScriptChoice(script) || 'uthmani';
	var label = switcher.querySelector('[data-quran-script-label]');
	if (label)
		label.textContent = quranScriptChoiceLabel(script);
	switcher.querySelectorAll('[data-quran-script-choice]').forEach(function (choice) {
		var selected = choice.getAttribute('data-quran-script-choice') === script;
		choice.classList.toggle('active', selected);
		choice.setAttribute('aria-checked', selected ? 'true' : 'false');
		choice.setAttribute('role', 'menuitemradio');
	});
}

function initQuranScriptSwitchers(root) {
	var scope = root || document;
	var switchers = Array.from(scope.querySelectorAll('[data-quran-script-switcher]'));
	if (scope.matches && scope.matches('[data-quran-script-switcher]'))
		switchers.unshift(scope);
	if (switchers.length < 1)
		return;
	getQuranTafsirSettings().then(function (settings) {
		var currentScript = normalizeQuranScriptChoice(settings && settings.quran && settings.quran.script) || 'uthmani';
		switchers.forEach(function (switcher) {
			updateQuranScriptSwitcher(switcher, currentScript);
			if (switcher.dataset.quranScriptSwitcherBound === '1')
				return;
			switcher.dataset.quranScriptSwitcherBound = '1';
			switcher.addEventListener('click', function (event) {
				var choice = event.target.closest('[data-quran-script-choice]');
				if (!choice || !switcher.contains(choice))
					return;
				var nextScript = normalizeQuranScriptChoice(choice.getAttribute('data-quran-script-choice'));
				if (!nextScript || nextScript === (document.body.dataset.quranScript || currentScript))
					return;
				var controls = Array.from(document.querySelectorAll('[data-quran-script-choice]'));
				controls.forEach(function (control) { control.disabled = true; });
				var labels = Array.from(document.querySelectorAll('[data-quran-script-label]'));
				labels.forEach(function (label) { label.textContent = 'Saving…'; });
				saveQuranScriptChoice(nextScript).then(function () {
					window.location.reload();
				}).catch(function (err) {
					controls.forEach(function (control) { control.disabled = false; });
					document.querySelectorAll('[data-quran-script-switcher]').forEach(function (item) {
						updateQuranScriptSwitcher(item, document.body.dataset.quranScript || currentScript);
					});
					if (window.toastr)
						toastr.error(err.message || 'Unable to save Quran script.', 'Quran script');
				});
			});
		});
	}).catch(function () {
		switchers.forEach(function (switcher) { updateQuranScriptSwitcher(switcher, 'uthmani'); });
	});
}

function initQuranScriptMutationObserver() {
	if (!document.body || document.body.dataset.quranScriptObserverBound === '1')
		return;
	document.body.dataset.quranScriptObserverBound = '1';
	var pendingRoots = new Set();
	var scheduled = false;
	var flush = function () {
		scheduled = false;
		var roots = Array.from(pendingRoots);
		pendingRoots.clear();
		roots.forEach(function (root) {
			initQuranScriptPreference(root).catch(function () {});
		});
	};
	new MutationObserver(function (mutations) {
		mutations.forEach(function (mutation) {
			mutation.addedNodes.forEach(function (node) {
				if (node.nodeType !== 1)
					return;
				var marked = node.matches && node.matches('[data-quran-script-text][data-quran-ref], [data-quran-script-text][data-quran-refs]')
					? node
					: node.querySelector && node.querySelector('[data-quran-script-text][data-quran-ref], [data-quran-script-text][data-quran-refs]');
				if (!marked || marked.getAttribute('data-quran-script-applied') === document.body.dataset.quranScript)
					return;
				var root = node.closest && node.closest('.quran-tafsirs, .quran-share-root, .quran-ayah-hero, .bookmark-list, [data-quran-infinite-page], [data-random-toc-item]');
				pendingRoots.add(root || node);
			});
		});
		if (!scheduled && pendingRoots.size > 0) {
			scheduled = true;
			window.setTimeout(flush, 0);
		}
	}).observe(document.body, { childList: true, subtree: true });
}

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
		var script = document.body.dataset.quranScript || 'uthmani';
		if (script !== 'uthmani') {
			var scriptUrl = new URL(url, window.location.origin);
			scriptUrl.searchParams.set('script', script);
			url = `${scriptUrl.pathname}${scriptUrl.search}`;
		}
		quranCorpusPayloadCache[url] = quranCorpusPayloadCache[url] || fetch(quranApiPath(url), {
			credentials: 'same-origin',
			headers: { 'Accept': 'application/json' }
		}).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load Quran corpus words');
			return response.json();
		});
		quranCorpusPayloadCache[url]
			.then(function (payload) {
				annotateQuranCorpusWords(container, payload.wordsByAyah || {}, payload.juzStartsByAyah || {});
			})
			.catch(function () {
				container.removeData('quranCorpusBound');
			});
	});
}

function annotateQuranCorpusWords(container, wordsByAyah, juzStartsByAyah) {
	container.find('[data-quran-ref]').each(function () {
		var target = $(this);
		if (target.data('quranCorpusAnnotated'))
			return;
		var ref = target.attr('data-quran-ref');
		var words = wordsByAyah[ref];
		if (!words || words.length < 1)
			return;
		annotateExistingQuranText(target[0], words);
		var juzStart = (juzStartsByAyah || {})[ref];
		if (juzStart) {
			var juzWords = target.find('.quran-corpus-word').slice(0, Number(juzStart.wordCount) || 1);
			juzWords
				.addClass('quran-juz-start-word')
				.attr('data-quran-juz', juzStart.num || '')
				.attr('title', 'Beginning of Juz ' + (juzStart.num || ''));
			juzWords.first().addClass('quran-juz-start-first-word');
		}
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
		if (node.nodeType !== 1 || $(node).is('.quran-corpus-word, .quran-ayah-end-marker, .quran-ayah-number-marker'))
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
	var tooltipTargetSelector = '.quran-corpus-word, .book-carousel-tooltip, .tafsir-book-tooltip, .settings-book-tooltip, .tafsir-size-tooltip';
	var tooltipText = function (word) {
		return word.attr('data-quran-word-translation') || word.attr('data-book-tooltip') || word.attr('data-tafsir-tooltip') || word.attr('data-settings-book-tooltip') || word.attr('data-tafsir-size-tooltip') || '';
	};
	var isCarouselTooltipTarget = function (word) {
		return word.hasClass('book-carousel-tooltip') || word.hasClass('tafsir-book-tooltip') || word.hasClass('settings-book-tooltip') || word.hasClass('tafsir-size-tooltip');
	};
	var mobileCarouselTooltipsDisabled = function () {
		return window.matchMedia('(max-width: 767.98px), (hover: none), (pointer: coarse)').matches;
	};
	var hideTooltip = function (word) {
		window.clearTimeout(word.data('quranCorpusTooltipTimer'));
		word.removeData('quranCorpusTooltipTimer');
		word.removeClass('quran-corpus-word-tooltip-ready book-carousel-tooltip-ready tafsir-book-tooltip-ready settings-book-tooltip-ready tafsir-size-tooltip-ready');
		tooltip.attr('hidden', true).text('').removeData('quranCorpusTooltipTarget');
	};
	var showTooltipNow = function (word) {
		var text = tooltipText(word);
		if (!text)
			return;
		var rect = word[0].getBoundingClientRect();
		tooltip.text(text).removeAttr('hidden').data('quranCorpusTooltipTarget', word[0]);
		var tooltipRect = tooltip[0].getBoundingClientRect();
		var left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
		left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
		var top = rect.top - tooltipRect.height - 8;
		if (top < 8)
			top = rect.bottom + 8;
		tooltip.css({ left: left + 'px', top: top + 'px' });
		if (word.hasClass('settings-book-tooltip'))
			word.addClass('settings-book-tooltip-ready');
		else if (word.hasClass('tafsir-size-tooltip'))
			word.addClass('tafsir-size-tooltip-ready');
		else
			word.addClass(isCarouselTooltipTarget(word) ? 'book-carousel-tooltip-ready' : 'quran-corpus-word-tooltip-ready');
	};
	var showTooltip = function (word, delay) {
		if (isCarouselTooltipTarget(word) && mobileCarouselTooltipsDisabled()) {
			hideTooltip(word);
			return;
		}
		window.clearTimeout(word.data('quranCorpusTooltipTimer'));
		word.data('quranCorpusTooltipTimer', window.setTimeout(function () {
			showTooltipNow(word);
		}, delay));
	};
	eventRoot.on('quranRevealedWordTranslation', function (event) {
		var detail = event.originalEvent && event.originalEvent.detail || {};
		var target = detail.target;
		if (detail.action === 'hide') {
			var activeTarget = tooltip.data('quranCorpusTooltipTarget');
			if (!target || activeTarget === target) hideTooltip($(target || activeTarget || []));
			return;
		}
		if (!target || !target.matches || !target.matches('.quran-corpus-word[data-quran-word-translation]')) return;
		var activeTarget = tooltip.data('quranCorpusTooltipTarget');
		if (activeTarget && activeTarget !== target) hideTooltip($(activeTarget));
		showTooltip($(target), 0);
	});
	eventRoot.on('mouseenter focusin', tooltipTargetSelector, function () {
		var memorizePage = $(this).closest('[data-quran-memorize-page]');
		var revealedInMemorize = !memorizePage.length
			|| memorizePage.hasClass('quran-memorize-show-all')
			|| $(this).hasClass('quran-memorize-word-revealed')
			|| $(this).hasClass('quran-memorize-ayah-revealed')
			|| $(this).hasClass('quran-review-session-revealed');
		if (!revealedInMemorize) {
			hideTooltip($(this));
			return;
		}
		showTooltip($(this), 750);
	});
	eventRoot.on('click', '.quran-corpus-word', function (event) {
		if ($(this).closest('[data-quran-memorize-page]').length)
			return;
		if ($(this).closest('[contenteditable="true"], ._e').length)
			return;
		event.preventDefault();
		event.stopPropagation();
		if (tooltip.data('quranCorpusTooltipTarget') === this && !tooltip.is('[hidden]')) {
			hideTooltip($(this));
			this.blur();
			return;
		}
		try {
			this.focus({ preventScroll: true });
		} catch (err) {
			this.focus();
		}
		showTooltip($(this), 0);
	});
	eventRoot.on('mouseleave focusout', tooltipTargetSelector, function () {
		hideTooltip($(this));
	});
	$(window).on('scroll resize', function () {
		tooltip.attr('hidden', true).text('');
	});
}

function quranSelectedAyahHeroForToolbar(toolbar) {
	var container = toolbar && toolbar.closest('[data-quran-infinite-page="1"]');
	if (!container)
		container = toolbar && toolbar.closest('[data-quran-infinite-passage="1"]');
	return container
		? container.querySelector('[data-quran-selected-ayah-hero]')
		: document.querySelector('[data-quran-selected-ayah-hero]');
}

function quranSelectedAyahHeroIsDisplayed(hero) {
	return !!(hero && hero.querySelector('.quran-ayah-hero'));
}

function updateQuranAyahSelectingBodyClass() {
	$('body').toggleClass('quran-ayah-selecting', $('.quran-ayah-select-toolbar').filter(function () {
		return $(this).data('selecting') === true;
	}).length > 0);
}

function syncQuranAyahSelectorHeroState(root) {
	var scope = root || document;
	var toolbars = $(scope).is('.quran-ayah-select-toolbar')
		? $(scope)
		: $(scope).find('.quran-ayah-select-toolbar');
	toolbars.each(function () {
		var toolbar = $(this);
		var hero = quranSelectedAyahHeroForToolbar(this);
		var hasHero = quranSelectedAyahHeroIsDisplayed(hero);
		var toggleButton = toolbar.find('.quran-ayah-select-toggle');
		var openButton = toolbar.find('.quran-ayah-select-open');
		var clearButton = toolbar.find('.quran-ayah-select-clear');
		toolbar.toggleClass('has-selected-ayah-hero', hasHero);
		if (!hasHero) {
			if (toolbar.data('selecting') !== true) {
				toggleButton.prop('hidden', false);
				openButton.prop('hidden', true);
				clearButton.prop('hidden', true);
			}
			return;
		}
		var selected = toolbar.data('selected');
		if (selected && selected.clear)
			selected.clear();
		var passageScope = this.closest('[data-quran-infinite-page="1"], [data-quran-infinite-passage="1"]') || document;
		$(passageScope).find('.ayah-multi-selected').removeClass('ayah-multi-selected');
		toolbar.data('selecting', false).removeClass('is-selecting');
		toggleButton.prop('hidden', true).removeClass('btn-secondary').addClass('btn-outline-secondary');
		openButton.prop({ hidden: true, disabled: true });
		clearButton.prop('hidden', false);
		if (clearButton.is('button'))
			clearButton.prop('disabled', false);
		else if (hero && hero.getAttribute('data-quran-clear-href'))
			clearButton.attr('href', hero.getAttribute('data-quran-clear-href'));
		toolbar.find('.quran-ayah-select-live').text('');
	});
	updateQuranAyahSelectingBodyClass();
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
			if (quranSelectedAyahHeroIsDisplayed(quranSelectedAyahHeroForToolbar(toolbar[0]))) {
				syncQuranAyahSelectorHeroState(toolbar[0]);
				return;
			}
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
			if (enabled && quranSelectedAyahHeroIsDisplayed(quranSelectedAyahHeroForToolbar(toolbar[0]))) {
				syncQuranAyahSelectorHeroState(toolbar[0]);
				return;
			}
			$('.quran-ayah-select-toolbar').not(toolbar).data('selecting', false).removeClass('is-selecting')
				.find('.quran-ayah-select-toggle').removeClass('btn-secondary').addClass('btn-outline-secondary');
			selecting = enabled;
			toolbar.data('selecting', selecting);
			toolbar.toggleClass('is-selecting', selecting);
			toggleButton.toggleClass('btn-secondary', selecting);
			toggleButton.toggleClass('btn-outline-secondary', !selecting);
			openButton.prop('hidden', !selecting);
			clearButton.prop('hidden', !selecting);
			updateQuranAyahSelectingBodyClass();
		};

		toggleButton.on('click', function () {
			setSelecting(!selecting);
		});
		if (clearButton.is('button')) {
			clearButton.on('click', function () {
				if (toolbar.hasClass('has-selected-ayah-hero'))
					return;
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
	syncQuranAyahSelectorHeroState(scope);
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
				href = $('.quran-ayah-hero-prev').first().attr('href') || $('.mobile-bottom-nav a[rel="prev"]').first().attr('href') || $('.pagination a[rel="prev"]').first().attr('href');
			else if (event.key === 'ArrowRight' || event.key === 'BrowserForward')
				href = $('.quran-ayah-hero-next').first().attr('href') || $('.mobile-bottom-nav a[rel="next"]').first().attr('href') || $('.pagination a[rel="next"]').first().attr('href');
			else if (event.key === 'ArrowUp')
				href = $('.mobile-bottom-nav a[rel="prev"]').first().attr('href') || $('.pagination a[rel="prev"]').first().attr('href');
			else if (event.key === 'ArrowDown')
				href = $('.mobile-bottom-nav a[rel="next"]').first().attr('href') || $('.pagination a[rel="next"]').first().attr('href');
			else
				return;
			if (!href)
				return;
			event.preventDefault();
			window.location.href = href;
		});
	}

	function normalizeBookCarouselFilterText(value) {
		return (value || '').toString()
			.normalize('NFD')
			.replace(/[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
			.replace(/[أإآٱ]/g, 'ا')
			.replace(/ى/g, 'ي')
			.replace(/ة/g, 'ه')
			.toLocaleLowerCase()
			.replace(/\s+/g, ' ')
			.trim();
	}

	function applyBookCarouselFilter(filter) {
		var menu = filter.closest('.h-menu');
		var query = normalizeBookCarouselFilterText(filter.find('.book-carousel-filter-input').val());
		var items = menu.children('[data-book-carousel-item]');
		items.each(function () {
			var item = $(this);
			var searchableText = item.attr('data-book-carousel-search') || item.text();
			item.toggleClass('book-carousel-filter-hidden', !!query && !normalizeBookCarouselFilterText(searchableText).includes(query));
		});
		var availableCount = items.filter(function () {
			return !$(this).hasClass('d-none') && !$(this).hasClass('book-carousel-filter-hidden');
		}).length;
		filter.find('[data-book-carousel-filter-status]').text(query
			? `${availableCount} ${availableCount === 1 ? 'book' : 'books'} found`
			: '');
	}

	function initBookCarouselFilters(root) {
		var scope = root || document;
		$(scope).find('[data-book-carousel-filter]').each(function () {
			var filter = $(this);
			if (filter.data('bookCarouselFilterBound'))
				return;
			filter.data('bookCarouselFilterBound', true);
			filter.on('input search', '.book-carousel-filter-input', function () {
				setDirection($(this));
				applyBookCarouselFilter(filter);
			});
			applyBookCarouselFilter(filter);
		});
	}

	function initTafsirBookCarousels(root) {
		var scope = root || document;
		$(scope).find('.h-menu [data-tafsir-book-nav-item]').closest('.h-menu').each(function () {
			var menu = $(this);
			prepareTafsirBookCarousel(menu);
			applyTafsirBookCarouselSettings(menu);
		});
		bindTafsirBookCarouselRefresh();
	}

	function prepareTafsirBookCarousel(menu) {
		if (menu.data('tafsirBookCarouselBound'))
			return;
		menu.data('tafsirBookCarouselBound', true);
		menu.children('[data-tafsir-book-nav-item]').each(function (index) {
			$(this).data('tafsirBookOriginalIndex', index);
		});
	}

	function tafsirBookCarouselEntries(menu) {
		return menu.children('[data-tafsir-book-nav-item]').map(function () {
			var item = $(this);
			return {
				item: item,
				book: {
					alias: item.attr('data-tafsir-alias') || '',
					lang: item.attr('data-tafsir-lang') || '',
					death: item.attr('data-tafsir-death') || '',
					ordinal: Number(item.attr('data-tafsir-ordinal') || 0)
				},
				label: item.text().trim(),
				originalIndex: item.data('tafsirBookOriginalIndex') || 0
			};
		}).get();
	}

	function applyTafsirBookCarouselSettings(menu) {
		getQuranTafsirSettings().then(function (settings) {
			var usePersonalizedTafsirs = settings && settings.personalized === true;
			var tafsirs = usePersonalizedTafsirs ? ((settings || {}).tafsirs || {}) : {};
			var disabledAliases = new Set(Array.isArray(tafsirs.disabledAliases) ? tafsirs.disabledAliases : []);
			var entries = tafsirBookCarouselEntries(menu);
			entries.sort(compareTafsirAlphabeticalEntries).forEach(function (entry) {
				var alias = entry.book.alias || '';
				entry.item.toggleClass('d-none', disabledAliases.has(alias));
				menu.append(entry.item);
			});
			menu.closest('.h-menu-wrap').toggleClass('d-none', menu.children('[data-tafsir-book-nav-item]:not(.d-none)').length < 1);
		});
	}

	function refreshTafsirBookCarousels(root) {
		var scope = root || document;
		$(scope).find('.h-menu [data-tafsir-book-nav-item]').closest('.h-menu').each(function () {
			applyTafsirBookCarouselSettings($(this));
		});
	}

		function bindTafsirBookCarouselRefresh() {
			if ($(document).data('tafsirBookCarouselRefreshBound'))
				return;
			$(document).data('tafsirBookCarouselRefreshBound', true);
			$(document).on('hadithAuthChanged bookmarkSettingsLoaded', function () {
				refreshTafsirBookCarousels(document);
			});
		}

		function initQuranCommentaryTocNavigation(root) {
			var scope = root || document;
			$(scope).find('[data-quran-commentary-carousel], [data-quran-commentary-pagination]').each(function () {
				var element = $(this);
				if (element.data('quranCommentaryTocNavigationBound'))
					return;
				element.data('quranCommentaryTocNavigationBound', true);
			});
			applyQuranCommentaryTocNavigation(scope);
			bindQuranCommentaryTocNavigationRefresh();
		}

		function quranCommentaryEntryFromItem(item, index) {
			return {
				item: item,
				book: {
					alias: item.attr('data-commentary-alias') || '',
					kind: item.attr('data-commentary-kind') || '',
					lang: item.attr('data-commentary-lang') || '',
					source: item.attr('data-commentary-source') || '',
					death: item.attr('data-commentary-death') || '',
					ordinal: Number(item.attr('data-commentary-ordinal') || 0)
				},
				href: item.attr('data-commentary-href') || item.attr('href') || '',
				label: item.attr('data-commentary-label') || item.text().trim(),
				originalIndex: Number(item.attr('data-commentary-original-index') || index || 0)
			};
		}

		function quranCommentaryEntryIsCurrent(entry, currentAlias, currentLang) {
			if (!entry || !entry.book || entry.book.alias !== currentAlias)
				return false;
			return !currentLang || !entry.book.lang || entry.book.lang === currentLang;
		}

		function quranCommentaryOrderedEntries(entries, settings, currentAlias, currentLang) {
			settings = settings || {};
			var personalized = settings.personalized === true;
			var firstEntry = entries[0];
			var kind = firstEntry && firstEntry.book ? firstEntry.book.kind : '';
			if (kind === 'tafsir') {
				var tafsirs = personalized && settings.tafsirs && typeof settings.tafsirs === 'object' && !Array.isArray(settings.tafsirs) ? settings.tafsirs : {};
				var tafsirDisabled = new Set(Array.isArray(tafsirs.disabledAliases) ? tafsirs.disabledAliases : []);
				return entries.filter(function (entry) {
					return !tafsirDisabled.has(entry.book.alias) || quranCommentaryEntryIsCurrent(entry, currentAlias, currentLang);
				}).sort(compareTafsirAlphabeticalEntries);
			}
			if (kind === 'trans') {
				var translations = personalized && settings.translations && typeof settings.translations === 'object' && !Array.isArray(settings.translations) ? settings.translations : {};
				var translationDisabled = new Set(Array.isArray(translations.disabledAliases) ? translations.disabledAliases : []);
				var translationOrder = Array.isArray(translations.order) ? translations.order : [];
				var orderIndex = new Map(translationOrder.map(function (alias, index) { return [alias, index]; }));
				return entries.filter(function (entry) {
					return !translationDisabled.has(entry.book.alias) || quranCommentaryEntryIsCurrent(entry, currentAlias, currentLang);
				}).sort(function (a, b) {
					if (!personalized)
						return (a.originalIndex || 0) - (b.originalIndex || 0);
					var aDefault = a.book.source === 'default';
					var bDefault = b.book.source === 'default';
					if (aDefault !== bDefault)
						return aDefault ? -1 : 1;
					var aIndex = orderIndex.has(a.book.alias) ? orderIndex.get(a.book.alias) : Number.MAX_SAFE_INTEGER;
					var bIndex = orderIndex.has(b.book.alias) ? orderIndex.get(b.book.alias) : Number.MAX_SAFE_INTEGER;
					if (aIndex !== bIndex)
						return aIndex - bIndex;
					var ordinal = Number(a.book.ordinal || 0) - Number(b.book.ordinal || 0);
					if (ordinal !== 0)
						return ordinal;
					return (a.originalIndex || 0) - (b.originalIndex || 0);
				});
			}
			return entries;
		}

		function renderQuranCommentaryPaginationLink(slot, entry, rel) {
			slot.empty();
			if (!entry)
				return;
			var link = $('<a>').addClass('pagination-nav-link').attr({ href: entry.href, rel: rel });
			if (rel === 'prev') {
				$('<span>').addClass('pagination-nav-chevron bi bi-chevron-left').attr('aria-hidden', 'true').appendTo(link);
				$('<span>').addClass('pagination-nav-label').append(document.createTextNode(`\u00a0Prev:\u00a0${entry.label}`)).appendTo(link);
			} else {
				$('<span>').addClass('pagination-nav-label').append(document.createTextNode(`Next:\u00a0${entry.label}\u00a0`)).appendTo(link);
				$('<span>').addClass('pagination-nav-chevron bi bi-chevron-right').attr('aria-hidden', 'true').appendTo(link);
			}
			slot.append(link);
		}

		function renderQuranCommentaryMobilePagination(entry, rel) {
			var attr = rel === 'prev' ? 'data-mobile-bottom-nav-prev' : 'data-mobile-bottom-nav-next';
			var current = $(`[${attr}]`).first();
			if (!current.length)
				return;
			var replacement;
			if (entry) {
				replacement = $('<a>').addClass('mobile-bottom-nav-item').attr({
					href: entry.href,
					rel: rel,
					title: `${rel === 'prev' ? 'Previous' : 'Next'}: ${entry.label}`,
					'aria-label': rel === 'prev' ? 'Previous' : 'Next'
				});
				replacement.attr(attr, '');
			} else {
				replacement = $('<span>').addClass('mobile-bottom-nav-item mobile-bottom-nav-item-disabled').attr('aria-disabled', 'true');
				replacement.attr(attr, '');
			}
			$('<span>').addClass(`bi bi-chevron-${rel === 'prev' ? 'left' : 'right'} mobile-bottom-nav-icon`).attr('aria-hidden', 'true').appendTo(replacement);
			$('<span>').addClass('mobile-bottom-nav-label').text(rel === 'prev' ? 'Prev' : 'Next').appendTo(replacement);
			current.replaceWith(replacement);

			var headLink = $(`head link[rel="${rel}"]`);
			if (entry) {
				if (headLink.length)
					headLink.attr('href', entry.href);
				else
					$('<link>').attr({ rel: rel, href: entry.href }).appendTo('head');
			} else {
				headLink.remove();
			}
		}

		function scrollQuranCommentaryCarouselToCurrent(carousel) {
			var menu = carousel.find('.h-menu').get(0);
			var current = carousel.find('[data-quran-commentary-book-nav-item].active:not(.d-none):not(.book-carousel-filter-hidden), [data-quran-commentary-book-nav-item][aria-current="page"]:not(.d-none):not(.book-carousel-filter-hidden)').get(0);
			if (!menu || !current)
				return;
			window.requestAnimationFrame(function () {
				var targetLeft = current.offsetLeft - ((menu.clientWidth - current.offsetWidth) / 2);
				menu.scrollLeft = Math.max(0, targetLeft);
			});
		}

		function applyQuranCommentaryTocNavigation(root) {
			var scope = root || document;
			getQuranTafsirSettings().then(function (settings) {
				$(scope).find('[data-quran-commentary-carousel]').each(function () {
					var carousel = $(this);
					var kind = carousel.attr('data-commentary-kind') || '';
					var currentAlias = carousel.attr('data-current-commentary-alias') || '';
					var currentLang = carousel.attr('data-current-commentary-lang') || '';
					var entries = carousel.find('[data-quran-commentary-book-nav-item]').map(function (index) {
						return quranCommentaryEntryFromItem($(this), index);
					}).get();
					var orderedEntries = quranCommentaryOrderedEntries(entries, settings, currentAlias, currentLang);
					var currentIndex = orderedEntries.findIndex(function (entry) {
						return quranCommentaryEntryIsCurrent(entry, currentAlias, currentLang);
					});
					var previousEntry = currentIndex > 0 ? orderedEntries[currentIndex - 1] : null;
					var nextEntry = currentIndex >= 0 && currentIndex < orderedEntries.length - 1 ? orderedEntries[currentIndex + 1] : null;
					var visibleAliases = new Set(orderedEntries.map(function (entry) { return entry.book.alias; }));
					entries.forEach(function (entry) {
						var isCurrent = quranCommentaryEntryIsCurrent(entry, currentAlias, currentLang);
						entry.item.toggleClass('d-none', !visibleAliases.has(entry.book.alias));
						entry.item.toggleClass('active', isCurrent);
						if (isCurrent)
							entry.item.attr('aria-current', 'page');
						else
							entry.item.removeAttr('aria-current');
					});
					orderedEntries.forEach(function (entry) {
						carousel.find('.h-menu').append(entry.item);
					});
					carousel.toggleClass('d-none', orderedEntries.length < 1);
					scrollQuranCommentaryCarouselToCurrent(carousel);
					renderQuranCommentaryMobilePagination(previousEntry, 'prev');
					renderQuranCommentaryMobilePagination(nextEntry, 'next');
					$(`[data-quran-commentary-pagination][data-commentary-kind="${kind}"]`).each(function () {
						var pagination = $(this);
						var paginationCurrentAlias = pagination.attr('data-current-commentary-alias') || '';
						var paginationCurrentLang = pagination.attr('data-current-commentary-lang') || '';
						var paginationCurrentIndex = orderedEntries.findIndex(function (entry) {
							return quranCommentaryEntryIsCurrent(entry, paginationCurrentAlias, paginationCurrentLang);
						});
						renderQuranCommentaryPaginationLink(pagination.find('[data-quran-commentary-prev-slot]').first(), paginationCurrentIndex > 0 ? orderedEntries[paginationCurrentIndex - 1] : null, 'prev');
						renderQuranCommentaryPaginationLink(pagination.find('[data-quran-commentary-next-slot]').first(), paginationCurrentIndex >= 0 && paginationCurrentIndex < orderedEntries.length - 1 ? orderedEntries[paginationCurrentIndex + 1] : null, 'next');
					});
				});
			});
		}

		function bindQuranCommentaryTocNavigationRefresh() {
			if ($(document).data('quranCommentaryTocNavigationRefreshBound'))
				return;
			$(document).data('quranCommentaryTocNavigationRefreshBound', true);
			$(document).on('hadithAuthChanged bookmarkSettingsLoaded', function () {
				applyQuranCommentaryTocNavigation(document);
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
				window.location.href = searchAutocompleteDestination($input, activeItem);
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
				$.getJSON(searchAutocompletePath($input), buildSearchAutocompleteParams($input, request.term))
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
					window.location.href = searchAutocompleteDestination($input, ui.item);
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
			if (Array.isArray(item.metadata_lines) && item.metadata_lines.length) {
				var $meta = $('<div>').addClass('search-autocomplete-meta search-autocomplete-meta-lines');
				item.metadata_lines.forEach(function (line) {
					if (!line || !line.text)
						return;
					var lineLang = line.lang === 'ar' ? 'ar' : 'en';
					$('<span>')
						.addClass(lineLang === 'ar' ? 'search-autocomplete-meta-ar' : 'search-autocomplete-meta-en')
						.attr(lineLang === 'ar' ? { lang: 'ar', dir: 'rtl' } : { lang: 'en', dir: 'ltr' })
						.text(line.text)
						.appendTo($meta);
				});
				$meta.appendTo($row);
			} else if (item.metadata_en || item.metadata_ar) {
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
					window.location.href = searchAutocompleteDestination($input, item);
				});
			}
			return $item.append($row).appendTo(ul);
		};
	});
}

function searchAutocompleteDestination($input, item) {
	if (!item.is_quran)
		return hadithUrl(item.url);
	var url = item.url.toString();
	if ($input.closest('form').find('input[name="mode"][value="mushaf"]').length)
		url += `${url.includes('?') ? '&' : '?'}mushaf`;
	return quranUrl(url);
}

function buildSearchAutocompleteParams($input, term) {
	var params = [
		{ name: 'q', value: term },
		{ name: 'limit', value: 10 }
	];
	quranSearchBookFilterParams($input.closest('form'), isQuranSearchInput($input)).forEach(function (field) {
		params.push(field);
	});
	$input.closest('form').find('input[name=tafsir]:checked').each(function () {
		params.push({ name: 'tafsir', value: this.value });
	});
	return $.param(params);
}

function searchAutocompletePath($input) {
	return isQuranSearchInput($input) ? '/quran/api/autocomplete' : '/api/autocomplete';
}

function isQuranSearchInput($input) {
	if ($input.hasClass('quran-passage-search'))
		return true;
	return isQuranSearchForm($input.closest('form'));
}

function isQuranSearchForm($form) {
	var action = ($form.attr('action') || '').toString();
	if (!action)
		return false;
	try {
		return new URL(action, window.location.origin).pathname === '/quran';
	} catch (err) {
		return action.split('?')[0] === '/quran';
	}
}

function submitQuranPassageSearch($input) {
	var term = ($input.val() || '').trim();
	if (!term)
		return false;
	$input.autocomplete('close');
	var searchPath = '/quran';
	var params = [{ name: 'q', value: term }];
	params.push({ name: 'mode', value: 'study' });
	var $form = $input.closest('form');
	var $tafsirFilters = $form.find('input[name=tafsir]:checked');
	if ($tafsirFilters.length > 0) {
		params.push({ name: 'b', value: 'tafsir' });
		$tafsirFilters.each(function () {
			params.push({ name: 'tafsir', value: this.value });
		});
	} else {
		quranSearchBookFilterParams($form, true).forEach(function (field) {
			params.push(field);
		});
	}
	window.location.href = `${searchPath}?${$.param(params)}`;
	return true;
}

function initQuranSearchReturnMode() {
	var path = window.location.pathname;
	var requestedMode = new URLSearchParams(window.location.search).get('mode');
	var mode = requestedMode === 'mushaf' || requestedMode === 'study' ? requestedMode : '';
	if (/^\/quran\/page(?:\/\d+)?$/.test(path) || path === '/quran/review')
		mode = 'mushaf';
	else if (/^\/quran\/\d+(?:\/|$)/.test(path))
		mode = 'study';
	if (!mode)
		return;
	document.querySelectorAll('form').forEach(function (form) {
		var action = form.getAttribute('action') || '';
		if (new URL(action || window.location.href, window.location.origin).pathname !== '/quran')
			return;
		var input = form.querySelector('input[name="mode"]');
		if (!input) {
			input = document.createElement('input');
			input.type = 'hidden';
			input.name = 'mode';
			form.appendChild(input);
		}
		input.value = mode;
	});
}

function quranSearchBookFilterParams($form, useQuranDefaults) {
	var params = [];
	var $filters = $form.find('input[name=b]').filter(function () {
		return this.type === 'hidden' || this.checked;
	});
	$filters.each(function () {
		params.push({ name: 'b', value: this.value });
	});
	if (useQuranDefaults && params.length < 1) {
		params.push({ name: 'b', value: 'quran' });
		params.push({ name: 'b', value: 'tafsir' });
	}
	return params;
}

function initTafsirSearchFilterPills(root) {
	var $root = $(root || document);
	$root.find('[data-search-filter-toggle], .quran-passage-filter-toggle').each(function () {
		updateSearchFilterIcon($(this).closest('form'));
	});
	if ($(document).data('tafsirSearchFilterPillsBound'))
		return;
	$(document).data('tafsirSearchFilterPillsBound', true);
	$(document).on('change', 'input[name=tafsir], select[name=tafsir], input[name=b]', function () {
		updateSearchFilterIcon($(this).closest('form'));
	});
	$(document).on('click', '[data-tafsir-filter-clear]', function (event) {
		event.preventDefault();
		event.stopPropagation();
		var $container = $(this).closest('.quran-tafsir-search-filter, .px-3, form');
		var $checks = $container.find('input[name=tafsir]');
		if (!$checks.length)
			return;
		$checks.prop('checked', false).trigger('change');
		var form = $checks.closest('form')[0];
		if (form && $(form).find('input[name=q]').val()) {
			navigateSearchFormWithoutEmptyTafsir($(form));
		}
	});
	$(document).on('click', '[data-search-filter-remove]', function (event) {
		event.preventDefault();
		var param = this.dataset.filterParam || '';
		var value = this.dataset.filterValue || '';
		var url = new URL(window.location.href);
		var params = url.searchParams;
		if (param === 'b') {
			var remainingFilters = [];
			var removeValue = normalizeSearchBookFilterValue(value);
			params.getAll('b').forEach(function (filterValue) {
				filterValue.toString().split(',').forEach(function (filter) {
					filter = filter.trim();
					expandSearchBookFilterValue(filter).forEach(function (expandedFilter) {
						if (expandedFilter && normalizeSearchBookFilterValue(expandedFilter) !== removeValue)
							remainingFilters.push(expandedFilter);
					});
				});
			});
			params.delete('b');
			Array.from(new Set(remainingFilters)).forEach(function (filter) {
				params.append('b', filter);
			});
			if (this.dataset.removeTafsir === '1')
				params.delete('tafsir');
		} else if (param === 'tafsir') {
			var remainingTafsirs = params.getAll('tafsir').filter(function (filterValue) {
				return filterValue !== value;
			});
			params.delete('tafsir');
			remainingTafsirs.forEach(function (filter) {
				params.append('tafsir', filter);
			});
		} else if (param) {
			params.delete(param);
		}
		params.delete('o');
		window.location.href = `${url.pathname}${url.search}${url.hash}`;
	});
}

function normalizeSearchBookFilterValue(value) {
	value = (value || '').toString().trim();
	return value === 'tafsir' ? 'commentaries' : value;
}

function expandSearchBookFilterValue(value) {
	value = normalizeSearchBookFilterValue(value);
	if (value === 'sahihayn')
		return ['bukhari', 'muslim'];
	if (value === 'kutubarbaah')
		return ['abudawud', 'tirmidhi', 'nasai', 'ibnmajah'];
	if (value === 'sixbooks')
		return ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'];
	return value ? [value] : [];
}

function navigateSearchFormWithoutEmptyTafsir($form) {
	var params = [];
	$form.serializeArray().forEach(function (field) {
		params.push(field);
	});
	var action = $form.attr('action') || window.location.pathname;
	window.location.href = `${action}?${$.param(params)}`;
}

function updateSearchFilterIcon($form) {
	var activeFilterCount = searchFilterCount($form);
	var active = activeFilterCount > 0;
	$form.find('[data-search-filter-count]').each(function () {
		$(this).toggleClass('d-none', !active).text(activeFilterCount);
	});
	$form.find('[data-search-filter-toggle] .search-filter-icon-wrap .bi').each(function () {
		$(this).toggleClass('d-none', active);
		this.classList.toggle('bi-book-fill', false);
		this.classList.toggle('bi-book', true);
	});
}

function searchFilterCount($form) {
	var activeFilters = [];
	$form.find('input[name=b]').each(function () {
		if ((this.type === 'hidden' || this.checked) && (this.value || '').trim())
			activeFilters.push(`b:${normalizeSearchBookFilterValue(this.value)}`);
	});
	$form.find('input[name=tafsir]').each(function () {
		if (this.checked && (this.value || '').trim())
			activeFilters.push(`tafsir:${this.value}`);
	});
	$form.find('select[name=tafsir]').each(function () {
		var value = ($(this).val() || '').toString().trim();
		if (value)
			activeFilters.push(`tafsir:${value}`);
	});
	return Array.from(new Set(activeFilters)).length;
}

function initDropdownFilterSearch(root) {
	var $root = $(root || document);
	$root.find('[data-filter-list-search]').each(function () {
		applyDropdownFilterSearch($(this).find('input').first());
	});
	if ($(document).data('dropdownFilterSearchBound'))
		return;
	$(document).data('dropdownFilterSearchBound', true);
	$(document).on('click keydown', '[data-filter-list-search] input', function (event) {
		event.stopPropagation();
	});
	$(document).on('input', '[data-filter-list-search] input', function () {
		applyDropdownFilterSearch($(this));
	});
	$(document).on('reset', 'form', function () {
		var form = this;
		window.setTimeout(function () {
			$(form).find('[data-filter-list-search] input').each(function () {
				applyDropdownFilterSearch($(this));
			});
		}, 0);
	});
}

function applyDropdownFilterSearch($input) {
	if (!$input || !$input.length)
		return;
	var query = normalizeDropdownFilterText($input.val());
	var $menu = $input.closest('.dropdown-menu');
	var $rows = $menu.find('.form-check').filter(function () {
		return $(this).prevAll('[data-filter-list-search]').length > 0;
	});
	$rows.each(function () {
		var $row = $(this);
		var haystack = normalizeDropdownFilterText([
			$row.find('.form-check-label').text(),
			$row.find('input').val()
		].join(' '));
		$row.toggleClass('d-none', query !== '' && haystack.indexOf(query) < 0);
	});
}

function normalizeDropdownFilterText(value) {
	return (value || '').toString()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[ʿʾ'’`]/g, '')
		.replace(/[^a-z0-9]+/gi, ' ')
		.toLowerCase()
		.trim();
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
			if (form.dataset.tafsirNavigatorBase) {
				var target = form.dataset.tafsirNavigatorBase.endsWith(':')
					? `${form.dataset.tafsirNavigatorBase}${surah.num}:${ayah}`
					: `${form.dataset.tafsirNavigatorBase}/quran:${surah.num}:${ayah}`;
				if (form.dataset.tafsirNavigatorQuery)
					target += `?${form.dataset.tafsirNavigatorQuery}`;
				window.location.href = target;
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
		el.innerHTML = renderClientMarkdown(markdown);
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
	link.href = `https://www.google.com/search?q=site%3Adorar.net+${encodeURIComponent(query)}`;
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

var contentTranslationConfigPromise = null;
var preferredContentLanguagePromise = null;
var contentTranslationModalState = null;
var CONTENT_TRANSLATION_PENDING_CHECKOUT_KEY = 'hadithdb_pending_content_translation_checkout';
var contentTranslationAuthRefreshBound = false;
var contentTranslationAvailablePromises = {};
var contentTranslationAvailableObserver = null;
var contentTranslationCheckoutResumeInProgress = false;
var GLOBAL_CONTENT_LANGUAGE_KEY = 'hadithdb_content_language';
var CONTENT_TRANSLATION_SUPPORTED_LANGUAGE_CODES = new Set([
	'en', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'id', 'ur', 'de', 'ja', 'pcm', 'mr', 'te',
	'tr', 'ta', 'vi', 'yue', 'wuu', 'ko', 'fa', 'ha', 'th', 'gu', 'kn', 'it', 'pa', 'ml', 'he'
]);
var GLOBAL_CONTENT_LANGUAGE_DEFAULTS = Object.freeze([
	Object.freeze({ code: 'bn', label: 'Bengali', dir: 'ltr', script: 'Bengali', fontClass: 'content-language-bengali' }),
	Object.freeze({ code: 'yue', label: 'Chinese (Cantonese)', dir: 'ltr', script: 'Han', fontClass: 'content-language-cjk' }),
	Object.freeze({ code: 'zh', label: 'Chinese (Mandarin)', dir: 'ltr', script: 'Han', fontClass: 'content-language-cjk' }),
	Object.freeze({ code: 'wuu', label: 'Chinese (Wu)', dir: 'ltr', script: 'Han', fontClass: 'content-language-cjk' }),
	Object.freeze({ code: 'en', label: 'English', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'fr', label: 'French', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'de', label: 'German', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'gu', label: 'Gujarati', dir: 'ltr', script: 'Gujarati', fontClass: 'content-language-gujarati' }),
	Object.freeze({ code: 'ha', label: 'Hausa', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'he', label: 'Hebrew', dir: 'rtl', script: 'Hebrew', fontClass: 'content-language-hebrew' }),
	Object.freeze({ code: 'hi', label: 'Hindi', dir: 'ltr', script: 'Devanagari', fontClass: 'content-language-devanagari' }),
	Object.freeze({ code: 'id', label: 'Indonesian', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'it', label: 'Italian', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'ja', label: 'Japanese', dir: 'ltr', script: 'Japanese', fontClass: 'content-language-japanese' }),
	Object.freeze({ code: 'kn', label: 'Kannada', dir: 'ltr', script: 'Kannada', fontClass: 'content-language-kannada' }),
	Object.freeze({ code: 'ko', label: 'Korean', dir: 'ltr', script: 'Hangul', fontClass: 'content-language-korean' }),
	Object.freeze({ code: 'ml', label: 'Malayalam', dir: 'ltr', script: 'Malayalam', fontClass: 'content-language-malayalam' }),
	Object.freeze({ code: 'mr', label: 'Marathi', dir: 'ltr', script: 'Devanagari', fontClass: 'content-language-devanagari' }),
	Object.freeze({ code: 'pcm', label: 'Nigerian Pidgin', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'fa', label: 'Persian', dir: 'rtl', script: 'Arabic', fontClass: 'content-language-persian' }),
	Object.freeze({ code: 'pt', label: 'Portuguese', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'pa', label: 'Punjabi', dir: 'ltr', script: 'Gurmukhi', fontClass: 'content-language-gurmukhi' }),
	Object.freeze({ code: 'ru', label: 'Russian', dir: 'ltr', script: 'Cyrillic', fontClass: 'content-language-cyrillic' }),
	Object.freeze({ code: 'es', label: 'Spanish', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'ta', label: 'Tamil', dir: 'ltr', script: 'Tamil', fontClass: 'content-language-tamil' }),
	Object.freeze({ code: 'te', label: 'Telugu', dir: 'ltr', script: 'Telugu', fontClass: 'content-language-telugu' }),
	Object.freeze({ code: 'th', label: 'Thai', dir: 'ltr', script: 'Thai', fontClass: 'content-language-thai' }),
	Object.freeze({ code: 'tr', label: 'Turkish', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }),
	Object.freeze({ code: 'ur', label: 'Urdu', dir: 'rtl', script: 'Arabic', fontClass: 'content-language-urdu' }),
	Object.freeze({ code: 'vi', label: 'Vietnamese', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' })
]);

function paymentFeatureEnabled() {
	return window.HADITH_PAYMENT_FEATURE_ENABLED === true;
}

function contentTranslationFeatureEnabled(itemType) {
	if (!paymentFeatureEnabled())
		return false;
	itemType = (itemType || '').toString().trim().toLowerCase();
	if (itemType === 'tafsir')
		return window.HADITH_TAFSIR_TRANSLATION_ENABLED !== false;
	return true;
}

function contentTranslationLanguageSort(a, b) {
	var aLabel = (a && (a.label || a.code) || '').toString();
	var bLabel = (b && (b.label || b.code) || '').toString();
	var labelCompare = aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
	if (labelCompare !== 0)
		return labelCompare;
	return (a && a.code || '').toString().localeCompare((b && b.code || '').toString());
}

function escapeClientMarkdownHtml(value) {
	return $('<div>').text(value || '').html();
}

function renderClientInlineMarkdownFallback(value) {
	return escapeClientMarkdownHtml(value)
		.replace(/`([^`\n]+)`/g, '<code>$1</code>')
		.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
		.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>')
		.replace(/(^|[^\*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
		.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="nofollow noopener" target="_blank">$1</a>');
}

function renderClientMarkdownFallback(value) {
	value = (value || '').toString().replace(/\r\n?/g, '\n').trim();
	if (!value)
		return '';
	return value.split(/\n{2,}/).map(function (block) {
		var lines = block.split('\n');
		if (lines.every(function (line) { return /^[ \t]*[-*+][ \t]+/.test(line); })) {
			return '<ul>' + lines.map(function (line) {
				return '<li>' + renderClientInlineMarkdownFallback(line.replace(/^[ \t]*[-*+][ \t]+/, '')) + '</li>';
			}).join('') + '</ul>';
		}
		if (lines.every(function (line) { return /^[ \t]*\d+\.[ \t]+/.test(line); })) {
			return '<ol>' + lines.map(function (line) {
				return '<li>' + renderClientInlineMarkdownFallback(line.replace(/^[ \t]*\d+\.[ \t]+/, '')) + '</li>';
			}).join('') + '</ol>';
		}
		return '<p>' + renderClientInlineMarkdownFallback(block).replace(/\n/g, '<br>') + '</p>';
	}).join('\n');
}

function normalizeClientMarkdownForRendering(value) {
	return (value || '').toString()
		.replace(/(^|[^\*])\*\*([ \t]+)(?=\S)/g, '$1$2**')
		.replace(/(^|[^\*])\*([ \t]+)(?=\S)/g, '$1$2*')
		.replace(/(^|[^_])__([ \t]+)(?=\S)/g, '$1$2__')
		.replace(/(^|[^_])_([ \t]+)(?=\S)/g, '$1$2_')
		.replace(/(^|[^\*])\*\*([^\n*]*?\S)([ \t]+)\*\*(?!\*)/g, '$1**$2**$3')
		.replace(/(^|[^\*])\*([^\n*]*?\S)([ \t]+)\*(?!\*)/g, '$1*$2*$3')
		.replace(/(^|[^_])__([^\n_]*?\S)([ \t]+)__(?!_)/g, '$1__$2__$3')
		.replace(/(^|[^_])_([^\n_]*?\S)([ \t]+)_(?!_)/g, '$1_$2_$3');
}

function renderClientMarkdown(value) {
	value = normalizeClientMarkdownForRendering(value);
	if (!value)
		return '';
	if (window.marked && window.marked.parse)
		return window.marked.parse(value).replace(/<br>/g, '</p><p>').trim();
	return renderClientMarkdownFallback(value);
}

function normalizeGlobalContentLanguage(code) {
	code = (code || '').toString().trim().toLowerCase();
	if (!CONTENT_TRANSLATION_SUPPORTED_LANGUAGE_CODES.has(code) || code === 'ar')
		return 'en';
	return code;
}

function readGlobalContentLanguage() {
	try {
		return normalizeGlobalContentLanguage(window.sessionStorage && sessionStorage.getItem(GLOBAL_CONTENT_LANGUAGE_KEY) || 'en');
	} catch (_err) {
		return 'en';
	}
}

function writeGlobalContentLanguage(code) {
	try {
		if (window.sessionStorage)
			sessionStorage.setItem(GLOBAL_CONTENT_LANGUAGE_KEY, normalizeGlobalContentLanguage(code));
		if (window.localStorage)
			localStorage.removeItem(GLOBAL_CONTENT_LANGUAGE_KEY);
	} catch (_err) {}
}

function hasStoredGlobalContentLanguage() {
	try {
		return !!(window.sessionStorage && sessionStorage.getItem(GLOBAL_CONTENT_LANGUAGE_KEY));
	} catch (_err) {
		return false;
	}
}

function resolveInitialGlobalContentLanguage() {
	if (hasStoredGlobalContentLanguage())
		return Promise.resolve(readGlobalContentLanguage());
	return preferredContentLanguage().then(function (language) {
		language = normalizeGlobalContentLanguage(language || 'en');
		writeGlobalContentLanguage(language);
		return language;
	});
}

function syncGlobalContentLanguageSelects(code) {
	code = normalizeGlobalContentLanguage(code);
	$('[data-global-content-language-dropdown="1"]').each(function () {
		var dropdown = $(this);
		dropdown.attr('data-global-content-language-current', code);
		dropdown.find('[data-global-content-language-button="1"]').text(code.toUpperCase());
		dropdown.find('[data-global-content-language-option]').each(function () {
			var option = $(this);
			var active = option.attr('data-global-content-language-option') === code;
			option.toggleClass('active', active).attr('aria-current', active ? 'true' : null);
		});
	});
}

function normalizeContentTranslationLanguages(languages) {
	var seen = new Set();
	return (Array.isArray(languages) ? languages : []).map(function (language) {
		if (!language || !language.code)
			return null;
		var code = language.code.toString().trim().toLowerCase();
		if (!CONTENT_TRANSLATION_SUPPORTED_LANGUAGE_CODES.has(code) || seen.has(code))
			return null;
		seen.add(code);
		return Object.assign({}, language, {
			code: code,
			label: (language.label || language.name || code.toUpperCase()).toString(),
			dir: language.dir === 'rtl' ? 'rtl' : 'ltr',
			fontClass: (language.fontClass || language.font_class || '').toString()
		});
	}).filter(Boolean).sort(contentTranslationLanguageSort);
}

function contentTranslationContentFromOption(translation) {
	var content = translation && translation.content;
	if (content && typeof content === 'object')
		return content;
	content = {};
	['title', 'chain', 'body', 'footnote', 'text', 'footnotes'].forEach(function (field) {
		if (translation && translation[field])
			content[field] = translation[field];
	});
	return content;
}

function normalizeAvailableContentTranslations(translations) {
	return normalizeContentTranslationLanguages(translations).map(function (translation) {
		var content = contentTranslationContentFromOption(translation);
		return Object.assign({}, translation, { content: content });
	}).filter(function (translation) {
		return translation && translation.code && translation.code !== 'ar' && translation.content && Object.values(translation.content).some(Boolean);
	});
}

function setContentLanguageAttributes(target, language, fallbackLanguage) {
	target = target && target.jquery ? target : $(target);
	if (!target.length)
		return;
	language = language || {};
	var code = (language.code || fallbackLanguage || '').toString().trim().toLowerCase();
	var known = contentTranslationKnownLanguage(code);
	var dir = language.dir || known.dir || 'ltr';
	var fontClass = language.fontClass || known.fontClass || '';
	var previousFontClass = target.attr('data-content-language-font-class') || '';
	if (previousFontClass)
		target.removeClass(previousFontClass);
	if (!code) {
		target.removeAttr('data-content-language-font-class');
		return;
	}
	target.attr({
		lang: code,
		dir: dir === 'rtl' ? 'rtl' : 'ltr',
		'data-content-language': code
	});
	if (fontClass) {
		target.attr('data-content-language-font-class', fontClass);
		target.addClass(fontClass);
	} else {
		target.removeAttr('data-content-language-font-class');
	}
}

function setContentTranslationContainerLanguage(target, language, fallbackLanguage) {
	target = target && target.jquery ? target : $(target);
	if (!target.length)
		return;
	var containers = $();
	target.each(function () {
		var node = $(this);
		containers = containers
			.add(node.closest('[data-content-translation-container="1"], section[lang], header[lang], footer[lang]').first())
			.add(node.closest('.quran-tafsir-entry-body, .quran-translation-text, [data-quran-translation-display="passage"]').first())
			.add(node.closest('.quran-tafsir-entry').first());
	});
	containers.each(function () {
		setContentLanguageAttributes(this, language, fallbackLanguage);
	});
}

function contentTranslationConfig() {
	if (!paymentFeatureEnabled())
		return Promise.resolve({ languages: [], pricing: null });
	if (!contentTranslationConfigPromise) {
		contentTranslationConfigPromise = fetch(quranApiPath('/content-translations/languages'), {
			credentials: 'same-origin'
		}).then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load languages.');
			return response.json();
		}).then(function (payload) {
			var config = {
				languages: normalizeContentTranslationLanguages(payload && payload.languages).filter(function (language) { return language.code !== 'ar'; }),
				pricing: payload && payload.pricing ? payload.pricing : null
			};
			contentTranslationConfigPromise.__contentTranslationResolvedConfig = config;
			return config;
		}).catch(function () {
			var fallback = {
				languages: [{ code: 'en', label: 'English', dir: 'ltr', script: 'Latin', fontClass: 'content-language-latin' }],
				pricing: { translatePointsPer1000Words: 25, translateMinimumPoints: 5 }
			};
			contentTranslationConfigPromise.__contentTranslationResolvedConfig = fallback;
			return fallback;
		});
	}
	return contentTranslationConfigPromise;
}

function contentTranslationLanguages() {
	return contentTranslationConfig().then(function (config) {
		return config.languages || [];
	});
}

function preferredContentLanguage() {
	if (preferredContentLanguagePromise)
		return preferredContentLanguagePromise;
	preferredContentLanguagePromise = waitForHadithAuth().then(function (auth) {
		return Promise.resolve(auth && auth.getToken ? auth.getToken() : null).then(function (token) {
			if (!token)
				return 'en';
			return fetch(quranApiPath('/user-settings?optional=1'), {
				credentials: 'same-origin',
				headers: { 'Authorization': `Bearer ${token}` }
			}).then(function (response) {
				if (!response.ok)
					return 'en';
				return response.json();
			}).then(function (payload) {
				var settings = payload && payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : {};
				var profile = settings.profile && typeof settings.profile === 'object' && !Array.isArray(settings.profile) ? settings.profile : {};
				return (profile.preferredLanguage || 'en').toString();
			}).catch(function () {
				return 'en';
			});
		});
	});
	return preferredContentLanguagePromise;
}

function renderShareGeneratedMarkdown(value) {
	return renderClientMarkdown(value);
}

function preserveGeneratedShareDefaults(modal) {
	if (!modal)
		return;
	modal.querySelectorAll('[data-share-generated-title], [data-share-generated-body]').forEach(function (target) {
		if (target.dataset.shareGeneratedDefaultHtml === undefined)
			target.dataset.shareGeneratedDefaultHtml = target.innerHTML || '';
		if (target.dataset.shareGeneratedDefaultLang === undefined)
			target.dataset.shareGeneratedDefaultLang = target.getAttribute('lang') || 'en';
	});
}

async function contentTranslationRequest(itemType, itemId, language, mode, estimateOnly, extra) {
	if (!contentTranslationFeatureEnabled(itemType))
		throw new Error('Content translation is disabled.');
	if (!itemType || !itemId)
		throw new Error('This item cannot be translated.');
	var token = await getHadithAuthToken('Please sign in to translate this text.');
	if (!token)
		throw new Error('Please sign in to translate this text.');
	var endpoint = estimateOnly ? '/content-translations/estimate' : '/content-translations';
	var method = estimateOnly ? 'GET' : 'POST';
	var url = new URL(quranApiPath(endpoint), window.location.origin);
	if (estimateOnly) {
		url.searchParams.set('type', itemType);
		url.searchParams.set('id', itemId);
		url.searchParams.set('lang', language);
		url.searchParams.set('mode', mode || 'translate');
	}
	var body = {
		itemType: itemType,
		itemId: itemId,
		targetLanguage: language,
		mode: mode || 'translate'
	};
	if (!estimateOnly && extra && typeof extra === 'object')
		body = Object.assign(body, extra);
	var response = await fetch(url.toString(), {
		method: method,
		credentials: 'same-origin',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${token}`
		},
		body: estimateOnly ? undefined : JSON.stringify(body)
	});
	if (!response.ok) {
		var message = estimateOnly ? 'Unable to estimate translation points.' : 'Unable to translate text.';
		try {
			var payload = await response.json();
			message = payload && (payload.message || payload.error) || message;
		} catch (_err) {}
		throw new Error(message);
	}
	return response.json();
}

function contentTranslationAvailableKey(itemType, itemId) {
	return `${itemType || ''}:${itemId || ''}`;
}

function contentTranslationAvailableFromElement(card) {
	if (!card || !card.getAttribute)
		return null;
	var encoded = card.getAttribute('data-content-available-translations') || card.getAttribute('data-share-available-translations');
	if (!encoded)
		return null;
	try {
		var translations = JSON.parse(encoded);
		translations = normalizeAvailableContentTranslations(translations);
		return { translations: translations };
	} catch (_err) {
		return null;
	}
}

async function contentTranslationAvailableRequest(itemType, itemId, force) {
	if (!contentTranslationFeatureEnabled(itemType))
		return { translations: [] };
	var key = contentTranslationAvailableKey(itemType, itemId);
	if (!force && contentTranslationAvailablePromises[key])
		return contentTranslationAvailablePromises[key];
	var url = new URL(quranApiPath('/content-translations/available'), window.location.origin);
	url.searchParams.set('type', itemType);
	url.searchParams.set('id', itemId);
	contentTranslationAvailablePromises[key] = fetch(url.toString(), {
		credentials: 'same-origin'
	}).then(function (response) {
		if (!response.ok)
			throw new Error('Unable to load available translations.');
		return response.json();
	}).catch(function () {
		return { translations: [] };
	});
	return contentTranslationAvailablePromises[key];
}

async function contentTranslationPaymentRequest(path, options, message) {
	options = options || {};
	var token = await getHadithAuthToken(message || 'Please sign in to continue.');
	if (!token)
		throw new Error('Please sign in to continue.');
	var response = await fetch(quranApiPath(path), {
		credentials: 'same-origin',
		...options,
		headers: {
			...(options.headers || {}),
			'Authorization': `Bearer ${token}`,
			...(options.method && options.method !== 'GET' ? { 'Content-Type': 'application/json' } : {})
		}
	});
	if (!response.ok) {
		var errorMessage = 'Payment request failed.';
		try {
			var payload = await response.json();
			errorMessage = payload && (payload.message || payload.error) || errorMessage;
		} catch (_err) {}
		throw new Error(errorMessage);
	}
	return response.json();
}

async function contentTranslationPaymentSummary() {
	return contentTranslationPaymentRequest('/payments/summary', { method: 'GET' }, 'Please sign in to view your points.');
}

function contentTranslationFormatMoney(amount, currency) {
	amount = Number(amount || 0);
	currency = (currency || 'usd').toString().toUpperCase();
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(amount / 100);
	} catch (_err) {
		return `${currency} ${(amount / 100).toFixed(2)}`;
	}
}

function contentTranslationPackageLabel(pkg) {
	if (!pkg)
		return '';
	return `${(Number(pkg.points) || 0).toLocaleString()} points - ${contentTranslationFormatMoney(pkg.amount, pkg.currency)}`;
}

function contentTranslationCheckoutReturnPath() {
	var url = new URL(window.location.href);
	url.searchParams.delete('translation_payment');
	url.searchParams.delete('session_id');
	return `${url.pathname}${url.search || ''}${url.hash || ''}`;
}

function savePendingContentTranslationCheckout(state, language, extra) {
	state = state || {};
	extra = extra || {};
	try {
		sessionStorage.setItem(CONTENT_TRANSLATION_PENDING_CHECKOUT_KEY, JSON.stringify(Object.assign({
			itemType: state.itemType,
			itemId: state.itemId,
			language: language,
			points: state.estimate && state.estimate.points || state.points || 0,
			createdAt: state.createdAt || Date.now()
		}, extra)));
	} catch (_err) {}
}

function readPendingContentTranslationCheckout() {
	try {
		var payload = JSON.parse(sessionStorage.getItem(CONTENT_TRANSLATION_PENDING_CHECKOUT_KEY) || 'null');
		if (!payload || Date.now() - Number(payload.createdAt || 0) > 30 * 60 * 1000)
			return null;
		return payload;
	} catch (_err) {
		return null;
	}
}

function clearPendingContentTranslationCheckout() {
	try {
		sessionStorage.removeItem(CONTENT_TRANSLATION_PENDING_CHECKOUT_KEY);
	} catch (_err) {}
}

async function cancelPendingContentTranslationCheckout(sessionId, pending) {
	if (!sessionId || !/^cs_(?:test|live)_/.test(sessionId))
		return;
	try {
		await contentTranslationPaymentRequest(`/payments/content-translation-checkout/${encodeURIComponent(sessionId)}`, {
			method: 'DELETE',
			body: JSON.stringify({
				itemType: pending && pending.itemType,
				itemId: pending && pending.itemId,
				targetLanguage: pending && pending.language,
				mode: 'translate'
			})
		}, 'Please sign in to release payment authorization.');
	} catch (_err) {}
}

async function generatedShareRequest(card, language, mode, estimateOnly) {
	return contentTranslationRequest(
		card && card.getAttribute('data-share-generated-item-type'),
		card && card.getAttribute('data-share-generated-item-id'),
		language,
		mode,
		estimateOnly
	);
}

function restoreGeneratedShareDefaults(modal) {
	(modal || document).querySelectorAll('[data-share-generated-title], [data-share-generated-body]').forEach(function (target) {
		if (target.dataset.shareGeneratedDefaultHtml !== undefined)
			target.innerHTML = target.dataset.shareGeneratedDefaultHtml;
		if (target.dataset.shareGeneratedDefaultLang)
			target.setAttribute('lang', target.dataset.shareGeneratedDefaultLang);
		target.removeAttribute('dir');
		if (target.getAttribute('data-content-language-font-class'))
			target.classList.remove(target.getAttribute('data-content-language-font-class'));
		target.removeAttribute('data-content-language');
		target.removeAttribute('data-content-language-font-class');
	});
}

function applyGeneratedShareContent(modal, card, result) {
	var content = result && result.content || {};
	var language = result && result.targetLanguage || {};
	var dir = language.dir === 'rtl' ? 'rtl' : 'ltr';
	var lang = language.code || '';
	var title = modal.querySelector('[data-share-generated-title]');
	var body = modal.querySelector('[data-share-generated-body]');
	if (title && content.title) {
		title.innerHTML = $('<div>').text(content.title).html();
		setContentLanguageAttributes(title, { code: lang, dir: dir, fontClass: language.fontClass }, lang);
	}
	if (body && (content.body || content.text)) {
		body.innerHTML = renderShareGeneratedMarkdown(content.body || content.text);
		setContentLanguageAttributes(body, { code: lang, dir: dir, fontClass: language.fontClass }, lang);
	}
	if (result && Number(result.points) > 0 && window.toastr)
		toastr.success(`${Number(result.points).toLocaleString()} points used.`, 'Translation');
}

function generatedShareTranslationSectionId(code) {
	return `share-generated-translation-${(code || '').toString().replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`;
}

function generatedShareTranslationContentHtml(content) {
	content = content || {};
	var parts = [];
	if (content.title)
		parts.push(`<strong>${$('<div>').text(content.title).html()}</strong>`);
	if (content.body || content.text)
		parts.push(renderShareGeneratedMarkdown(content.body || content.text));
	if (content.footnote || content.footnotes)
		parts.push(renderShareGeneratedMarkdown(content.footnote || content.footnotes));
	return parts.filter(Boolean).join('\n');
}

function generatedShareTranslationLabel(translation) {
	return translation && (translation.label || translation.code && translation.code.toUpperCase()) || '';
}

function upsertGeneratedShareTranslationSection(modal, card, translation) {
	if (!modal || !card || !translation || !translation.code)
		return;
	var code = translation.code;
	var sectionId = generatedShareTranslationSectionId(code);
	var existing = modal.querySelector(`[data-share-generated-translation-section="${code}"]`);
	if (!translation.content || !Object.values(translation.content).some(Boolean)) {
		if (existing)
			existing.remove();
		return;
	}
	var footer = card.querySelector('.hadith-share-footer');
	var section = existing || document.createElement('section');
	section.className = 'hadith-share-section hadith-share-translation-section hadith-share-generated-translation-section';
	section.setAttribute('data-share-generated-translation-section', code);
	section.setAttribute('data-share-copy-section', 'translation');
	section.id = sectionId;
	setContentLanguageAttributes(section, translation, code);
	var label = generatedShareTranslationLabel(translation);
	section.innerHTML = `
		<div class="hadith-share-ref share-editable" contenteditable="false">${$('<div>').text(label).html()}</div>
		<div class="body hadith-share-text share-editable" lang="${$('<div>').text(code).html()}" contenteditable="false" data-share-copy-body="1">${generatedShareTranslationContentHtml(translation.content)}</div>
	`;
	if (!existing)
		card.querySelector('.hadith-share-card-inner').insertBefore(section, footer || null);
}

function removeGeneratedShareTranslationSection(modal, code) {
	var section = modal ? modal.querySelector(`[data-share-generated-translation-section="${code}"]`) : null;
	if (section)
		section.remove();
}

function selectedGeneratedShareTranslations(modal) {
	return Array.from(modal ? modal.querySelectorAll('[data-share-language-option]:checked') : []).map(function (input) {
		return input.value;
	}).filter(Boolean);
}

function updateGeneratedShareLanguageToggle(modal) {
	var button = modal ? modal.querySelector('[data-share-language-toggle-button="1"]') : null;
	if (!button)
		return;
	var selected = selectedGeneratedShareTranslations(modal);
	button.textContent = selected.length < 1 ? 'Translations' : `${selected.length} selected`;
}

function applyGeneratedShareLanguageSelection(modal, card) {
	if (!modal || !card)
		return;
	var translationsByCode = modal._shareGeneratedTranslationsByCode || {};
	Array.from(modal.querySelectorAll('[data-share-language-option]')).forEach(function (input) {
		var code = input.value || '';
		if (code === 'en') {
			var defaultSection = modal.querySelector('[data-share-generated-body="1"]');
			defaultSection = defaultSection ? defaultSection.closest('.hadith-share-section') : null;
			if (defaultSection)
				defaultSection.classList.toggle('d-none', !input.checked);
		} else if (input.checked && translationsByCode[code]) {
			upsertGeneratedShareTranslationSection(modal, card, translationsByCode[code]);
		} else {
			removeGeneratedShareTranslationSection(modal, code);
		}
	});
	updateGeneratedShareLanguageToggle(modal);
}

function selectGeneratedShareDefaultLanguage(modal, card, requestedLanguage) {
	var inputs = Array.from(modal ? modal.querySelectorAll('[data-share-language-option]') : []);
	if (!inputs.length)
		return;
	var available = inputs.map(function (input) {
		return { code: input.value };
	});
	var selectedLanguage = chooseAvailableContentTranslationLanguage(available, requestedLanguage || readGlobalContentLanguage());
	inputs.forEach(function (input) {
		input.checked = input.value === selectedLanguage;
	});
	applyGeneratedShareLanguageSelection(modal, card);
}

function renderGeneratedShareLanguageMenu(modal, card, translations, requestedLanguage) {
	var menu = modal ? modal.querySelector('[data-share-language-menu="1"]') : null;
	if (!menu)
		return;
	translations = normalizeAvailableContentTranslations(translations);
	modal._shareGeneratedTranslationsByCode = {};
	translations.forEach(function (translation) {
		modal._shareGeneratedTranslationsByCode[translation.code] = translation;
	});
	menu.innerHTML = '';
	if (translations.length < 1) {
		var empty = document.createElement('div');
		empty.className = 'dropdown-item-text text-muted small';
		empty.textContent = 'No translations available';
		menu.appendChild(empty);
		updateGeneratedShareLanguageToggle(modal);
		return;
	}
	translations.forEach(function (translation) {
		var id = `${modal.closest('.modal') && modal.closest('.modal').id || card.getAttribute('data-share-generated-item-id') || 'share'}-${translation.code}-share-language`;
		var wrap = document.createElement('div');
		wrap.className = 'form-check';
		var input = document.createElement('input');
		input.className = 'form-check-input';
		input.type = 'checkbox';
		input.id = id;
		input.value = translation.code;
		input.setAttribute('data-share-language-option', '1');
		var label = document.createElement('label');
		label.className = 'form-check-label';
		label.htmlFor = id;
		label.textContent = generatedShareTranslationLabel(translation);
		wrap.appendChild(input);
		wrap.appendChild(label);
		menu.appendChild(wrap);
		input.addEventListener('change', function () {
			applyGeneratedShareLanguageSelection(modal, card);
			scheduleHadithShareCardFit(card);
			scheduleHadithShareRender(card);
		});
	});
	selectGeneratedShareDefaultLanguage(modal, card, requestedLanguage || readGlobalContentLanguage());
}

function hadithContentTranslationScope(target) {
	var node = target && target.jquery ? target[0] : target;
	return node ? $(node).closest('[data-content-translation-scope]') : $();
}

function preserveHadithContentTranslationScope(target) {
	var scope = hadithContentTranslationScope(target);
	if (!scope.length)
		return;
	scope.find('[data-content-translation-field]').each(function () {
		if (this.dataset.contentTranslationDefaultHtml === undefined)
			this.dataset.contentTranslationDefaultHtml = this.innerHTML || '';
		if (this.dataset.contentTranslationDefaultLang === undefined)
			this.dataset.contentTranslationDefaultLang = this.getAttribute('lang') || '';
		if (this.dataset.contentTranslationDefaultDir === undefined)
			this.dataset.contentTranslationDefaultDir = this.getAttribute('dir') || '';
		if (this.dataset.contentTranslationDefaultContentLanguage === undefined)
			this.dataset.contentTranslationDefaultContentLanguage = this.getAttribute('data-content-language') || '';
		if (this.dataset.contentTranslationDefaultFontClass === undefined)
			this.dataset.contentTranslationDefaultFontClass = this.getAttribute('data-content-language-font-class') || '';
	});
}

function resetHadithContentTranslationScope(target) {
	var scope = hadithContentTranslationScope(target);
	if (!scope.length)
		return false;
	scope.find('[data-content-translation-field]').each(function () {
		if (this.dataset.contentTranslationDefaultHtml !== undefined)
			this.innerHTML = this.dataset.contentTranslationDefaultHtml;
		if (this.dataset.contentTranslationDefaultLang)
			this.setAttribute('lang', this.dataset.contentTranslationDefaultLang);
		else
			this.removeAttribute('lang');
		if (this.dataset.contentTranslationDefaultDir)
			this.setAttribute('dir', this.dataset.contentTranslationDefaultDir);
		else
			this.removeAttribute('dir');
		if (this.getAttribute('data-content-language-font-class'))
			this.classList.remove(this.getAttribute('data-content-language-font-class'));
		if (this.dataset.contentTranslationDefaultContentLanguage)
			this.setAttribute('data-content-language', this.dataset.contentTranslationDefaultContentLanguage);
		else
			this.removeAttribute('data-content-language');
		if (this.dataset.contentTranslationDefaultFontClass) {
			this.setAttribute('data-content-language-font-class', this.dataset.contentTranslationDefaultFontClass);
			this.classList.add(this.dataset.contentTranslationDefaultFontClass);
		} else {
			this.removeAttribute('data-content-language-font-class');
		}
		setContentTranslationContainerLanguage(this, contentTranslationKnownLanguage(this.getAttribute('lang') || 'en'), this.getAttribute('lang') || 'en');
	});
	return true;
}

function initGeneratedShareLanguageSelect(modal, card) {
	if (!paymentFeatureEnabled())
		return;
	var menu = modal ? modal.querySelector('[data-share-language-menu="1"]') : null;
	if (!menu || !card)
		return;
	if (menu.dataset.shareLanguageBound === 'true') {
		selectGeneratedShareDefaultLanguage(modal, card, readGlobalContentLanguage());
		return;
	}
	menu.dataset.shareLanguageBound = 'true';
	preserveGeneratedShareDefaults(modal);
	Promise.all([
		resolveInitialGlobalContentLanguage(),
		Promise.resolve(contentTranslationAvailableFromElement(card)).then(function (available) {
			return available || contentTranslationAvailableRequest(
				card.getAttribute('data-share-generated-item-type'),
				card.getAttribute('data-share-generated-item-id'),
				false
			);
		})
	]).then(function (results) {
		renderGeneratedShareLanguageMenu(modal, card, results[1] && results[1].translations || [], results[0]);
		scheduleHadithShareCardFit(card);
		scheduleHadithShareRender(card);
	}).catch(function () {
		renderGeneratedShareLanguageMenu(modal, card, [], readGlobalContentLanguage());
	});
}

function applyHadithContentTranslationResult(target, result, fallbackLanguage) {
	var scope = hadithContentTranslationScope(target);
	if (!scope.length)
		return false;
	var content = result && result.content || {};
	var targetLanguage = result && result.targetLanguage || {};
	var lang = targetLanguage.code || fallbackLanguage || '';
	var dir = targetLanguage.dir === 'rtl' ? 'rtl' : 'ltr';
	var renderers = {
		title: function (value) { return $('<div>').text(value || '').html(); },
		chain: function (value) { return $('<div>').text(value || '').html(); },
		body: renderShareGeneratedMarkdown,
		footnote: renderShareGeneratedMarkdown
	};
	var applied = false;
	Object.keys(renderers).forEach(function (field) {
		if (!Object.prototype.hasOwnProperty.call(content, field))
			return;
		var value = content[field] || '';
		scope.find(`[data-content-translation-field="${field}"]`).each(function () {
			if (this.hasAttribute('data-markdown-source'))
				this.setAttribute('data-markdown-source', value || '');
			this.innerHTML = renderers[field](value);
			setContentLanguageAttributes(this, { code: lang, dir: dir, fontClass: targetLanguage.fontClass }, lang);
			setContentTranslationContainerLanguage(this, { code: lang, dir: dir, fontClass: targetLanguage.fontClass }, lang);
			applied = true;
		});
	});
	return applied;
}

function markContentTranslationTargetTranslated(target) {
	target = target && target.jquery ? target : $(target);
	if (!target.length)
		return;
	target.attr('data-content-translation-existing', 'true');
	var itemClass = (target.attr('data-content-translation-item-type') || '').toString().replace(/[^a-z0-9_-]/gi, '').toLowerCase();
	var row = ensureContentTranslationActionsRow(target);
	var control = row.find(itemClass ? `.content-translation-control-${itemClass}` : '.content-translation-control').first();
	if (!control.length)
		return;
	var label = 'Revise or Translate';
	control.attr('title', 'Revise translation with points').addClass('content-translation-auth-only').prop('hidden', false);
	control.find('.content-translate-button').first().addClass('content-translation-revise-button').attr({
		title: label,
		'aria-label': label
	}).find('.content-translate-button-label').text(label);
	refreshContentTranslationAuthControls();
}

function tafsirArabicHtmlForTranslationTarget(target) {
	target = target && target.jquery ? target : $(target);
	if (!target.length)
		return '';
	var stored = target.data('tafsirArabicHtml');
	if (stored)
		return stored.toString();
	var section = target.find('.quran-tafsir-local-pair [lang="ar"]').last();
	if (!section.length)
		section = target.find('[lang="ar"][dir="rtl"]').last();
	if (!section.length)
		return '';
	stored = section.html() || '';
	if (stored) {
		target.data('tafsirArabicHtml', stored);
		target.attr('data-tafsir-preserve-arabic', '1');
	}
	return stored;
}

function applyTafsirContentTranslationResult(target, result, fallbackLanguage) {
	target = target && target.jquery ? target : $(target);
	if (!target.length || target.attr('data-content-translation-item-type') !== 'tafsir')
		return false;
	var arabicHtml = tafsirArabicHtmlForTranslationTarget(target);
	if (!arabicHtml)
		return false;
	var content = result && result.content || {};
	var text = [content.text || content.body || '', content.footnotes || content.footnote || ''].filter(Boolean).join('\n\n');
	if (!text)
		return false;
	var targetLanguage = result && result.targetLanguage || {};
	var lang = targetLanguage.code || fallbackLanguage || target.attr('data-content-translation-language') || 'en';
	var pair = $('<div>').addClass('row quran-tafsir-local-pair');
	var translationSection = $('<section>').addClass('col-md-6 col-sm-12').html(renderShareGeneratedMarkdown(text)).appendTo(pair);
	setContentLanguageAttributes(translationSection, targetLanguage, lang);
	$('<section>').addClass('col-md-6 col-sm-12').attr({
		lang: 'ar',
		dir: 'rtl'
	}).html(arabicHtml).appendTo(pair);
	target.empty().append(pair);
	target.data('tafsirArabicHtml', arabicHtml);
	target.attr({
		'data-tafsir-preserve-arabic': '1',
		'data-content-translation-language': lang,
		lang: 'en',
		dir: 'ltr'
	});
	return true;
}

function applyContentTranslationResult(target, result, fallbackLanguage) {
	var targetLanguage = result && result.targetLanguage || {};
	var lang = targetLanguage.code || fallbackLanguage || '';
	if (applyTafsirContentTranslationResult(target, result, fallbackLanguage)) {
		target.attr('data-content-translation-language', lang);
		markContentTranslationTargetTranslated(target);
		if (result && Number(result.points) > 0 && window.toastr)
			toastr.success(`${Number(result.points).toLocaleString()} points used.`, 'Translation');
		return;
	}
	if (applyHadithContentTranslationResult(target, result, fallbackLanguage)) {
		target.attr('data-content-translation-language', lang);
		markContentTranslationTargetTranslated(target);
		if (result && Number(result.points) > 0 && window.toastr)
			toastr.success(`${Number(result.points).toLocaleString()} points used.`, 'Translation');
		return;
	}
	var content = result && result.content || {};
	var text = [content.text || content.body || '', content.footnotes || content.footnote || ''].filter(Boolean).join('\n\n');
	target.html(renderShareGeneratedMarkdown(text));
	setContentLanguageAttributes(target, targetLanguage, fallbackLanguage);
	setContentTranslationContainerLanguage(target, targetLanguage, fallbackLanguage);
	target.attr('data-content-translation-language', lang);
	markContentTranslationTargetTranslated(target);
	if (result && Number(result.points) > 0 && window.toastr)
		toastr.success(`${Number(result.points).toLocaleString()} points used.`, 'Translation');
}

function contentTranslationResultOption(result, fallbackLanguage) {
	var language = result && result.targetLanguage || {};
	var code = language.code || fallbackLanguage || '';
	var content = result && result.content || {};
	if (!code || !Object.values(content).some(Boolean))
		return null;
	var known = contentTranslationKnownLanguage(code);
	return {
		code: known.code || code,
		label: language.label || known.label || code.toUpperCase(),
		dir: language.dir || known.dir || 'ltr',
		fontClass: language.fontClass || known.fontClass || '',
		source: 'translation',
		content: content
	};
}

function contentTranslationKnownLanguage(code) {
	code = (code || '').toString();
	var fallback = { code: code, label: code.toUpperCase(), dir: 'ltr', fontClass: '' };
	if (!code)
		return fallback;
	var configPromise = contentTranslationConfigPromise;
	if (!configPromise)
		return fallback;
	var cached = configPromise.__contentTranslationResolvedConfig;
	if (!cached || !Array.isArray(cached.languages))
		return fallback;
	return cached.languages.find(function (language) { return language.code === code; }) || fallback;
}

function ensureContentTranslationActionsRow(target) {
	target = target && target.jquery ? target : $(target);
	if (!target.length)
		return $();
	var row = target.data('contentTranslationActionsRow');
	if (row && row.length)
		return row;
	var itemColumn = target.closest('section.h');
	var placementAnchor = itemColumn.children('[data-content-translation-actions-anchor="1"]').first();
	var footnote = itemColumn.children('footer.footnote').first();
	var bodySection = target.closest('section.body');
	var anchor = placementAnchor.length ? placementAnchor : (footnote.length ? footnote : (bodySection.length ? bodySection : target));
	row = anchor.next('.content-translation-actions-row');
	if (!row.length) {
		row = $('<div>').addClass('content-translation-actions-row');
		anchor.after(row);
	}
	row.attr({
		lang: 'en',
		dir: 'ltr'
	}).css({
		direction: 'ltr',
		textAlign: 'left'
	});
	target.data('contentTranslationActionsRow', row);
	return row;
}

function setNeutralLanguageSelectDisplay(selector) {
	selector = selector && selector.jquery ? selector : $(selector);
	if (!selector.length)
		return;
	var previousFontClass = selector.attr('data-content-language-font-class') || '';
	if (previousFontClass)
		selector.removeClass(previousFontClass);
	selector.attr({
		lang: 'en',
		dir: 'ltr'
	});
	selector.css({
		direction: 'ltr',
		textAlign: 'left'
	});
	selector.removeAttr('data-content-language data-content-language-font-class');
}

function setUnderItemLanguageSelectDirection(selector) {
	setNeutralLanguageSelectDisplay(selector);
}

function globalContentLanguageOptions(configLanguages) {
	var byCode = {};
	normalizeContentTranslationLanguages(GLOBAL_CONTENT_LANGUAGE_DEFAULTS).forEach(function (language) {
		byCode[language.code] = language;
	});
	normalizeContentTranslationLanguages(configLanguages).forEach(function (language) {
		byCode[language.code] = language;
	});
	if (!byCode.en)
		byCode.en = { code: 'en', label: 'English', dir: 'ltr', fontClass: 'content-language-latin' };
	return Object.values(byCode).sort(contentTranslationLanguageSort);
}

function populateGlobalContentLanguageSelects(languages) {
	var selected = readGlobalContentLanguage();
	var options = globalContentLanguageOptions(languages);
	$('[data-global-content-language-dropdown="1"]').each(function () {
		var dropdown = $(this);
		var menu = dropdown.find('[data-global-content-language-menu="1"]').first();
		var current = dropdown.attr('data-global-content-language-current') || selected;
		menu.empty();
		options.forEach(function (language) {
			var option = $('<button>').addClass('dropdown-item global-content-language-option').attr({
				type: 'button',
				'data-global-content-language-option': language.code,
				title: language.label || language.code.toUpperCase()
			});
			$('<span>').addClass('global-content-language-code').text(language.code.toUpperCase()).appendTo(option);
			$('<span>').addClass('global-content-language-name').text(language.label || language.code.toUpperCase()).appendTo(option);
			option.appendTo(menu);
		});
		dropdown.attr('data-global-content-language-current', normalizeGlobalContentLanguage(current));
	});
	syncGlobalContentLanguageSelects(selected);
}

function selectAdminContentTranslationLanguage(code) {
	code = normalizeGlobalContentLanguage(code);
	$('[data-admin-content-translation-select="1"]').each(function () {
		var select = $(this);
		var next = 'en';
		select.find('option').each(function () {
			if ($(this).attr('value') === code)
				next = code;
		});
		if (select.val() !== next)
			select.val(next).trigger('change');
	});
}

function applyGlobalContentLanguage(root, code, force) {
	code = normalizeGlobalContentLanguage(code);
	var scope = root || document;
	$(scope).find('[data-content-translation-item-type][data-content-translation-item-id]').addBack('[data-content-translation-item-type][data-content-translation-item-id]').each(function () {
		var target = $(this);
		var itemType = target.attr('data-content-translation-item-type');
		var itemId = target.attr('data-content-translation-item-id');
		if (!itemType || !itemId)
			return;
		preserveHadithContentTranslationScope(target);
		target.attr({
			'data-content-translation-language': code,
			'data-content-translation-preferred-language': code
		});
		var translations = target.data('contentTranslationAvailableTranslations');
		if (Array.isArray(translations) && translations.length) {
			renderAvailableContentTranslationSelector(target, itemType, itemId, code, translations);
			return;
		}
		loadAvailableContentTranslationSelector(target, itemType, itemId, code, force === true);
	});
	selectAdminContentTranslationLanguage(code);
}

function setGlobalContentLanguage(code, options) {
	code = normalizeGlobalContentLanguage(code);
	options = options || {};
	writeGlobalContentLanguage(code);
	syncGlobalContentLanguageSelects(code);
	applyGlobalContentLanguage(document, code, options.force === true);
	document.dispatchEvent(new CustomEvent('hadithContentLanguageChanged', { detail: { language: code } }));
}

function initGlobalContentLanguageSelect(root) {
	var scope = root || document;
	var dropdowns = $(scope).find('[data-global-content-language-dropdown="1"]').addBack('[data-global-content-language-dropdown="1"]');
	if (!dropdowns.length)
		return;
	populateGlobalContentLanguageSelects([]);
	dropdowns.each(function () {
		var dropdown = $(this);
		if (dropdown.data('globalContentLanguageBound'))
			return;
		dropdown.data('globalContentLanguageBound', true);
		dropdown.on('click', '[data-global-content-language-option]', function () {
			setGlobalContentLanguage($(this).attr('data-global-content-language-option'));
		});
	});
	contentTranslationLanguages().then(function (languages) {
		resolveInitialGlobalContentLanguage().then(function (language) {
			populateGlobalContentLanguageSelects(languages);
			syncGlobalContentLanguageSelects(language);
			applyGlobalContentLanguage(document, language, false);
		});
	});
}

function chooseAvailableContentTranslationLanguage(translations, requestedLanguage) {
	translations = Array.isArray(translations) ? translations : [];
	requestedLanguage = (requestedLanguage || '').toString().trim().toLowerCase();
	if (requestedLanguage && requestedLanguage !== 'en' && translations.some(function (translation) { return translation.code === requestedLanguage; }))
		return requestedLanguage;
	return 'en';
}

function availableContentTranslationOptions(translations) {
	var options = Array.isArray(translations) ? translations.slice() : [];
	if (!options.some(function (translation) { return translation.code === 'en'; })) {
		var english = contentTranslationKnownLanguage('en');
		options.push({
			code: 'en',
			label: english.label && english.label !== 'EN' ? english.label : 'English',
			dir: 'ltr',
			fontClass: english.fontClass || 'content-language-latin',
			source: 'placeholder',
			content: null,
			unavailable: true
		});
	}
	return options.sort(contentTranslationLanguageSort);
}

function applyAvailableContentTranslation(target, translation) {
	if (!translation)
		return;
	if (translation.code === 'en' && (!translation.content || !Object.values(translation.content).some(Boolean)) && resetHadithContentTranslationScope(target)) {
		target.attr('data-content-translation-language', 'en');
		return;
	}
	if (!translation.content || !Object.values(translation.content).some(Boolean))
		return;
	applyContentTranslationResult(target, {
		content: translation.content,
		targetLanguage: translation
	}, translation.code);
	target.attr('data-content-translation-language', translation.code);
}

function renderAvailableContentTranslationSelector(target, itemType, itemId, currentLanguage, translations) {
	target = target && target.jquery ? target : $(target);
	if (!target.length)
		return;
	currentLanguage = normalizeGlobalContentLanguage(currentLanguage || target.attr('data-content-translation-preferred-language') || target.attr('data-content-translation-language') || readGlobalContentLanguage() || target.attr('lang') || '');
	target.attr('data-content-translation-preferred-language', currentLanguage);
	translations = normalizeAvailableContentTranslations(translations);
	var unique = translations;
	var options = availableContentTranslationOptions(unique);
	target.data('contentTranslationAvailableTranslations', options);
	currentLanguage = chooseAvailableContentTranslationLanguage(unique, currentLanguage);
	var selectedTranslation = options.find(function (translation) { return translation.code === currentLanguage; });
	applyAvailableContentTranslation(target, selectedTranslation);
	if (target.attr('data-content-translation-auto-only') === 'true')
		return;
	var row = ensureContentTranslationActionsRow(target);
	var switcher = target.data('contentTranslationLanguageSwitcher');
	if (!switcher || !switcher.length) {
		switcher = $('<label>').addClass('content-translation-language-switcher quran-passage-translation-control mb-0').attr({
			lang: 'en',
			dir: 'ltr',
			'data-content-translation-language-switcher': contentTranslationAvailableKey(itemType, itemId)
		});
		$('<span>').addClass('visually-hidden').text('Language').appendTo(switcher);
		$('<span>').addClass('bi bi-translate quran-passage-translation-icon').attr('aria-hidden', 'true').appendTo(switcher);
		$('<select>').addClass('form-select form-select-sm content-translation-language-select quran-passage-translation-select').attr('aria-label', 'Language').appendTo(switcher);
		target.data('contentTranslationLanguageSwitcher', switcher);
		switcher.find('select').on('change', function () {
			var translations = target.data('contentTranslationAvailableTranslations') || [];
			var selected = translations.find(function (translation) { return translation.code === this.value; }, this);
			if (!selected)
				return;
			if (selected.code === 'en') {
				applyAvailableContentTranslation(target, selected);
			} else if (selected.content && Object.values(selected.content).some(Boolean)) {
				applyAvailableContentTranslation(target, selected);
			}
			setUnderItemLanguageSelectDirection(this);
		});
	}
	if (row.length && switcher.parent()[0] !== row[0])
		row.prepend(switcher);
	var selector = switcher.find('select');
	selector.empty();
	options.forEach(function (translation) {
		$('<option>').attr({
			value: translation.code,
			dir: 'ltr',
			'data-content-translation-unavailable': translation.unavailable === true ? '1' : '0'
		}).text(translation.label || translation.code.toUpperCase()).appendTo(selector);
	});
	selector.val(currentLanguage);
	setUnderItemLanguageSelectDirection(selector);
}

function upsertAvailableContentTranslation(target, itemType, itemId, result, fallbackLanguage) {
	var option = contentTranslationResultOption(result, fallbackLanguage);
	if (!option)
		return;
	var translations = target.data('contentTranslationAvailableTranslations') || [];
	translations = translations.filter(function (translation) {
		return translation && translation.code !== option.code;
	});
	translations.push(option);
	renderAvailableContentTranslationSelector(target, itemType, itemId, option.code, translations);
}

async function loadAvailableContentTranslationSelector(target, itemType, itemId, currentLanguage, force) {
	target = target && target.jquery ? target : $(target);
	if (!target.length || !itemType || !itemId)
		return;
	var embedded = !force && itemType === 'hadith' ? contentTranslationAvailableFromElement(target[0]) : null;
	var payload = embedded || await contentTranslationAvailableRequest(itemType, itemId, force);
	var requestedLanguage = currentLanguage || target.attr('data-content-translation-preferred-language') || readGlobalContentLanguage() || target.attr('data-content-translation-language') || target.attr('lang') || '';
	var known = target.data('contentTranslationAvailableTranslations') || [];
	var fetched = payload && Array.isArray(payload.translations) ? payload.translations : [];
	renderAvailableContentTranslationSelector(target, itemType, itemId, requestedLanguage, known.concat(fetched));
}

function scheduleAvailableContentTranslationSelector(target, itemType, itemId, currentLanguage) {
	target = target && target.jquery ? target : $(target);
	if (!target.length || target.data('contentTranslationAvailableBound'))
		return;
	target.data('contentTranslationAvailableBound', true);
	currentLanguage = currentLanguage || target.attr('data-content-translation-preferred-language') || readGlobalContentLanguage() || target.attr('data-content-translation-language') || target.attr('lang') || 'en';
	target.attr({
		'data-content-translation-item-type': itemType,
		'data-content-translation-item-id': itemId,
		'data-content-translation-language': currentLanguage,
		'data-content-translation-preferred-language': currentLanguage
	});
	var embedded = itemType === 'hadith' ? contentTranslationAvailableFromElement(target[0]) : null;
	var initialTranslations = embedded && Array.isArray(embedded.translations)
		? embedded.translations
		: target.data('contentTranslationAvailableTranslations') || [];
	renderAvailableContentTranslationSelector(target, itemType, itemId, currentLanguage, initialTranslations);
	if (!('IntersectionObserver' in window)) {
		loadAvailableContentTranslationSelector(target, itemType, itemId, currentLanguage, false);
		return;
	}
	if (embedded && itemType === 'hadith')
		return;
	if (!contentTranslationAvailableObserver) {
		contentTranslationAvailableObserver = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (!entry.isIntersecting)
					return;
				contentTranslationAvailableObserver.unobserve(entry.target);
				var node = $(entry.target);
				loadAvailableContentTranslationSelector(
					node,
					node.attr('data-content-translation-item-type'),
					node.attr('data-content-translation-item-id'),
					node.attr('data-content-translation-preferred-language') || readGlobalContentLanguage() || node.attr('data-content-translation-language') || node.attr('lang') || 'en',
					false
				);
			});
		}, { rootMargin: '200px 0px' });
	}
	contentTranslationAvailableObserver.observe(target[0]);
}

function contentTranslationWordCount(value) {
	value = (value || '').toString()
		.replace(/(?:^|\n)[ \t]*\[\^[^\]\n]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*/g, ' ')
		.replace(/\[\^[^\]\n]+\]/g, ' ')
		.replace(/[`*_>#()[\]{}|~!?,.;:"“”‘’،؛؟]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!value)
		return 0;
	var words = value.match(/[\p{L}\p{M}\p{N}]+(?:[-'][\p{L}\p{M}\p{N}]+)*/gu);
	return words ? words.length : 0;
}

function contentTranslationPointText(points) {
	points = Math.max(0, Math.floor(Number(points) || 0));
	if (points === 0)
		return 'No points needed';
	return points === 1 ? '1 point' : `${points.toLocaleString()} points`;
}

function contentTranslationEstimateFromWords(wordCount, pricing) {
	wordCount = Math.max(0, Math.floor(Number(wordCount) || 0));
	if (wordCount < 1)
		return { points: 0, wordCount: 0 };
	pricing = pricing || {};
	var per1000 = Number(pricing.translatePointsPer1000Words || 25);
	var minimum = Number(pricing.translateMinimumPoints || 5);
	if (!Number.isFinite(per1000) || per1000 <= 0)
		per1000 = 25;
	if (!Number.isFinite(minimum) || minimum < 0)
		minimum = 5;
	return {
		points: Math.max(Math.floor(minimum), Math.ceil((wordCount / 1000) * per1000)),
		wordCount: wordCount
	};
}

function contentTranslationLocalEstimate(target, config) {
	var scope = hadithContentTranslationScope(target);
	var source = scope.length ? scope : target;
	var attrPoints = Number(source.attr('data-content-translation-points'));
	var attrWords = Number(source.attr('data-content-translation-word-count'));
	if (Number.isFinite(attrPoints) && attrPoints >= 0) {
		return {
			points: Math.floor(attrPoints),
			wordCount: Number.isFinite(attrWords) && attrWords >= 0 ? Math.floor(attrWords) : 0
		};
	}
	var text = target.attr('data-markdown-source') || target.text() || '';
	return contentTranslationEstimateFromWords(contentTranslationWordCount(text), config && config.pricing);
}

function ensureContentTranslationModal() {
	var existing = $('#content-translation-modal');
	if (existing.length)
		return existing;
	var modal = $('<aside>').addClass('modal fade content-translation-modal').attr({
		id: 'content-translation-modal',
		tabindex: '-1',
		'aria-labelledby': 'content-translation-modal-title',
		'aria-hidden': 'true'
	});
	var dialog = $('<div>').addClass('modal-dialog modal-dialog-centered').appendTo(modal);
	var content = $('<div>').addClass('modal-content').appendTo(dialog);
	var header = $('<div>').addClass('modal-header').appendTo(content);
	var title = $('<h5>').addClass('modal-title').attr('id', 'content-translation-modal-title').appendTo(header);
	$('<span>').addClass('bi bi-translate me-2').attr('aria-hidden', 'true').appendTo(title);
	$('<span>').text('Translate with points').appendTo(title);
	$('<button>').addClass('btn-close').attr({
		type: 'button',
		'data-bs-dismiss': 'modal',
		'aria-label': 'Close'
	}).appendTo(header);
	var body = $('<div>').addClass('modal-body').appendTo(content);
	$('<p>').addClass('content-translation-modal-copy').text('Choose a language and translate this text using points. Your preferred language is selected when available.').appendTo(body);
	var field = $('<div>').addClass('mb-3').appendTo(body);
	$('<label>').addClass('form-label').attr('for', 'content-translation-modal-language').text('Language').appendTo(field);
	$('<select>').addClass('form-select content-translation-modal-language').attr({
		id: 'content-translation-modal-language',
		'aria-label': 'Translation language'
	}).appendTo(field);
	var estimate = $('<div>').addClass('content-translation-modal-estimate').appendTo(body);
	$('<strong>').addClass('content-translation-modal-points').attr('aria-live', 'polite').text('Estimated points').appendTo(estimate);
	$('<span>').addClass('content-translation-modal-words').text('Based on content size.').appendTo(estimate);
	var balance = $('<div>').addClass('content-translation-modal-balance').appendTo(body);
	$('<strong>').addClass('content-translation-modal-balance-value').attr('aria-live', 'polite').text('Checking points...').appendTo(balance);
	$('<span>').addClass('content-translation-modal-status').text('Loading your point balance.').appendTo(balance);
	var purchase = $('<div>').addClass('content-translation-modal-purchase').prop('hidden', true).appendTo(body);
	var packageField = $('<div>').addClass('mb-3').appendTo(purchase);
	$('<label>').addClass('form-label').attr('for', 'content-translation-modal-package').text('Point package').appendTo(packageField);
	$('<select>').addClass('form-select content-translation-modal-package').attr({
		id: 'content-translation-modal-package',
		'aria-label': 'Point package'
	}).appendTo(packageField);
	var recharge = $('<div>').addClass('form-check form-switch content-translation-modal-auto').appendTo(purchase);
	$('<input>').addClass('form-check-input').attr({
		type: 'checkbox',
		role: 'switch',
		id: 'content-translation-modal-auto-recharge'
	}).appendTo(recharge);
	$('<label>').addClass('form-check-label').attr('for', 'content-translation-modal-auto-recharge').text('Auto-recharge when points run low').appendTo(recharge);
	$('<p>').addClass('content-translation-modal-wallet').text('Secure checkout supports Apple Pay and Google Pay when available on this device. Payment is completed only after translation succeeds.').appendTo(purchase);
	$('<p>').addClass('content-translation-modal-note').text('Points are calculated from word count.').appendTo(body);
	var footer = $('<div>').addClass('modal-footer').appendTo(content);
	$('<button>').addClass('btn btn-outline-secondary').attr({
		type: 'button',
		'data-bs-dismiss': 'modal'
	}).addClass('content-translation-modal-cancel').text('Cancel').appendTo(footer);
	$('<button>').addClass('btn btn-primary content-translation-modal-submit').attr('type', 'button').text('Translate').appendTo(footer);
	$('body').append(modal);
	modal.on('hide.bs.modal', function (event) {
		if (contentTranslationModalState && contentTranslationModalState.busy === true) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	});
	modal.find('.content-translation-modal-language').on('change', function () {
		setNeutralLanguageSelectDisplay(this);
		updateContentTranslationModalEstimate();
	});
	modal.find('.content-translation-modal-package, .content-translation-modal-auto .form-check-input').on('change', function () {
		updateContentTranslationModalEstimate();
	});
	modal.find('.content-translation-modal-submit').on('click', submitContentTranslationModal);
	return modal;
}

function updateContentTranslationModalEstimate() {
	var modal = $('#content-translation-modal');
	var state = contentTranslationModalState || {};
	var estimate = state.estimate || { points: 0, wordCount: 0 };
	var balance = Number(state.balance);
	var hasBalance = Number.isFinite(balance);
	var shortfall = hasBalance ? Math.max(0, Math.floor(Number(estimate.points || 0) - balance)) : 0;
	var enough = hasBalance && shortfall === 0;
	var canBuy = contentTranslationPackages(state).length > 0;
	var label = contentTranslationPointText(estimate.points);
	var words = Math.max(0, Math.floor(Number(estimate.wordCount) || 0));
	if (state.busy === true) {
		modal.find('.content-translation-modal-submit').prop('disabled', true);
		return;
	}
	modal.find('.content-translation-modal-points').text(`Estimated: ${label}`);
	modal.find('.content-translation-modal-words').text(words === 1 ? 'Based on 1 word.' : `Based on ${words.toLocaleString()} words.`);
	if (hasBalance)
		modal.find('.content-translation-modal-balance-value').text(balance === 1 ? '1 point remaining' : `${balance.toLocaleString()} points remaining`);
	else
		modal.find('.content-translation-modal-balance-value').text('Sign in to see points remaining');
	if (!hasBalance) {
		modal.find('.content-translation-modal-status').text('Sign in to translate or buy points.');
	} else if (enough) {
		modal.find('.content-translation-modal-status').text('You have enough points to translate now.');
	} else if (canBuy) {
		modal.find('.content-translation-modal-status').text(`You need ${shortfall.toLocaleString()} more ${shortfall === 1 ? 'point' : 'points'} to translate.`);
	} else {
		modal.find('.content-translation-modal-status').text(`You need ${shortfall.toLocaleString()} more ${shortfall === 1 ? 'point' : 'points'}, but no point package is configured.`);
	}
	modal.find('.content-translation-modal-purchase').prop('hidden', !hasBalance || enough || !canBuy);
	var submit = modal.find('.content-translation-modal-submit');
	submit.text(!hasBalance
		? 'Sign in to continue'
		: (enough ? (estimate.points > 0 ? `Translate for ${label}` : 'Translate') : 'Buy points and translate'));
	submit.prop('disabled', modal.find('.content-translation-modal-language').prop('disabled') || (hasBalance && !enough && !canBuy));
}

function contentTranslationPackages(state) {
	var config = state && state.paymentConfig || {};
	return Array.isArray(config.packages) ? config.packages : [];
}

function populateContentTranslationPackages(modal, state) {
	var packages = contentTranslationPackages(state);
	var selector = modal.find('.content-translation-modal-package');
	var profile = state && state.profile || {};
	var estimate = state && state.estimate || {};
	var balance = Number(state && state.balance);
	var shortfall = Number.isFinite(balance) ? Math.max(0, Number(estimate.points || 0) - balance) : 0;
	selector.empty();
	packages.forEach(function (pkg) {
		$('<option>').attr('value', pkg.id).text(contentTranslationPackageLabel(pkg)).appendTo(selector);
	});
	var preferred = packages.find(function (pkg) {
		return pkg.id === profile.autoRechargePackageId;
	}) || packages.find(function (pkg) {
		return Number(pkg.points || 0) >= shortfall;
	}) || packages[0];
	if (preferred)
		selector.val(preferred.id);
	selector.prop('disabled', packages.length < 1);
	modal.find('.content-translation-modal-auto .form-check-input').prop('checked', profile.autoRechargeEnabled === true);
}

function populateContentTranslationModalLanguages(modal, languages, preferred, currentLanguage) {
	var selector = modal.find('.content-translation-modal-language');
	languages = normalizeContentTranslationLanguages(languages);
	selector.empty();
	languages.forEach(function (language) {
		if (!language || !language.code)
			return;
		$('<option>').attr({
			value: language.code,
			dir: 'ltr'
		}).text(language.label || language.code.toUpperCase()).appendTo(selector);
	});
	if (languages.some(function (language) { return language.code === preferred; }))
		selector.val(preferred);
	else if (languages.some(function (language) { return language.code === currentLanguage; }))
		selector.val(currentLanguage);
	else if (languages.length)
		selector.val(languages[0].code);
	setNeutralLanguageSelectDisplay(selector);
	selector.prop('disabled', !languages.length);
	modal.find('.content-translation-modal-submit').prop('disabled', !languages.length);
}

function openContentTranslationModal(options) {
	var modal = ensureContentTranslationModal();
	var target = options.target;
	contentTranslationModalState = {
		target: target,
		defaultHtml: target.html() || '',
		itemType: options.itemType,
		itemId: options.itemId,
		currentLanguage: options.currentLanguage || 'en',
		balance: null,
		profile: null,
		paymentConfig: null,
		estimate: contentTranslationLocalEstimate(target, null)
	};
	modal.find('.content-translation-modal-language').prop('disabled', true).empty().append($('<option>').text('Loading languages...'));
	modal.find('.content-translation-modal-package').prop('disabled', true).empty();
	modal.find('.content-translation-modal-submit').prop('disabled', true);
	updateContentTranslationModalEstimate();
	contentTranslationConfig().then(function (config) {
		config = config || {};
		contentTranslationModalState.estimate = contentTranslationLocalEstimate(target, config);
		populateContentTranslationModalLanguages(modal, config.languages || [], contentTranslationModalState.currentLanguage, contentTranslationModalState.currentLanguage);
		updateContentTranslationModalEstimate();
		preferredContentLanguage().then(function (preferred) {
			var languages = config.languages || [];
			var selector = modal.find('.content-translation-modal-language');
			if (preferred && languages.some(function (language) { return language.code === preferred; })) {
				selector.val(preferred);
				setNeutralLanguageSelectDisplay(selector);
			}
		});
	}).catch(function () {
		modal.find('.content-translation-modal-language').empty().append($('<option>').text('Languages unavailable'));
		modal.find('.content-translation-modal-submit').prop('disabled', true);
	});
	contentTranslationPaymentSummary().then(function (summary) {
		contentTranslationModalState.balance = Number(summary && summary.balance);
		contentTranslationModalState.profile = summary && summary.profile || {};
		contentTranslationModalState.paymentConfig = summary && summary.config || {};
		populateContentTranslationPackages(modal, contentTranslationModalState);
		updateContentTranslationModalEstimate();
	}).catch(function (err) {
		contentTranslationModalState.balance = null;
		contentTranslationModalState.profile = null;
		contentTranslationModalState.paymentConfig = null;
		modal.find('.content-translation-modal-status').text(err.message || 'Sign in to view your points.');
		updateContentTranslationModalEstimate();
	});
	if (window.bootstrap && window.bootstrap.Modal)
		window.bootstrap.Modal.getOrCreateInstance(modal[0]).show();
	else
		modal.show();
}

async function submitContentTranslationModal() {
	var modal = $('#content-translation-modal');
	var state = contentTranslationModalState;
	if (!state || !state.target || !state.itemType || !state.itemId)
		return;
	if (!contentTranslationFeatureEnabled(state.itemType)) {
		if (window.toastr)
			toastr.info('Content translation is disabled.', 'Translation');
		return;
	}
	var selector = modal.find('.content-translation-modal-language');
	var submit = modal.find('.content-translation-modal-submit');
	var language = selector.val() || '';
	if (!language) {
		if (window.toastr)
			toastr.info('Choose a language first.', 'Translation');
		return;
	}
	try {
		selector.prop('disabled', true);
		submit.prop('disabled', true);
		if (!Number.isFinite(Number(state.balance))) {
			modal.find('.content-translation-modal-status').text('Checking your point balance...');
			var summary = await contentTranslationPaymentSummary();
			state.balance = Number(summary && summary.balance);
			state.profile = summary && summary.profile || {};
			state.paymentConfig = summary && summary.config || {};
			populateContentTranslationPackages(modal, state);
			updateContentTranslationModalEstimate();
		}
		if (Number(state.balance || 0) >= Number(state.estimate && state.estimate.points || 0)) {
			await translateContentTranslationModal(language);
			return;
		}
		await startContentTranslationCheckout(language);
	} catch (err) {
		if (!resetHadithContentTranslationScope(state.target))
			state.target.html(state.defaultHtml);
		if (window.toastr)
			toastr.error(err.message || 'Unable to translate text.', 'Translation');
	} finally {
		selector.prop('disabled', false);
		submit.prop('disabled', false);
		updateContentTranslationModalEstimate();
	}
}

function setContentTranslationModalBusy(modal, busy, statusText, submitText) {
	modal = modal && modal.jquery ? modal : $('#content-translation-modal');
	if (contentTranslationModalState)
		contentTranslationModalState.busy = busy === true;
	modal.toggleClass('is-busy', busy === true);
	modal.find('.btn-close, .content-translation-modal-cancel').prop('disabled', busy === true);
	if (statusText)
		modal.find('.content-translation-modal-status').text(statusText);
	if (busy !== true)
		return;
	modal.find('.content-translation-modal-language, .content-translation-modal-package, .content-translation-modal-auto .form-check-input').prop('disabled', true);
	modal.find('.content-translation-modal-submit').prop('disabled', true).text(submitText || 'Working...');
}

function waitForContentTranslationPaint() {
	return new Promise(function (resolve) {
		if (window.requestAnimationFrame)
			window.requestAnimationFrame(function () { resolve(); });
		else
			window.setTimeout(resolve, 0);
	});
}

async function translateContentTranslationModal(language) {
	var modal = $('#content-translation-modal');
	var state = contentTranslationModalState;
	setContentTranslationModalBusy(modal, true, 'Translation in progress...', 'Translating...');
	try {
		var result = await contentTranslationRequest(state.itemType, state.itemId, language, 'translate', false);
		applyContentTranslationResult(state.target, result, language);
		upsertAvailableContentTranslation(state.target, state.itemType, state.itemId, result, language);
		loadAvailableContentTranslationSelector(state.target, state.itemType, state.itemId, language, true);
		await waitForContentTranslationPaint();
		setContentTranslationModalBusy(modal, false);
		if (window.bootstrap && window.bootstrap.Modal)
			window.bootstrap.Modal.getOrCreateInstance(modal[0]).hide();
		else
			modal.hide();
	} catch (err) {
		setContentTranslationModalBusy(modal, false);
		throw err;
	}
}

async function startContentTranslationCheckout(language) {
	var modal = $('#content-translation-modal');
	var state = contentTranslationModalState;
	var packageId = modal.find('.content-translation-modal-package').val() || '';
	if (!packageId)
		throw new Error('Choose a point package to continue.');
	savePendingContentTranslationCheckout(state, language);
	modal.find('.content-translation-modal-status').text('Opening secure checkout...');
	var session = await contentTranslationPaymentRequest('/payments/content-translation-checkout', {
		method: 'POST',
		body: JSON.stringify({
			packageId: packageId,
			autoRecharge: modal.find('.content-translation-modal-auto .form-check-input').prop('checked') === true,
			autoRechargeThreshold: state.profile && state.profile.autoRechargeThreshold || undefined,
			itemType: state.itemType,
			itemId: state.itemId,
			targetLanguage: language,
			mode: 'translate',
			returnPath: contentTranslationCheckoutReturnPath()
		})
	}, 'Please sign in to buy points.');
	if (!session || !session.url)
		throw new Error('Unable to start checkout.');
	window.location.href = session.url;
}

async function resumePendingContentTranslationCheckout() {
	if (!paymentFeatureEnabled())
		return;
	if (contentTranslationCheckoutResumeInProgress)
		return;
	var params = new URLSearchParams(window.location.search || '');
	var status = params.get('translation_payment') || '';
	var pending = readPendingContentTranslationCheckout();
	var sessionId = params.get('session_id') || pending && pending.checkoutSessionId || '';
	if (!status && !(pending && pending.checkoutSessionId))
		return;
	if (status) {
		params.delete('translation_payment');
		params.delete('session_id');
		var cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
		window.history.replaceState(null, document.title, cleanUrl);
	}
	if (status && status !== 'success') {
		clearPendingContentTranslationCheckout();
		if (window.toastr)
			toastr.info('Payment was cancelled.', 'Translation');
		return;
	}
	if (!pending || !/^cs_(?:test|live)_/.test(sessionId)) {
		await cancelPendingContentTranslationCheckout(sessionId, pending);
		clearPendingContentTranslationCheckout();
		if (window.toastr)
			toastr.info('Payment authorization was released. Reopen the item to translate it.', 'Translation');
		return;
	}
	if (!contentTranslationFeatureEnabled(pending.itemType)) {
		await cancelPendingContentTranslationCheckout(sessionId, pending);
		clearPendingContentTranslationCheckout();
		if (window.toastr)
			toastr.info('Payment authorization was released because translation is disabled.', 'Translation');
		return;
	}
	if (status)
		savePendingContentTranslationCheckout(pending, pending.language, { checkoutSessionId: sessionId });
	contentTranslationCheckoutResumeInProgress = true;
	try {
		var target = $(`[data-content-translation-item-type="${pending.itemType}"][data-content-translation-item-id]`).filter(function () {
			return $(this).attr('data-content-translation-item-id') === String(pending.itemId);
		}).first();
		if (!target.length) {
			if (pending.itemType === 'tafsir') {
				savePendingContentTranslationCheckout(pending, pending.language, { checkoutSessionId: sessionId });
				return;
			}
			await cancelPendingContentTranslationCheckout(sessionId, pending);
			clearPendingContentTranslationCheckout();
			if (window.toastr)
				toastr.info('Payment authorization was released. Reopen the item to translate it.', 'Translation');
			return;
		}
		if (window.toastr)
			toastr.info('Translation in progress...', 'Translation');
		preserveHadithContentTranslationScope(target);
		var result = await contentTranslationRequest(pending.itemType, pending.itemId, pending.language, 'translate', false, {
			checkoutSessionId: sessionId
		});
		applyContentTranslationResult(target, result, pending.language);
		upsertAvailableContentTranslation(target, pending.itemType, pending.itemId, result, pending.language);
		loadAvailableContentTranslationSelector(target, pending.itemType, pending.itemId, pending.language, true);
		clearPendingContentTranslationCheckout();
	} catch (err) {
		if (window.toastr)
			toastr.error(err.message || 'Unable to finish translation.', 'Translation');
	} finally {
		contentTranslationCheckoutResumeInProgress = false;
	}
}

function appendContentTranslationControl(container, target, itemType, itemId, currentLanguage) {
	if (!contentTranslationFeatureEnabled(itemType))
		return;
	if (!container || !target || !target.length || !itemType || !itemId)
		return;
	if (target.data('contentTranslationControlBound'))
		return;
	currentLanguage = currentLanguage || readGlobalContentLanguage() || target.attr('data-content-translation-language') || target.attr('lang') || 'en';
	target.data('contentTranslationControlBound', true);
	preserveHadithContentTranslationScope(target);
	var existingTranslation = target.attr('data-content-translation-existing') === 'true';
	var label = existingTranslation ? 'Revise or Translate' : 'Translate';
	var itemClass = itemType.toString().replace(/[^a-z0-9_-]/gi, '').toLowerCase();
	var row = ensureContentTranslationActionsRow(target);
	var control = $('<div>').addClass(`content-translation-control content-translation-control-${itemClass}`).attr({
		title: existingTranslation ? 'Revise translation with points' : 'Translate with points',
		lang: 'en',
		dir: 'ltr'
	});
	if (existingTranslation && target.attr('data-content-translation-show-control') !== 'true')
		control.addClass('content-translation-auth-only').prop('hidden', true);
	$('<button>').addClass((existingTranslation ? 'btn btn-sm btn-primary content-translate-button content-translation-revise-button' : 'btn btn-sm btn-primary content-translate-button') + ` content-translate-button-${itemClass}`).attr({
		type: 'button',
		title: label,
		'aria-label': label,
		lang: 'en',
		dir: 'ltr'
	}).append($('<span>').addClass('bi bi-translate content-translate-button-icon').attr('aria-hidden', 'true')).append(' ').append($('<span>').addClass('content-translate-button-label').text(label)).on('click', function () {
		openContentTranslationModal({
			target: target,
			itemType: itemType,
			itemId: itemId,
			currentLanguage: target.attr('data-content-translation-language') || currentLanguage || readGlobalContentLanguage() || target.attr('lang') || 'en'
		});
	}).appendTo(control);
	scheduleAvailableContentTranslationSelector(target, itemType, itemId, currentLanguage);
	if (row.length)
		row.append(control);
	else
		$(container).append(control);
}

async function refreshContentTranslationAuthControls() {
	var controls = $('.content-translation-auth-only');
	if (!controls.length)
		return;
	var user = null;
	try {
		var auth = await waitForHadithAuth();
		user = auth && auth.getUser ? await auth.getUser() : null;
	} catch (_err) {
		user = null;
	}
	controls.prop('hidden', !user);
}

function bindContentTranslationAuthRefresh() {
	if (contentTranslationAuthRefreshBound)
		return;
	contentTranslationAuthRefreshBound = true;
	document.addEventListener('hadithAuthChanged', function () {
		refreshContentTranslationAuthControls();
	});
}

function initHadithContentTranslationControls(root) {
	if (!paymentFeatureEnabled())
		return;
	bindContentTranslationAuthRefresh();
	var scope = root || document;
	$(scope).find('[data-content-translation-item-type="hadith"][data-content-translation-item-id]').each(function () {
		var target = $(this);
		var itemId = target.attr('data-content-translation-item-id');
		if (target.attr('data-content-translation-auto-only') === 'true') {
			preserveHadithContentTranslationScope(target);
			loadAvailableContentTranslationSelector(target, 'hadith', itemId, readGlobalContentLanguage() || target.attr('data-content-translation-preferred-language') || target.attr('data-content-translation-language') || target.attr('lang') || 'en', false);
			return;
		}
		var container = target.closest('[data-content-translation-container="1"]');
		appendContentTranslationControl(container.length ? container : target.parent(), target, 'hadith', itemId, readGlobalContentLanguage() || target.attr('data-content-translation-language') || target.attr('lang') || 'en');
	});
	refreshContentTranslationAuthControls();
}

function initLegacyHadithTranslationLink() {
	if (!paymentFeatureEnabled())
		return;
	var params = new URLSearchParams(window.location.search || '');
	if (params.get('translate') !== '1')
		return;
	var itemType = (params.get('translateType') || 'hadith').toString().toLowerCase();
	if (itemType !== 'hadith')
		return;
	var itemId = (params.get('translateItem') || '').toString();
	var attempts = 0;
	var maxAttempts = 20;

	function clearLegacyParams() {
		params.delete('translate');
		params.delete('translateItem');
		params.delete('translateType');
		var cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash || ''}`;
		window.history.replaceState(null, document.title, cleanUrl);
	}

	function findTarget() {
		var targets = $('[data-content-translation-item-type="hadith"][data-content-translation-item-id]');
		if (!itemId)
			return targets.first();
		return targets.filter(function () {
			return $(this).attr('data-content-translation-item-id') === itemId;
		}).first();
	}

	function tryOpen() {
		var target = findTarget();
		if (target.length) {
			clearLegacyParams();
			if (target[0].scrollIntoView)
				target[0].scrollIntoView({ block: 'center' });
			openContentTranslationModal({
				target: target,
				itemType: 'hadith',
				itemId: itemId || target.attr('data-content-translation-item-id'),
				currentLanguage: target.attr('data-content-translation-language') || readGlobalContentLanguage() || target.attr('lang') || 'en'
			});
			return;
		}
		attempts += 1;
		if (attempts < maxAttempts) {
			window.setTimeout(tryOpen, 100);
			return;
		}
		clearLegacyParams();
		if (window.toastr)
			toastr.info('Translation controls are unavailable for this item.', 'Translation');
	}

	window.setTimeout(tryOpen, 0);
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
		var copyTextButton = modal.querySelector('.hadith-share-copy-text');
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
			if (card && card.getAttribute('data-share-generated-item-type'))
				initGeneratedShareLanguageSelect(modal, card);
			if (modalRoot.classList.contains('quran-share-root'))
				initQuranShareTranslationSelect(modal, card);
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
				card.classList.toggle('hadith-share-editing', editing);
				setHadithShareLogoRemoveControls(modal, editing);
				editButton.title = editing ? 'Done editing' : 'Edit text';
				editButton.setAttribute('aria-label', editing ? 'Done editing' : 'Edit text');
				editButton.innerHTML = editing ? '<span class="bi bi-check2"></span>' : '<span class="bi bi-pencil"></span>';
				modal.querySelectorAll('.share-editable').forEach(function (el) {
					el.setAttribute('contenteditable', editing ? 'true' : 'false');
				});
				modal.querySelectorAll('.quran-share-translation-control').forEach(function (el) {
					el.classList.toggle('d-none', !editing);
				});
				if (editing)
					initQuranShareTranslationSelect(modal, card);
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
				updateHadithShareMetadataFromEditable(modal, card);
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			});
		});

		modal.querySelectorAll('.hadith-share-logo-remove').forEach(function (button) {
			button.addEventListener('click', function () {
				var logo = button.closest('[data-share-logo]');
				if (logo)
					logo.remove();
				scheduleHadithShareCardFit(card);
				scheduleHadithShareRender(card);
			});
		});

		if (copyButton) {
			copyButton.addEventListener('click', function () {
				exportHadithShareCard(card, 'copy', copyButton);
			});
		}

		if (copyTextButton) {
			copyTextButton.addEventListener('click', function () {
				copyHadithShareCardText(card, copyTextButton);
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

function setHadithShareLogoRemoveControls(modal, visible) {
	(modal || document).querySelectorAll('.hadith-share-logo-remove').forEach(function (button) {
		button.hidden = !visible;
		button.style.display = visible ? 'inline-flex' : 'none';
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
		var modal = card.closest('.hadith-share-modal');
		var visibleLogoRemoveButtons = Array.from(modal ? modal.querySelectorAll('.hadith-share-logo-remove') : []).filter(function (button) {
			return !button.hidden && button.style.display !== 'none';
		});
		try {
			fitHadithShareCard(card);
			card.classList.add('is-exporting');
			visibleLogoRemoveButtons.forEach(function (button) {
				button.hidden = true;
				button.style.display = 'none';
			});
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
			visibleLogoRemoveButtons.forEach(function (button) {
				button.hidden = false;
				button.style.display = 'inline-flex';
			});
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
		if (!Number.isFinite(value))
			value = 100;
		if (control.dataset.shareSizeDisableTarget === 'arabic') {
			var hideArabic = value <= 0;
			var modal = card.closest('.hadith-share-modal') || document;
			modal.querySelectorAll('.hadith-share-arabic-section').forEach(function (section) {
				section.classList.toggle('d-none', hideArabic);
			});
			card.classList.toggle('hadith-share-english-only', hideArabic);
			if (hideArabic) {
				card.style.setProperty(prop, '1.00');
				return;
			}
		}
		if (control.dataset.shareSizeDisableTarget === 'translation') {
			var hideTranslations = value <= 0;
			var translationModal = card.closest('.hadith-share-modal') || document;
			translationModal.querySelectorAll('.hadith-share-translation-section').forEach(function (section) {
				section.classList.toggle('d-none', hideTranslations);
			});
			card.classList.toggle('hadith-share-arabic-only', hideTranslations);
			if (hideTranslations) {
				card.style.setProperty(prop, '1.00');
				return;
			}
		}
		if (value <= 0)
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

function plainTextFromShareSection(section) {
	if (!section || section.classList.contains('d-none'))
		return '';
	var copyBody = section.querySelector('[data-share-copy-body="1"]') || section.querySelector('.hadith-share-text');
	var text = copyBody ? copyBody.innerText : section.innerText;
	return (text || '').replace(/\n{3,}/g, '\n\n').trim();
}

function updateHadithShareMetadataFromEditable(modal, card) {
	if (!card)
		return;
	if (!modal)
		modal = card.closest('.hadith-share-modal');
	if (!modal)
		return;
	var refEditors = modal.querySelectorAll('[data-share-ref-editor="1"]');
	var ref = '';
	var fallbackRef = '';
	Array.from(refEditors).forEach(function (editor) {
		var candidate = (editor.innerText || '').trim().replace(/\s+/g, ' ');
		if (!candidate)
			return;
		if (!fallbackRef)
			fallbackRef = candidate;
		if (editor.offsetParent !== null)
			ref = candidate;
	});
	ref = (ref || fallbackRef || '').trim();
	if (ref) {
		card.setAttribute('data-share-ref', ref);
		return;
	}
	card.setAttribute('data-share-ref', card.getAttribute('data-share-ref') || '');
}

function hadithShareCardText(card) {
	if (!card)
		return '';
	var lines = [];
	var title = card.querySelector('.hadith-share-title');
	if (title && !title.classList.contains('d-none') && (title.innerText || '').trim())
		lines.push(title.innerText.trim());
	card.querySelectorAll('.hadith-share-section').forEach(function (section) {
		var text = plainTextFromShareSection(section);
		if (text)
			lines.push(text);
	});
	var ref = card.getAttribute('data-share-ref') || '';
	if (ref)
		lines.push(ref);
	var site = card.querySelector('.hadith-share-site');
	var siteName = (site && (site.innerText || '').trim()) || 'hadithunlocked.com';
	lines.push(siteName);
	return lines.filter(Boolean).join('\n\n');
}

async function copyHadithShareCardText(card, button) {
	var text = hadithShareCardText(card);
	if (!text) {
		if (window.toastr)
			toastr.error('No text available to copy.');
		return;
	}
	var originalHtml = button ? button.innerHTML : '';
	var originalDisabled = button ? button.disabled : false;
	if (button) {
		button.disabled = true;
		button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>';
	}
	try {
		await copyTextToClipboard(text);
		if (window.toastr)
			toastr.success('Text copied to clipboard');
	} catch (err) {
		if (window.toastr)
			toastr.error('Unable to copy text.');
	} finally {
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

function cssEscape(value) {
	if (window.CSS && window.CSS.escape)
		return window.CSS.escape(value);
	return value.toString().replace(/["\\]/g, '\\$&');
}
