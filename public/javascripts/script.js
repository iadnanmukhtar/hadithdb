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

});

function setDirection(el) {
	if (el.length) {
		if (el.val().match(/^[\u0600-\u06ff]+/))
			el.css({ 'direction': 'rtl' });
		else
			el.css({ 'direction': 'ltr' });
	}
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
		var sizeControls = modal.querySelectorAll('.hadith-share-size');
		var copyButton = modal.querySelector('.hadith-share-copy');
		var downloadButton = modal.querySelector('.hadith-share-download');

		modalRoot.addEventListener('show.bs.modal', function () {
			if (arabicSwitch)
				arabicSwitch.checked = arabicSwitch.defaultChecked;
			updateHadithShareArabicState(modal, card, arabicSwitch);
			updateHadithShareSizeState(card, sizeControls);
		});

		modalRoot.addEventListener('shown.bs.modal', function () {
			updateHadithShareArabicState(modal, card, arabicSwitch);
			updateHadithShareSizeState(card, sizeControls);
			scheduleHadithShareCardFit(card);
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
			});
		}

		if (arabicSwitch) {
			arabicSwitch.addEventListener('change', function () {
				updateHadithShareArabicState(modal, card, arabicSwitch);
				scheduleHadithShareCardFit(card);
			});
		}

		sizeControls.forEach(function (control) {
			control.addEventListener('input', function () {
				updateHadithShareSizeState(card, sizeControls);
				scheduleHadithShareCardFit(card);
			});
		});

		modal.querySelectorAll('.share-editable').forEach(function (el) {
			el.addEventListener('input', function () {
				scheduleHadithShareCardFit(card);
			});
		});

		if (copyButton) {
			copyButton.addEventListener('click', function () {
				exportHadithShareCard(card, 'copy', copyButton);
			});
		}

		if (downloadButton) {
			downloadButton.addEventListener('click', function () {
				exportHadithShareCard(card, 'download', downloadButton);
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
		}).catch(function () {});
	}
}

function updateHadithShareArabicState(modal, card, arabicSwitch) {
	if (!modal || !card || !arabicSwitch)
		return;
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
	var minScale = card.classList.contains('hadith-share-english-only') ? 0.4 : 0.3;
	while (scale > minScale && inner.scrollHeight > inner.clientHeight + 1) {
		scale -= 0.04;
		card.style.setProperty('--share-scale', scale.toFixed(2));
	}
	card.classList.toggle('hadith-share-dense', scale < 0.86);
	while (scale > minScale && inner.scrollHeight > inner.clientHeight + 1) {
		scale -= 0.02;
		card.style.setProperty('--share-scale', scale.toFixed(2));
	}
}

async function exportHadithShareCard(card, mode, button) {
	if (!card)
		return;
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
		fitHadithShareCard(card);
		card.classList.add('is-exporting');
		var cardWidth = card.getBoundingClientRect().width || 540;
		var canvas = await window.html2canvas(card, {
			backgroundColor: null,
			scale: 1080 / cardWidth,
			useCORS: true
		});
		if (mode === 'copy' && navigator.clipboard && window.ClipboardItem) {
			await new Promise(function (resolve, reject) {
				canvas.toBlob(function (blob) {
					if (!blob) {
						reject(new Error('Unable to render image.'));
						return;
					}
					navigator.clipboard.write([
						new ClipboardItem({
							'image/png': blob
						})
					]).then(resolve).catch(reject);
				}, 'image/png');
			});
			if (window.toastr)
				toastr.success('Image copied to clipboard');
			return;
		}
		downloadCanvas(canvas);
		if (mode === 'copy' && window.toastr)
			toastr.info('Clipboard image copy is unavailable in this browser. Downloaded PNG instead.');
	} catch (err) {
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

function downloadCanvas(canvas) {
	var link = document.createElement('a');
	link.download = 'hadith-share.png';
	link.href = canvas.toDataURL('image/png');
	document.body.appendChild(link);
	link.click();
	link.remove();
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
