'use strict';

function surahs() {
	return Array.isArray(global.surahs) ? global.surahs : [];
}

function adjacent(surah, ayah, direction) {
	surah = Number(surah);
	ayah = Number(ayah);
	direction = direction > 0 ? 1 : -1;
	const currentSurah = surahs().find(item => Number(item.num) === surah);
	if (!currentSurah || !Number.isInteger(ayah))
		return null;
	const boundary = boundaryAdjacent(surah, ayah, direction);
	if (boundary)
		return boundary;
	if (direction > 0 && ayah < Number(currentSurah.ayahs))
		return { surah, ayah: ayah + 1 };
	if (direction < 0 && ayah > 1)
		return { surah, ayah: ayah - 1 };
	const nextSurah = surahs().find(item => Number(item.num) === surah + direction);
	if (!nextSurah)
		return null;
	return {
		surah: Number(nextSurah.num),
		ayah: direction > 0 ? 1 : Number(nextSurah.ayahs)
	};
}

function boundaryAdjacent(surah, ayah, direction) {
	surah = Number(surah);
	ayah = Number(ayah);
	direction = direction > 0 ? 1 : -1;
	const lastSurah = surahs().find(item => Number(item.num) === 114);
	const lastAyah = lastSurah && Number(lastSurah.ayahs);
	if (direction < 0 && surah === 1 && ayah === 1)
		return { surah: 1, ayah: 0 };
	if (direction < 0 && surah === 1 && ayah === 0 && Number.isInteger(lastAyah))
		return { surah: 114, ayah: lastAyah };
	if (direction > 0 && surah === 1 && ayah === 0)
		return { surah: 1, ayah: 1 };
	if (direction > 0 && surah === 114 && ayah === lastAyah)
		return { surah: 1, ayah: 0 };
	return null;
}

module.exports = { adjacent, boundaryAdjacent };
