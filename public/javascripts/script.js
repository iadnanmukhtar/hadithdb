/* jslint esversion:8 */

$(function () {
	'use strict';

	setDirection($('#search-bar'));

	$(window).scroll(function() {
		if ($(document).scrollTop() > 50) {
		  $('nav').addClass('shrink');
		} else {
		  $('nav').removeClass('shrink');
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
