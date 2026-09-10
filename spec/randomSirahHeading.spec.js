'use strict';

const ejs = require('ejs');
const path = require('path');
const cheerio = require('cheerio');
const Utils = require('../lib/Utils');
const Arabic = require('../lib/Arabic');

const template = path.join(__dirname, '../views/sub-views/random_toc_item.ejs');

async function render(random) {
	return cheerio.load(await ejs.renderFile(template, {
		book: { alias: 'ibnhisham', type: 'sirah', shortName_en: 'Sirat Ibn Hisham' },
		random,
		utils: Utils,
		arabic: Arabic,
		req: { originalUrl: '/ibnhisham', query: {} },
		site: {},
		page: {}
	}));
}

describe('random Sirah heading', () => {
	test('shows the chapter or section summary beneath its linked title', async () => {
		const $ = await render({ id: 41, level: 2, h1: 4, h2: 2, h3: null, path: 'ibnhisham/4/2', h1_title_en: 'The chapter', title_en: 'The pledge', title: 'البيعة', intro_en: 'A **concise** overview.', intro: '' });
		expect($('[data-random-sirah-heading] a').first().attr('href')).toContain('/ibnhisham/4/2');
		expect($('.random-sirah-heading-summary[lang=en]').text()).toContain('A concise overview.');
		expect($('.random-sirah-heading-summary[lang=en]').text()).not.toContain('Summary:');
		expect($('.random-sirah-heading-summary[lang=en] strong').last().text()).toBe('concise');
		expect($('.random-sirah-heading-context').text()).toContain('§ The pledge in The chapter');
		expect($('.random-sirah-heading-context .bi-book')).toHaveLength(0);
		expect($('.random-sirah-heading-actions')).toHaveLength(1);
		expect($('.random-sirah-heading-footer .heading-bookmark-btn')).toHaveLength(1);
		expect($('.random-sirah-heading-footer [data-like-type=toc]')).not.toHaveLength(0);
		expect($('.random-sirah-heading-footer [data-comment-type=toc]')).toHaveLength(1);
		expect($('.random-sirah-heading-footer').closest('.h')).toHaveLength(1);
		expect($('.random-sirah-heading-footer .reflection-count-link').attr('data-reflection-disclosure-trigger')).toBe('sirah-heading-comments-41-disclosure');
		expect($('#sirah-heading-comments-41-disclosure')).toHaveLength(1);
		expect($('#sirah-heading-comments-41').attr('data-target-type')).toBe('toc');
		expect($('.random-sirah-heading-footer').text()).not.toMatch(/Share|Sharh|Sound/i);
	});

	test('does not add an empty summary block', async () => {
		const $ = await render({ h1: 4, h2: null, h3: null, path: 'ibnhisham/4', title_en: 'Chapter', title: 'باب', intro_en: '', intro: '' });
		expect($('.random-sirah-heading-summary')).toHaveLength(0);
	});
});
