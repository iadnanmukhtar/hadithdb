'use strict';

const Utils = require('../lib/Utils');

describe('Markdown rendering', () => {
  test('does not rewrite valid repeated hadith emphasis spans', () => {
    const markdown = 'فَقَالَ: *«يَا مُعَاذَ بْنَ جَبَلٍ»*. قُلْتُ: لَبَّيْكَ. ثُمَّ قَالَ: *«يَا مُعَاذَ بْنَ جَبَلٍ»* قَالَ: *«هَلْ تَدْرِي؟»* قَالَ: قُلْتُ: اللَّهُ أَعْلَمُ.';
    const html = Utils.markdownToHtml(markdown);

    expect(html.match(/<em>/g)).toHaveLength(3);
    expect(html).toContain('<em>«يَا مُعَاذَ بْنَ جَبَلٍ»</em>');
    expect(html).not.toContain('*');
  });

  test('does not tolerate invalid emphasis spacing', () => {
    const html = Utils.markdownToHtml('The manhaj is primarily * riwayah*.');

    expect(html).not.toContain('<em>');
    expect(html).toContain('* riwayah*');
  });
});
