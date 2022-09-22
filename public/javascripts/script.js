$(document).ready(function () {
	'use strict';
	setDirection();
	$('#search-bar').on('input', setDirection);
});

function setDirection() {
	if ($('#search-bar').val().match(/^[\u0600-\u06ff]+/))
		$('#search-bar').css({ 'direction': 'rtl' });
	else
		$('#search-bar').css({ 'direction': 'ltr' });
}
