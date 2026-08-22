'use strict';

const QuranTocSubdivisions = require('./QuranTocSubdivisions');
const Surahs = require('./Surahs');

async function forSurahs(surahNumbers) {
	const uniqueSurahs = Array.from(new Set((surahNumbers || []).map(Number).filter(function (surah) {
		return Number.isInteger(surah) && surah >= 1 && surah <= 114;
	})));
	if (uniqueSurahs.length < 1)
		return {};

	const [sectionsBySurah, subsectionsBySurah] = await Promise.all([
		QuranTocSubdivisions.quranSectionRangesBySurah(),
		QuranTocSubdivisions.quranSubsectionRangesBySurah()
	]);
	const outlines = {};
	uniqueSurahs.forEach(function (surah) {
		const surahInfo = Surahs.find(surah) || (global.surahs || []).find(function (item) {
			return Number(item.num) === surah;
		}) || {};
		const subsectionsBySection = new Map();
		(subsectionsBySurah[surah] || []).forEach(function (subsection) {
			const section = Number(subsection.section);
			if (!subsectionsBySection.has(section))
				subsectionsBySection.set(section, []);
			subsectionsBySection.get(section).push({
				key: `${surah}.${section}.${Number(subsection.subsection)}`,
				level: 3,
				surah: surah,
				section: section,
				subsection: Number(subsection.subsection),
				title: subsection.title_en || subsection.title || `Subsection ${Number(subsection.subsection)}`,
				start: Number(subsection.start),
				end: Number(subsection.end)
			});
		});
		outlines[surah] = {
			surah: surah,
			nameEn: surahInfo.name_en || '',
			nameAr: surahInfo.name_ar || '',
			sections: (sectionsBySurah[surah] || []).map(function (section) {
				const sectionNumber = Number(section.section);
				return {
					key: `${surah}.${sectionNumber}`,
					level: 2,
					surah: surah,
					section: sectionNumber,
					title: section.title_en || section.title || `Passage ${sectionNumber}`,
					start: Number(section.start),
					end: Number(section.end),
					subsections: subsectionsBySection.get(sectionNumber) || []
				};
			})
		};
	});
	return outlines;
}

module.exports = { forSurahs };
