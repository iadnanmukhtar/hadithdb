/* jslint esversion:8 */

$(function () {
	'use strict';

	setDirection();
	$('#search-bar').on('input', setDirection);

	$('#search-bar').on('keyup', function () {
		var value = cleanText($(this).val());
		$('#toc tbody tr').filter(function () {
			var content = cleanText($(this).text());
			$(this).toggle(content.indexOf(value) > -1);
		});
	});

	$('#toc2').on('hidden.bs.collapse', function (event) {
		console.log('hello');
		$('.toggle').removeClass('bi-toggle-on');
		$('.toggle').addClass('bi-toggle-off');
	});
	$('#toc2').on('shown.bs.collapse', function(event) {
		console.log('hello');
		$('.toggle').removeClass('bi-toggle-off');
		$('.toggle').addClass('bi-toggle-on');
	});

});

function setDirection() {
	if ($('#search-bar').length) {
		if ($('#search-bar').val().match(/^[\u0600-\u06ff]+/))
			$('#search-bar').css({ 'direction': 'rtl' });
		else
			$('#search-bar').css({ 'direction': 'ltr' });
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
