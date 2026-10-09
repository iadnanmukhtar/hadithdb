'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function editor(fetch) {
	const script = fs.readFileSync(path.join(__dirname, '../views/sub-views/scripts.ejs'), 'utf8');
	const source = script.slice(script.indexOf('const bindPrimaryNarratorAutocomplete'), script.indexOf('const bindSharhTitleAutocomplete'));
	const attrs = { 'data-narrator-language': 'ar' }, handlers = {}, data = {};
	let options, value;
	const input = {
		0: {}, hasClass: () => true,
		data: (key, val) => val === undefined ? data[key] : (data[key] = val),
		attr: (key, val) => val === undefined ? attrs[key] : (attrs[key] = val, input),
		removeAttr: key => { delete attrs[key]; return input; },
		on: (key, handler) => { handlers[key] = handler; return input; },
		val: val => val === undefined ? value : (value = val, input),
		autocomplete: arg => {
			if (typeof arg === 'object') options = arg;
			if (arg === 'instance') return {};
			return input;
		}
	};
	const changeListener = jest.fn();
	vm.runInNewContext(source + '\nbindPrimaryNarratorAutocomplete(input);', {
		$: { fn: { autocomplete: true } }, input, fetch, window: {}, URLSearchParams, AbortController,
		editHadithApiPath: value => value, changeListener
	});
	return { input, options, handlers, changeListener };
}

test('aborts older searches and ignores their responses even if abort is ignored', async () => {
	let finish;
	const fetch = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
		.mockResolvedValueOnce({ ok: true, json: async () => [{ narrator: 'New' }] });
	const { options } = editor(fetch);
	const oldResponse = jest.fn(), newResponse = jest.fn();
	const oldSearch = options.source({ term: 'old' }, oldResponse);
	await options.source({ term: 'new' }, newResponse);
	finish({ ok: true, json: async () => [{ narrator: 'Old' }] });
	await oldSearch;
	expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
	expect(oldResponse).toHaveBeenCalledWith([]);
	expect(newResponse).toHaveBeenCalledWith([{ narrator: 'New' }]);
});

test('selection keeps its pair and further typing clears the selected counterpart', () => {
	const { input, options, handlers, changeListener } = editor(jest.fn());
	options.select({ preventDefault() {} }, { item: { narrator: 'عُثْمَانُ', narrator_en: 'ʿUthmān' } });
	expect(input.val()).toBe('عُثْمَانُ');
	expect(input.attr('data-paired-narrator')).toBe('ʿUthmān');
	expect(changeListener).toHaveBeenCalledTimes(1);
	handlers['input.primaryNarrator']();
	expect(input.attr('data-paired-narrator')).toBeUndefined();
});
