'use strict';
const identity = require('../lib/ContentIdentity');
const source = require('../lib/CommunityActivitySource');
const social = require('../lib/SocialMetadata');
const Community = require('../lib/Community');

test('feed, notification subject, sharing and metadata retain the same bilingual title', () => {
  const row = {type:'hadith',ref_num:'/bukhari:1',source_title:'**Actions** &amp; نِيَّةٌ[^1]'};
  const activity = source.fromRow(row);
  expect(activity).toEqual({title:'Actions & نِيَّةٌ',reference:'bukhari:1'});
  expect(identity.subject(activity)).toBe('Actions & نِيَّةٌ · bukhari:1');
  expect(Community.displayTitle(row.source_title, '')).toBe(activity.title);
  expect(social.title(row.source_title)).toBe(activity.title);
  expect(social.qualifiedTitle('Bukhari 1', row.source_title)).toBe('Bukhari 1 — Actions & نِيَّةٌ');
});

test('uses one bounded fallback across activity and community sharing without markup or scripts', () => {
  const body = '<div>One two</div><div>three four five six seven eight nine</div><script>secret()</script>';
  expect(source.title('', body)).toBe('One two three four five six seven eight…');
  expect(Community.displayTitle('', body)).toBe(source.title('', body));
  expect(identity.postTitle('', '', 'article')).toBe('Untitled article');
  expect(identity.title('', 'رَحْمَةٌ')).toBe('رَحْمَةٌ');
});

test('references preserve source identities and remove fragments and queries', () => {
  expect(identity.reference('https://hadithunlocked.com/sharh/riyad/bukhari:1?view=all#note-1', {content:true})).toBe('riyad/bukhari:1');
  expect(identity.reference('/quran/tafsir/ibn-kathir/quran:2:255-257#note-1', {content:true})).toBe('ibn-kathir/quran:2:255-257');
  expect(identity.reference('/riyad:1')).toBe('riyad:1');
});

test('browser and server share range and label rules, including cross-surah ranges', () => {
  const vm = require('vm'), fs = require('fs');
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/static/js/content-labels'), 'utf8'), browser);
  for (const [first,last,expected] of [['2:255','2:257','2:255-257'],['2:286','3:1','2:286-3:1'],['quran:2:255','quran:2:255','2:255']]) {
    expect(identity.range(first,last)).toBe(expected);
    expect(browser.ContentLabels.range(first,last)).toBe(expected);
    expect(browser.ContentLabels.label('Baqarah', expected)).toBe(identity.label('Baqarah', expected));
  }
});

test('federated post title uses only published content and the sharing fallback', async () => {
  const row = {id:1,author_uid:'reader',kind:'note',status:'published',public_title:'',
    public_markdown:'Published words for all readers.',title:'Private draft title',markdown:'Secret draft'};
  const query = jest.fn(async sql => {
    if (sql.includes('FROM community_posts')) return [row];
    if (sql.includes('FROM community_authors')) return [{uid:'reader',handle:'reader',profile_visibility:'public'}];
    return [];
  });
  const post = await require('../lib/ActivityPubSources').read(query, 'post', 1);
  expect(post.title).toBe(Community.displayTitle('', Community.content(row.public_markdown).html));
  expect(post.title).not.toMatch(/Private|Secret/);
});

test('reader titles retain selection, translation and tafsir context', () => {
  expect(identity.quranReaderTitle({surah:'Baqarah',reference:'2:255',heading:'The Throne'})).toBe('Surah Baqarah 2:255 | The Throne');
  expect(identity.quranReaderTitle({surah:'Baqarah',reference:'2:255',translations:true})).toBe('Surah Baqarah 2:255 | Quran Translations');
  expect(identity.quranReaderTitle({surah:'Baqarah',reference:'2:255-257',selectionCount:3,section:'2.40',heading:'Faith'})).toBe('Surah Baqarah 2:255-257 | §2.40 Faith');
  expect(identity.quranReaderTitle({surah:'Baqarah',selectionCount:0,section:'2.40',author:'Translator',heading:'Faith'})).toBe('Surah Baqarah §2.40 | Translator | Faith');
  expect(identity.tafsirReaderTitle({name:'Tafsir Ibn Kathir',section:'2.40',reference:'2:255-257'})).toBe('Tafsir Ibn Kathir §2.40 | Ayat 2:255-257');
});
