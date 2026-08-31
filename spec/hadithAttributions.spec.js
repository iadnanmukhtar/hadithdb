'use strict';

const fs = require('fs');
const path = require('path');
const HadithAttributions = require('../lib/HadithAttributions');
const HadithChainCategories = require('../lib/HadithChainCategories');

describe('Hadith attribution taxonomy', () => {
	test('orders all canonical attribution origins with English and Arabic titles', () => {
		const canonical = HadithAttributions.ATTRIBUTIONS.filter(item => item.id >= 0);
		expect(canonical).toEqual([
			{ id: 100, key: 'qudsi', title_en: 'Divine', title: 'قدسي' },
			{ id: 200, key: 'marfu', title_en: 'Prophetic', title: 'مرفوع' },
			{ id: 300, key: 'mawquf', title_en: 'Companion', title: 'موقوف' },
			{ id: 400, key: 'maqtu', title_en: 'Successor', title: 'مقطوع' }
		]);
	});

	test('parses multiple chain categories independently from attribution', () => {
		expect(HadithChainCategories.parse('معلق ، مرسل')).toEqual([
			{ key: 'muallaq', title_en: 'Muʿallaq', title: 'معلق' },
			{ key: 'mursal', title_en: 'Mursal', title: 'مرسل' }
		]);
		expect(HadithChainCategories.parse('متَّصِل')[0]).toEqual({ key: 'muttasil', title_en: 'Muttaṣil', title: 'متصل' });
	});

	test('does not mistake chain continuity terminology for attribution', () => {
		expect(HadithAttributions.idForArabic('مرفوع')).toBe(200);
		expect(HadithAttributions.idForArabic('مرفوع حكمًا')).toBe(200);
		['معلق', 'مرسل', 'منقطع', 'معلق ، مرسل'].forEach(value =>
			expect(HadithAttributions.idForArabic(value)).toBe(-1));
	});

	test('defines a grades-style table and a durable Hadith foreign key migration', async () => {
		const calls = [];
		await HadithAttributions.ensureSchema(async (sql, values) => {
			calls.push({ sql, values });
			if (sql.includes('information_schema.')) return [];
			return [];
		});
		const sql = calls.map(call => call.sql).join('\n');
		expect(sql).toContain('CREATE TABLE IF NOT EXISTS attributions');
		expect(sql).toContain('ADD COLUMN attributionId');
		expect(sql).toContain('fk_hadith_attribution');
	});

	test('renders localized attribution without inline grades on Hadith detail pages', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		expect(template).toContain('hadithAttribution.title_en');
		expect(template).toContain('hadithAttribution.title');
		expect(template).toContain("classificationParts.join(' · ')");
		expect(template).toContain('i.remark == 0 && !isContentTranslationLang && !i.single');
	});
});
