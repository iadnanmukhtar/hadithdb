/* jslint esversion:8 */

$(function () {
	'use strict';

	if (window.marked && window.marked.setOptions) {
		window.marked.setOptions({
			gfm: true,
			breaks: true
		});
	}

	document.cookie.includes('admin=') ? false : $('.edit-gear').hide();

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
	initHadithShareModals(document);
	initQuranAyahHoverPairs(document);
	initQuranAyahSelector(document);
	initQuranPassageShareLinks(document);
	initQuranTafsirTabs(document);
	initTocExpandCollapse(document);

});

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

function initQuranTafsirTabs(root) {
	var scope = root || document;
	$(scope).find('.quran-tafsirs').each(function () {
		var container = $(this);
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
			$('<sup>').text(toArabicDigits(`${surah}:${ayah}`)).appendTo(heading);
			heading.append(document.createTextNode(' '));
			$('<span>').text(ayahText[ayah] || '').appendTo(heading);
			heading.append(document.createTextNode(' '));
			$('<span>').addClass('quran-ayah-end-marker').text('۝').appendTo(heading);
		};
		var overlapsSelectedAyahs = function (startAyah, endAyah) {
			return selectedAyahs.some(function (ayah) {
				return ayah >= startAyah && ayah <= endAyah;
			});
		};
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
			var panelId = `${container.attr('data-surah')}-${ayahs[0] || ''}-${book.alias}`;
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
		var fetchPayload = async function (src, source, ayah) {
			var endpoint = source === 'local' ? '/proxy/tafsir/local' : '/proxy/tafsir';
			var response = await fetch(`${endpoint}?src=${encodeURIComponent(src)}&s=${encodeURIComponent(surah)}&a=${encodeURIComponent(ayah)}&ver=1`);
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
						payload: await fetchPayload(src, source, ayah)
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
			var target = targetAlias ? tabs.filter(`[data-tafsir-hash="${cssEscape(targetAlias)}"]`) : $();
			if (target.length !== 1 || target.attr('data-tafsir-lang') !== language)
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
			loadPanel($($(event.target).attr('data-bs-target')));
		});
		container.find('[data-tafsir-language]').on('click', function () {
			showLanguage($(this).attr('data-tafsir-language'));
		});
		fetch('/proxy/tafsir/books').then(function (response) {
			if (!response.ok)
				throw new Error('Unable to load tafsir list.');
			return response.json();
		}).then(function (books) {
			books.forEach(addCatalogTab);
			var initialHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tafsir');
			var initialAlias = initialHash || getStoredTafsirAlias();
			var initialTab = container.find('[data-tafsir-hash]').filter(function () {
				return $(this).attr('data-tafsir-hash') === initialAlias;
			});
			if (initialTab.length === 1)
				showLanguage(initialTab.attr('data-tafsir-lang'), initialAlias);
			else
				showLanguage(activeLanguage);
		}).catch(function (err) {
			container.find('.quran-tafsir-status').first().removeClass('d-none').text(err.message || 'Unable to load tafsir list.');
		});
	});
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
			return `/quran:${surah}:${start}${end > start ? '-' + end : ''}`;
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

function initSearchAutocomplete() {
	if (!$.fn.autocomplete)
		return;
	$('input[role=search][name=q]').each(function () {
		var input = this;
		var $input = $(input);
		if ($input.data('autocompleteBound'))
			return;
		$input.data('autocompleteBound', true);
		$input.on('keydown', function (event) {
			if (event.key !== 'Enter' || !$input.autocomplete('widget').is(':visible'))
				return;
			event.preventDefault();
			$input.autocomplete('close');
			input.form.submit();
		});
		$input.autocomplete({
			appendTo: $input.closest('.search-click-toggle, .input-group, .offcanvas-body'),
			delay: 180,
			minLength: 2,
			source: function (request, response) {
				$.getJSON('/autocomplete', buildSearchAutocompleteParams($input, request.term))
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
					window.location.href = ui.item.url;
				else
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
			if (item.is_quran)
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
			return $item.append($row).appendTo(ul);
		};
	});
}

function buildSearchAutocompleteParams($input, term) {
	var params = [
		{ name: 'q', value: term },
		{ name: 'limit', value: 10 }
	];
	var $filters = $input.closest('form').find('input[name=b]:checked');
	$filters.each(function () {
		params.push({ name: 'b', value: this.value });
	});
	return $.param(params);
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
				var res = await fetch('/do/' + encodeURIComponent(hadithId) + '?cmd=tr', {
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
	var res = await fetch('/captcha/translate', {
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
	var verifyRes = await fetch('/captcha/translate/verify', {
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
