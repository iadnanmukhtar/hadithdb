/* jslint esversion:8 */

$(function () {
	'use strict';

	setDirection($('#search-bar'));

	$('#comments-app-rOdWjWWp-1').on('mouseover focus', function () {
		console.log('over!');
	});

	$(window).scroll(function() {
		if ($(document).scrollTop() > 50) {
		  $('nav').addClass('shrink');
		} else {
		  $('nav').removeClass('shrink');
		}
	});

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

	$(document).on('click', function () {
		$('.collapse').collapse('hide');
	});

	$('.search-click-toggle a').click(function () {
		$('.search-click-toggle a').hide();
		$('.search-click-toggle input').show();
		$('.search-click-toggle input').focus();
	});
	
	$('.search-click-toggle input').on('blur', function () {
		$('.search-click-toggle a').show();
		$('.search-click-toggle input').hide();
	});

	$('#search-bar, .search-click').on('input', function () {
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
