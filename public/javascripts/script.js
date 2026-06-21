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
	initTafsirSearchFilterPills(document);
	initHomeQuranAnnouncement(document);
	initRandomTocItemLoader(document);
	initQuranPassageNavigator();
	initBookNavScroller();
	initTafsirBookCarousels(document);

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
	});

	initMarkdownEditablePreviews(document);
	initHadithSharhLinks(document);
	initHadithShareModals(document);
	initQuranAyahHoverPairs(document);
	initQuranAyahSelector(document);
	initQuranDynamicPassageHero(document);
	canonicalizeQuranTranslationPageUrl();
	initQuranPreferredTranslationDisplays(document);
	initQuranTranslations(document);
	initQuranAyahModals(document);
	initQuranPageKeyboardNavigation(document);
	initQuranPassageShareLinks(document);
	initQuranCorpusTooltips(document);
	initQuranCorpusTooltipDelay(document);
	initQuranTafsirTabs(document);
	initQuranTafsirFootnotePopups(document);
	initTocExpandCollapse(document);
	initTocContentFilters(document);
	initTocInlineDescriptionExpanders(document);

});

function updateFixedHeaderOffset(extraHeight) {
	var navbar = document.querySelector('.site-navbar.fixed-top');
	if (!navbar)
		return;
	var height = navbar.getBoundingClientRect().height + (extraHeight || 0);
	document.documentElement.style.setProperty('--site-fixed-header-height', `${Math.ceil(height)}px`);
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
				initQuranAyahHoverPairs(container);
				initQuranPreferredTranslationDisplays(container);
				initQuranCorpusTooltips(container);
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
}

function getHadithEditMode() {
	try {
		return localStorage.getItem('hadithdb_edit_mode') === '1';
	} catch (err) {
		return false;
	}
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

function hadithLoginSessionCacheBridgeUrl(baseUrl) {
	try {
		return new URL('/login/cache-bridge', baseUrl || window.location.origin).href;
	} catch (err) {
		return '';
	}
}

function requestHadithLoginSessionCacheBridge(baseUrl, action, session) {
	var bridgeUrl = hadithLoginSessionCacheBridgeUrl(baseUrl);
	var bridgeOrigin = originFromUrl(bridgeUrl);
	if (!bridgeUrl || !bridgeOrigin || bridgeOrigin === window.location.origin)
		return Promise.resolve(null);
	return new Promise(function (resolve) {
		var requestId = `login-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		var iframe = document.createElement('iframe');
		var done = false;
		var finish = function (value) {
			if (done)
				return;
			done = true;
			window.clearTimeout(timeout);
			window.removeEventListener('message', onMessage);
			if (iframe.parentNode)
				iframe.parentNode.removeChild(iframe);
			resolve(value);
		};
		var onMessage = function (event) {
			var data = event.data || {};
			if (event.origin !== bridgeOrigin || !data || data.type !== 'hadithdbLoginSessionCacheBridgeResponse' || data.requestId !== requestId)
				return;
			if (action === 'read')
				finish(data.session || null);
			else
				finish(data.ok ? (data.session || true) : null);
		};
		var timeout = window.setTimeout(function () {
			finish(null);
		}, 1500);
		window.addEventListener('message', onMessage);
		iframe.style.display = 'none';
		iframe.setAttribute('aria-hidden', 'true');
		iframe.onload = function () {
			try {
				iframe.contentWindow.postMessage({
					type: 'hadithdbLoginSessionCacheBridge',
					requestId: requestId,
					action: action,
					session: session || null
				}, bridgeOrigin);
			} catch (err) {
				finish(null);
			}
		};
		iframe.src = bridgeUrl;
		document.body.appendChild(iframe);
	});
}

function hadithLoginSessionPeerBaseUrls() {
	return [window.HADITH_BASE_URL || '', window.HADITH_QURAN_BASE_URL || '']
		.filter(function (baseUrl, index, urls) {
			var origin = originFromUrl(baseUrl);
			return origin && origin !== window.location.origin && urls.findIndex(function (candidate) {
				return originFromUrl(candidate) === origin;
			}) === index;
		});
}

function readPeerHadithLoginSessionCache() {
	var peers = hadithLoginSessionPeerBaseUrls();
	return peers.reduce(function (promise, baseUrl) {
		return promise.then(function (session) {
			if (session)
				return session;
			return requestHadithLoginSessionCacheBridge(baseUrl, 'read');
		});
	}, Promise.resolve(null)).then(function (session) {
		if (session && session.loggedIn) {
			writeHadithLoginSessionCache(session);
			return readHadithLoginSessionCache();
		}
		return null;
	});
}

function writePeerHadithLoginSessionCache(session) {
	return Promise.all(hadithLoginSessionPeerBaseUrls().map(function (baseUrl) {
		return requestHadithLoginSessionCacheBridge(baseUrl, 'write', session);
	})).catch(function () {
		return null;
	});
}

function clearPeerHadithLoginSessionCache() {
	return Promise.all(hadithLoginSessionPeerBaseUrls().map(function (baseUrl) {
		return requestHadithLoginSessionCacheBridge(baseUrl, 'clear');
	})).catch(function () {
		return null;
	});
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
		readPeerHadithLoginSessionCache().then(function (peerSession) {
			if (peerSession) {
				window.hadithAdmin = Boolean(peerSession.admin);
				window.hadithAdminSessionChecked = true;
				renderHadithAdminGear();
			} else {
				window.hadithAdminSessionChecked = true;
				renderHadithAdminGear();
			}
		});
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
	if (!isQuranSubdomainHost(window.location.hostname))
		return path;
	if (path.charAt(0) !== '/')
		path = '/' + path;
	if (path === '/quran' || path.indexOf('/quran/') === 0 || path.indexOf('/quran:') === 0)
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

var quranTafsirStorageKeys = {
	alias: 'hadithdb_quran_tafsir_alias',
	language: 'hadithdb_quran_tafsir_language',
	open: 'hadithdb_quran_tafsir_open',
	legacyAlias: 'quranTafsirAlias'
};

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
		var ayahs = (container.attr('data-ayahs') || '').split(',').filter(Boolean).map(Number).filter(function (ayah) {
			return Number.isInteger(ayah) && ayah >= 0;
		});
			var selectedAyahs = (container.attr('data-selected-ayahs') || '').split(',').filter(Boolean).map(Number).filter(function (ayah) {
				return Number.isInteger(ayah) && ayah >= 0;
			});
			var ayahText = JSON.parse(container.find('.quran-tafsir-ayah-data').text() || '{}');
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
			var tafsirUrlSlug = function (alias) {
				return (alias || '').toString().replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '');
			};
			var dedicatedTafsirPassageMatch = function () {
				if ((container.attr('data-tafsir-instance') || 'passage') !== 'passage')
					return null;
				return window.location.pathname.match(/^\/quran\/tafsir\/([^/]+)\/(\d+)\/(\d+)\/?$/);
			};
			var dedicatedTafsirPassageUrl = function (alias, language) {
				var match = dedicatedTafsirPassageMatch();
				if (!match || !alias)
					return '';
				var query = language === 'ar' || language === 'en' ? `?lang=${encodeURIComponent(language)}` : '';
				return `/quran/tafsir/${encodeURIComponent(tafsirUrlSlug(alias))}/${match[2]}/${match[3]}${query}`;
			};
			var currentDedicatedTafsirPassageUrl = function () {
				var match = dedicatedTafsirPassageMatch();
				if (!match)
					return '';
				return window.location.pathname;
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
				return quranUrl(`/quran/tafsir/${encodeURIComponent(tafsirUrlSlug(alias))}/${encodeURIComponent(surah)}/${encodeURIComponent(ayah)}`);
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
			$('<span>').addClass('quran-tafsir-ayah-text').text(ayahText[ayah] || '').appendTo(link);
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
				var fullName = isArabic ? (book.name || book.name_en) : (book.name_en || book.name);
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
				var title = book.shortName_en || book.shortName || book.name_en || book.name || book.alias || 'Tafsir';
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
				if (book.name || book.shortName || book.author)
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
					? (book.name || book.shortName || book.shortName_en || book.alias)
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
				if (book.name || book.author) {
					var arabicTitle = $('<strong>').appendTo(arabic);
					if (rendersTafsirPassagePage)
						appendTafsirBookNameTrigger(arabicTitle, book, 'ar');
					else
						arabicTitle.text(book.name || '');
					$('<span>').text([
						book.author,
						book.death ? `d. ${toArabicDigits(book.death)} هـ` : '',
						commentaryPublicationLabel(book)
					].filter(Boolean).join('، ')).appendTo(arabic);
				}
			};
			var tafsirTooltipText = function (book) {
				var fullName = book.name_en || book.name || book.shortName_en || book.shortName || book.alias || '';
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
			return window.hadithAdmin === true ? '&flush=1' : '';
		};
		var adminTafsirQuery = function () {
			return window.hadithAdmin === true ? '?flush=1' : '';
		};
		var fetchPayload = async function (src, source, ayah, language) {
			var endpoint = quranApiPath(source === 'local' ? '/proxy/tafsir/local' : '/proxy/tafsir');
			var languageParam = source === 'local' && language ? `&lang=${encodeURIComponent(language)}` : '';
			var response = await fetch(`${endpoint}?src=${encodeURIComponent(src)}&s=${encodeURIComponent(surah)}&a=${encodeURIComponent(ayah)}&ver=1${languageParam}${adminTafsirCacheParam()}`);
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
				var payloads = source === 'local'
					? (await fetchLocalPayloads(src, panel.attr('data-tafsir-lang'))).map(function (payload) {
						return {
							ayah: payload.ayahs_start,
							payload: payload
						};
					})
					: await Promise.all(ayahs.map(async function (ayah) {
						return {
							ayah: ayah,
							payload: cleanTafsirPayload(await fetchPayload(src, source, ayah, panel.attr('data-tafsir-lang')))
						};
					}));
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
				entries.forEach(function (entry) {
					var startAyah = Number(entry.payload.ayahs_start || entry.ayah);
					var count = Number(entry.payload.count || 0);
					var endAyah = startAyah + count;
					var entryElement = $(rendersCollapsibleEntries ? '<details>' : '<article>').addClass('quran-tafsir-entry');
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
				fetch(`${quranApiPath('/proxy/tafsir/books')}${adminTafsirQuery()}`).then(function (response) {
					if (!response.ok)
						throw new Error('Unable to load tafsir list.');
				return response.json();
			}),
			getQuranTafsirSettings()
		]).then(function (results) {
			var books = results[0];
			var settings = results[1];
			var usePersonalizedTafsirs = settings && settings.personalized === true;
			var tafsirs = usePersonalizedTafsirs ? ((settings || {}).tafsirs || {}) : {};
			var disabledAliases = new Set(Array.isArray(tafsirs.disabledAliases) ? tafsirs.disabledAliases : []);
			var tafsirOrder = tafsirs.order && typeof tafsirs.order === 'object' && !Array.isArray(tafsirs.order) ? tafsirs.order : {};
			allTafsirBookAliases = { en: [], ar: [] };
			(Array.isArray(books) ? books : []).forEach(function (book) {
				if (book && (book.lang === 'en' || book.lang === 'ar') && book.alias)
					allTafsirBookAliases[book.lang].push(book.alias);
			});
			var visibleBooks = (Array.isArray(books) ? books : []).filter(function (book) {
				return !disabledAliases.has(book.alias);
			}).map(function (book, originalIndex) {
				return { book: Object.assign({}, book, { disabled: disabledAliases.has(book.alias) }), originalIndex: originalIndex };
			});
			if (usePersonalizedTafsirs)
				visibleBooks.sort(function (a, b) {
					return compareTafsirPreferenceEntries(a, b, tafsirOrder);
				});
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
			return window.hadithAdmin === true ? '&flush=1' : '';
		};
			var adminQuery = function () {
				return window.hadithAdmin === true ? '?flush=1' : '';
			};
			var allTranslationBookAliases = [];
			var selectedTranslationAlias = '';
			try {
				selectedTranslationAlias = (new URLSearchParams(window.location.search).get('translation') || '').trim();
			} catch (_err) {
				selectedTranslationAlias = '';
			}
			if (!/^[A-Za-z0-9_-]+$/.test(selectedTranslationAlias))
				selectedTranslationAlias = '';
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
			var nextSettings = Object.assign({}, settings, {
				translations: Object.assign({}, translationSettings, {
					disabledAliases: Array.from(disabledSet),
					order: order
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
					book.name_en || book.name || book.alias,
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
		quranTranslationBooksPromise = fetch(`${quranApiPath('/proxy/translations/books')}${window.hadithAdmin === true ? '?flush=1' : ''}`)
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

function compactQuranTranslationHtml(html) {
	var wrapper = document.createElement('div');
	wrapper.innerHTML = html || '';
	wrapper.querySelectorAll('.footnotes, .footnote, hr').forEach(function (node) {
		node.remove();
	});
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

function quranTranslationTextFromPayload(payload) {
	var html = compactQuranTranslationHtml(payload && (payload.html || payload.data) || '');
	var wrapper = document.createElement('div');
	wrapper.innerHTML = html;
	return (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
}

function quranTranslationTargetHolder(target) {
	return target ? target.closest('.quran-ayah-hero-ayah, .body, .quran-share-english-section') || target.parentElement : null;
}

function quranTranslationTargetRef(target) {
	return {
		surah: target && target.getAttribute('data-quran-surah') || '',
		ayah: target && target.getAttribute('data-quran-ayah') || ''
	};
}

function storeDefaultQuranTranslationTarget(target) {
	if (!target)
		return;
	if (target.dataset.quranDefaultTranslationHtml === undefined)
		target.dataset.quranDefaultTranslationHtml = target.innerHTML || '';
	if (target.dataset.quranDefaultTranslationMarkdown === undefined)
		target.dataset.quranDefaultTranslationMarkdown = target.dataset.markdownSource || '';
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
	return fetch(`${quranApiPath('/proxy/translations/local')}?src=${encodeURIComponent(book.alias)}&s=${encodeURIComponent(surah)}&a=${encodeURIComponent(ayah)}&lang=${encodeURIComponent(book.lang || 'en')}${window.hadithAdmin === true ? '&flush=1' : ''}`)
		.then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load selected translation.');
			return response.json();
		});
}

function applyQuranTranslationToTarget(target, book) {
	storeDefaultQuranTranslationTarget(target);
	var alias = book && book.source !== 'default' ? book.alias : '';
	if (!book || book.source === 'default') {
		target.innerHTML = target.dataset.quranDefaultTranslationHtml || '';
		target.dataset.markdownSource = target.dataset.quranDefaultTranslationMarkdown || '';
		setQuranTranslationAttribution(target, defaultQuranTranslationShortName(), alias);
		return Promise.resolve();
	}
	var ref = quranTranslationTargetRef(target);
	if (!ref.surah || !ref.ayah)
		return Promise.resolve();
	return fetchQuranLocalTranslation(book, ref.surah, ref.ayah).then(function (payload) {
		var entry = Array.isArray(payload && payload.entries) ? payload.entries[0] : payload;
		if (!entry || !(entry.html || entry.data))
			return;
		target.innerHTML = compactQuranHeroTranslationHtml(entry.html || entry.data);
		target.dataset.markdownSource = entry.data || '';
		setQuranTranslationAttribution(target, quranTranslationBookLabel(book), alias);
	});
}

function applyQuranHeroTranslationAlias(alias, options) {
	options = options || {};
	return quranTranslationBooks().then(function (books) {
		var book = alias ? books.find(function (candidate) { return candidate && candidate.alias === alias; }) : quranDefaultTranslationBook(books);
		if (!book)
			book = quranDefaultTranslationBook(books);
		var selectedAlias = book && book.source !== 'default' ? book.alias : '';
		var targets = Array.from(document.querySelectorAll('[data-quran-translation-target="1"]'));
		return Promise.all(targets.map(function (target) {
			return applyQuranTranslationToTarget(target, book).catch(function () {
				return applyQuranTranslationToTarget(target, quranDefaultTranslationBook(books));
			});
		})).then(function () {
			if (options.persist)
				saveQuranPreferredTranslationAlias(selectedAlias).catch(function (err) {
					if (window.toastr)
						toastr.error(err.message || 'Unable to save translation preference.', 'Settings');
				});
			return book;
		});
	});
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
					var otherHolder = quranTranslationTargetHolder(otherSelector.closest('.quran-ayah-hero-ayah, .body')?.querySelector('[data-quran-translation-target="1"]'));
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
	var targets = Array.from(scope.querySelectorAll('[data-quran-translation-target="1"]')).filter(function (target) {
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
	getQuranTafsirSettings().then(function (settings) {
		if (window.quranTranslationUserSelectedAt && window.quranTranslationUserSelectedAt > initializedAt)
			return null;
		var preferredAlias = settings && settings.translations ? settings.translations.preferredAlias : '';
		return applyQuranHeroTranslationAlias(preferredAlias || '', { persist: false });
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

function userSettingsCacheBridgeUrl(baseUrl) {
	try {
		var path = window.location.pathname.indexOf('/quran/') === 0 ? '/quran/settings/cache-bridge' : '/settings/cache-bridge';
		return new URL(path, baseUrl || window.location.origin).href;
	} catch (err) {
		return '';
	}
}

function requestUserSettingsCacheBridge(baseUrl, action, user, settings) {
	var bridgeUrl = userSettingsCacheBridgeUrl(baseUrl);
	var bridgeOrigin = originFromUrl(bridgeUrl);
	if (!bridgeUrl || !bridgeOrigin || !user)
		return Promise.resolve(null);
	return new Promise(function (resolve) {
		var requestId = `settings-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		var iframe = document.createElement('iframe');
		var done = false;
		var finish = function (value) {
			if (done)
				return;
			done = true;
			window.clearTimeout(timeout);
			window.removeEventListener('message', onMessage);
			if (iframe.parentNode)
				iframe.parentNode.removeChild(iframe);
			resolve(value);
		};
		var onMessage = function (event) {
			var data = event.data || {};
			if (event.origin !== bridgeOrigin || !data || data.type !== 'hadithUserSettingsCacheBridgeResponse' || data.requestId !== requestId)
				return;
			if (action === 'read')
				finish(data.settings || null);
			else
				finish(data.ok ? (data.settings || true) : null);
		};
		var timeout = window.setTimeout(function () {
			finish(null);
		}, 1500);
		window.addEventListener('message', onMessage);
		iframe.style.display = 'none';
		iframe.setAttribute('aria-hidden', 'true');
		iframe.onload = function () {
			try {
				iframe.contentWindow.postMessage({
					type: 'hadithUserSettingsCacheBridge',
					requestId: requestId,
					action: action,
					user: user,
					settings: settings || null
				}, bridgeOrigin);
			} catch (err) {
				finish(null);
			}
		};
		iframe.src = bridgeUrl;
		document.body.appendChild(iframe);
	});
}

function userSettingsCacheUser(user) {
	if (!user || typeof user !== 'object')
		return null;
	return {
		uid: user.uid || user.userId || '',
		email: user.email || ''
	};
}

function updateCachedQuranUserSettings(user, settings) {
	var cacheUser = userSettingsCacheUser(user);
	if (window.hadithUserSettingsCache && window.hadithUserSettingsCache.write)
		window.hadithUserSettingsCache.write(cacheUser, settings || {});
	window.hadithQuranUserSettingsOverride = settings || null;
	if (window.writeQuranDomainUserSettingsCache)
		window.writeQuranDomainUserSettingsCache(cacheUser, settings || {}).catch(function () {});
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

function readHadithDomainUserSettingsCache(user) {
	var hadithBaseUrl = window.HADITH_BASE_URL || '';
	if (!hadithBaseUrl || originFromUrl(hadithBaseUrl) === window.location.origin)
		return Promise.resolve(null);
	return requestUserSettingsCacheBridge(hadithBaseUrl, 'read', user).then(function (settings) {
		if (settings && window.hadithUserSettingsCache && window.hadithUserSettingsCache.write)
			window.hadithUserSettingsCache.write(user, settings);
		return settings || null;
	});
}

window.clearHadithDomainUserSettingsCache = function (user) {
	var hadithBaseUrl = window.HADITH_BASE_URL || '';
	if (!hadithBaseUrl || originFromUrl(hadithBaseUrl) === window.location.origin)
		return Promise.resolve(null);
	return requestUserSettingsCacheBridge(hadithBaseUrl, 'clear', user);
};

window.writeQuranDomainUserSettingsCache = function (user, settings) {
	var quranBaseUrl = window.HADITH_QURAN_BASE_URL || '';
	if (!quranBaseUrl || originFromUrl(quranBaseUrl) === window.location.origin)
		return Promise.resolve(null);
	return requestUserSettingsCacheBridge(quranBaseUrl, 'write', user, settings);
};

window.clearQuranDomainUserSettingsCache = function (user) {
	var quranBaseUrl = window.HADITH_QURAN_BASE_URL || '';
	if (!quranBaseUrl || originFromUrl(quranBaseUrl) === window.location.origin)
		return Promise.resolve(null);
	return requestUserSettingsCacheBridge(quranBaseUrl, 'clear', user);
};

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
			var translationDisabledAliases = Array.from(new Set((Array.isArray(translations.disabledAliases) ? translations.disabledAliases : [])
				.map(function (alias) { return (alias || '').toString().trim(); })
				.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias); })));
			var translationDisabled = new Set(translationDisabledAliases);
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
				},
				translations: {
					disabledAliases: translationDisabledAliases,
					order: Array.from(new Set((Array.isArray(translations.order) ? translations.order : [])
						.map(function (alias) { return (alias || '').toString().trim(); })
						.filter(function (alias) { return /^[A-Za-z0-9_-]+$/.test(alias) && !translationDisabled.has(alias); }))),
					preferredAlias: /^[A-Za-z0-9_-]+$/.test((translations.preferredAlias || '').toString().trim())
						? translations.preferredAlias.toString().trim()
						: ''
				}
			};
		};
		var defaultSettings = function () {
			var settings = normalizeSettings({});
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
		return waitForHadithAuth().then(function (auth) {
			return Promise.resolve(auth && auth.getUser ? auth.getUser() : null).then(function (settingsUser) {
				if (!settingsUser)
					return defaultSettings();
				return readHadithDomainUserSettingsCache(settingsUser).then(function (bridgedSettings) {
					var cachedSettings = bridgedSettings || (window.hadithUserSettingsCache && window.hadithUserSettingsCache.read
						? window.hadithUserSettingsCache.read(settingsUser)
						: null);
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
							return cachedSettings ? personalizedSettings(cachedSettings) : defaultSettings();
						});
					});
				});
			});
		});
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

function initQuranAyahModals(root) {
	var scope = root || document;
	var modalStates = $(document).data('quranAyahModalStates') || {};
	$(document).data('quranAyahModalStates', modalStates);
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
			var href = `/quran/tafsir/${encodeURIComponent(tafsirBrowseSlug(alias))}/${encodeURIComponent(surah)}/${encodeURIComponent(ayah)}`;
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
			return quranPath(`/quran/translations/${encodeURIComponent(surah)}/${encodeURIComponent(ayah)}`);
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
			initQuranTafsirTabs(pane[0]);
			initQuranTranslations(pane[0]);
			loadActiveCommentWidgets();
			scrollActiveTafsirTabs();
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
	value = (value || '').toString();
	if (!value)
		return '';
	if (window.marked && window.marked.parse)
		return window.marked.parse(value).replace(/<br>/g, '</p><p>').trim();
	return $('<div>').text(value).html();
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
	}).addClass('quran-ayah-action icon text-decoration-none')
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
	$('<p>').append($('<span>').text((ayah && ayah.ar && ayah.ar.body) || '').append(document.createTextNode(' ')).append($('<span>').addClass('quran-ayah-end-marker').attr('aria-label', `Quran ${arabicRef}`).text(`۝${toArabicDigits(arabicPart)}`))).appendTo($arText);
	$('<section>').addClass('hadith-share-section hadith-share-arabic-section').attr('lang', 'ar').append($arText).appendTo($inner);
	var $enText = $('<div>').addClass('body hadith-share-text quran-share-text share-editable').attr({ lang: 'en', contenteditable: 'false', 'data-quran-share-translation-target': '1' });
	$('<p>')
		.append($('<span>').append($('<sup>').text(ref)).append(document.createTextNode(' ')).append(document.createTextNode((ayah && ayah.en && ayah.en.body) || '')))
		.append(document.createTextNode(' '))
		.append($('<span>').addClass('quran-share-translation-attribution quran-translation-attribution').attr({ 'data-quran-share-translation-attribution': '1', contenteditable: 'false' }).text(`— ${defaultQuranTranslationShortName()}`))
		.appendTo($enText);
	$('<section>').addClass('hadith-share-section quran-share-english-section').attr('lang', 'en')
		.append($enText)
		.appendTo($inner);
	var $footer = $('<footer>').addClass('hadith-share-footer').appendTo($inner);
	$('<div>').append($('<div>').addClass('title share-editable').attr('contenteditable', 'false').text(chapterTitle ? `Qurʾān > ${chapterTitle}` : 'Qurʾān')).appendTo($footer);
	$('<div>').addClass('hadith-share-site').text('hadithunlocked.com').appendTo($footer);
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
		selector.innerHTML = '';
		orderedSelectableQuranTranslationBooks(books, settings).forEach(function (book) {
			var option = document.createElement('option');
			option.value = book.source === 'default' ? '' : book.alias;
			option.textContent = quranTranslationBookLabel(book);
			selector.appendChild(option);
		});
		var overridePreferredAlias = window.hadithQuranUserSettingsOverride && window.hadithQuranUserSettingsOverride.translations
			? window.hadithQuranUserSettingsOverride.translations.preferredAlias || ''
			: '';
		selector.value = selected || overridePreferredAlias || settings.translations && settings.translations.preferredAlias || '';
		if (selector.value)
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
		return fetch(`${quranApiPath('/proxy/translations/local')}?src=${encodeURIComponent(book.alias)}&s=${encodeURIComponent(parts.surah)}&from=${encodeURIComponent(parts.ayahFrom)}&to=${encodeURIComponent(parts.ayahTo)}&lang=${encodeURIComponent(book.lang || 'en')}${window.hadithAdmin === true ? '&flush=1' : ''}`)
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
	if (typeof initHadithShareModals === 'function')
		initHadithShareModals(document.getElementById(shareId));
}

function quranAyahHeroHtml(ayah) {
	if (!ayah)
		return '';
	var ref = quranAyahRef(ayah);
	var part = quranAyahPart(ref);
	var arabicRef = ((ayah.ar && ayah.ar.num) || ref).toString();
	var arabicPart = quranAyahPart(arabicRef);
	var previousHref = ayah.prev_ref ? quranUrl(`/${ayah.prev_ref}`) : '';
	var nextHref = ayah.next_ref ? quranUrl(`/${ayah.next_ref}`) : '';
	var navClass = previousHref || nextHref ? ' quran-ayah-hero-with-nav' : '';
	var $hero = $('<section>').addClass(`quran-ayah-hero row${navClass}`).attr('data-dynamic-quran-ayah-hero', '1');
	if (previousHref) {
		$('<a>').addClass('quran-ayah-hero-nav quran-ayah-hero-prev').attr({
			href: previousHref,
			rel: 'prev',
			title: 'Previous ayah',
			'aria-label': 'Previous ayah'
		}).append($('<span>').addClass('bi bi-chevron-left').attr('aria-hidden', 'true')).appendTo($hero);
	}
	if (nextHref) {
		$('<a>').addClass('quran-ayah-hero-nav quran-ayah-hero-next').attr({
			href: nextHref,
			rel: 'next',
			title: 'Next ayah',
			'aria-label': 'Next ayah'
		}).append($('<span>').addClass('bi bi-chevron-right').attr('aria-hidden', 'true')).appendTo($hero);
	}

	var $arSection = $('<section>').addClass('col-12').attr('lang', 'ar').appendTo($hero);
	var $arBody = $('<div>').addClass('quran-ayah-hero-body').appendTo($arSection);
	var $arAyah = $('<div>').addClass('quran-ayah-hero-ayah').appendTo($arBody);
	$('<div>').addClass('quran-ayah-hero-text').attr({
		'data-quran-ref': ref,
		'data-quran-surah': ref.split(/:/)[0] || '',
		'data-quran-ayah': part
	}).html(renderQuranHeroMarkdown(ayah.ar && ayah.ar.body)).appendTo($arAyah);
	$arAyah.append(document.createTextNode(' '));
	$('<span>').addClass('quran-ayah-end-marker').attr('aria-label', `Quran ${arabicRef}`).text(`۝${toArabicDigits(arabicPart)}`).appendTo($arAyah);

	var $enSection = $('<section>').addClass('col-12').attr('lang', 'en').appendTo($hero);
	var $enBody = $('<div>').addClass('quran-ayah-hero-body').appendTo($enSection);
	var $enAyah = $('<div>').addClass('quran-ayah-hero-ayah').appendTo($enBody);
	$('<sup>').text(ref).appendTo($enAyah);
	$enAyah.append(document.createTextNode(' '));
	$('<div>').addClass('quran-ayah-hero-text').attr({
		'data-quran-translation-target': '1',
		'data-quran-surah': ref.split(/:/)[0] || '',
		'data-quran-ayah': part
	}).html(renderQuranHeroMarkdown(ayah.en && ayah.en.body)).appendTo($enAyah);
	$enAyah.append(document.createTextNode(' '));
	$('<span>').addClass('quran-translation-attribution').attr('data-quran-translation-attribution', '1').text(`— ${defaultQuranTranslationShortName()}`).appendTo($enAyah);
	$hero.append(quranAyahHeroToolbarHtml(ayah, quranAyahShareId(ref)));
	initQuranPreferredTranslationDisplays($hero[0]);
	return $hero;
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
		return match ? `${match[1]}:${match[2]}` : '';
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
	var loadAyahHero = function (href, pushHistory) {
		var target = new URL(href, window.location.origin);
		var refMatch = target.pathname.match(/\/quran:(\d+):(\d+)$/);
		if (!refMatch)
			return Promise.reject(new Error('Only single Quran ayah links can update the hero dynamically.'));
		var ref = `${refMatch[1]}:${refMatch[2]}`;
		if (pendingRequest && pendingRequest.abort)
			pendingRequest.abort();
		pendingRequest = new AbortController();
		return fetch(quranApiPath(`${target.pathname}?json=1`), {
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
			var hero = $('[data-quran-selected-ayah-hero]').first();
			ensureQuranShareModal(ayah, quranAyahShareId(ref));
			hero.empty().append(quranAyahHeroHtml(ayah));
			if (window.refreshHadithActions)
				window.refreshHadithActions();
			setSelectedPassageAyah(ref);
			var corpusContainer = $('[data-quran-corpus-url]').first();
			var corpusUrl = corpusContainer.attr('data-quran-corpus-url');
			if (corpusUrl && quranCorpusPayloadCache[corpusUrl]) {
				quranCorpusPayloadCache[corpusUrl].then(function (payload) {
					annotateQuranCorpusWords(hero, payload.wordsByAyah || {});
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

	setSelectedPassageAyah(selectedRefFromPath());
	$(document).on('click.quranDynamicPassageHero', '.quran-passage-section .body.passage .ayah a[href]', function (event) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
			return;
		if ($('body').hasClass('quran-ayah-selecting'))
			return;
		if ($(event.target).closest('.quran-ayah-modal-trigger, button, ._e').length)
			return;
		var href = $(this).attr('href') || '';
		if (!/\/quran:\d+:\d+$/.test(new URL(href, window.location.origin).pathname))
			return;
		event.preventDefault();
		loadAyahHero(href, true).catch(function (err) {
			if (window.toastr)
				toastr.error(err.message || 'Unable to update selected ayah.');
			else
				window.location.href = href;
		});
	});
	window.addEventListener('popstate', function () {
		var ref = selectedRefFromPath();
		if (!ref) {
			$('[data-quran-selected-ayah-hero]').first().empty();
			setSelectedPassageAyah('');
			return;
		}
		loadAyahHero(`/quran:${ref}`, false).catch(function () {
			setSelectedPassageAyah(ref);
		});
	});
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
		tooltip.attr('hidden', true).text('');
	};
	var showTooltipNow = function (word) {
		var text = tooltipText(word);
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
	eventRoot.on('mouseenter focusin', tooltipTargetSelector, function () {
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
	eventRoot.on('mouseleave focusout', tooltipTargetSelector, function () {
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
				originalIndex: item.data('tafsirBookOriginalIndex') || 0
			};
		}).get();
	}

	function applyTafsirBookCarouselSettings(menu) {
		getQuranTafsirSettings().then(function (settings) {
			var usePersonalizedTafsirs = settings && settings.personalized === true;
			var tafsirs = usePersonalizedTafsirs ? ((settings || {}).tafsirs || {}) : {};
			var disabledAliases = new Set(Array.isArray(tafsirs.disabledAliases) ? tafsirs.disabledAliases : []);
			var order = tafsirs.order && typeof tafsirs.order === 'object' && !Array.isArray(tafsirs.order) ? tafsirs.order : {};
			var entries = tafsirBookCarouselEntries(menu);
			entries.sort(function (a, b) {
				return usePersonalizedTafsirs
					? compareTafsirPreferenceEntries(a, b, order)
					: (a.originalIndex || 0) - (b.originalIndex || 0);
			}).forEach(function (entry) {
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
				window.location.href = activeItem.is_quran ? quranUrl(activeItem.url) : hadithUrl(activeItem.url);
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
					window.location.href = ui.item.is_quran ? quranUrl(ui.item.url) : hadithUrl(ui.item.url);
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
					window.location.href = item.is_quran ? quranUrl(item.url) : hadithUrl(item.url);
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
	$input.closest('form').find('input[name=tafsir]:checked').each(function () {
		params.push({ name: 'tafsir', value: this.value });
	});
	return $.param(params);
}

function submitQuranPassageSearch($input) {
	var term = ($input.val() || '').trim();
	if (!term)
		return false;
	$input.autocomplete('close');
	var searchPath = '/quran';
	var params = [{ name: 'q', value: term }];
	var $form = $input.closest('form');
	var $tafsirFilters = $form.find('input[name=tafsir]:checked');
	if ($tafsirFilters.length > 0) {
		params.push({ name: 'b', value: 'tafsir' });
		$tafsirFilters.each(function () {
			params.push({ name: 'tafsir', value: this.value });
		});
	} else {
		var $filters = $form.find('input[name=b]').filter(function () {
			return this.type === 'hidden' || this.checked;
		});
		$filters.each(function () {
			params.push({ name: 'b', value: this.value });
		});
	}
	window.location.href = `${searchPath}?${$.param(params)}`;
	return true;
}

function initTafsirSearchFilterPills(root) {
	var $root = $(root || document);
	$root.find('input[name=tafsir]').each(function () {
		updateSearchFilterIcon($(this).closest('form'));
	});
	if ($(document).data('tafsirSearchFilterPillsBound'))
		return;
	$(document).data('tafsirSearchFilterPillsBound', true);
	$(document).on('change', 'input[name=tafsir]', function () {
		updateSearchFilterIcon($(this).closest('form'));
	});
	$(document).on('change', '.quran-tafsir-search-filter input[name=b]', function () {
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
					if (filter && normalizeSearchBookFilterValue(filter) !== removeValue)
						remainingFilters.push(filter);
				});
			});
			params.delete('b');
			remainingFilters.forEach(function (filter) {
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

function navigateSearchFormWithoutEmptyTafsir($form) {
	var params = [];
	$form.serializeArray().forEach(function (field) {
		params.push(field);
	});
	var action = $form.attr('action') || window.location.pathname;
	window.location.href = `${action}?${$.param(params)}`;
}

function updateSearchFilterIcon($form) {
	var active = false;
	$form.find('input[name=tafsir]').each(function () {
		if (this.checked)
			active = true;
	});
	$form.find('.quran-tafsir-search-filter input[name=b]').each(function () {
		if (this.checked)
			active = true;
	});
	var $icon = $form.find('.quran-passage-filter-toggle .bi').first();
	if (!$icon.length)
		return;
	$icon.toggleClass('bi-book-fill', active);
	$icon.toggleClass('bi-book', !active);
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
				var target = `${form.dataset.tafsirNavigatorBase}/${surah.num}/${ayah}`;
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

function cssEscape(value) {
	if (window.CSS && window.CSS.escape)
		return window.CSS.escape(value);
	return value.toString().replace(/["\\]/g, '\\$&');
}
