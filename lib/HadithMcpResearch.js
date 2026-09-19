'use strict';

const axios = require('axios');
const SearchHttp = require('./SearchHttp');
const Search = require('./HadithMcpSearch');

const S = { type: 'string' };
const N = { type: 'integer' };
const NS = { type: ['string', 'null'] };
const NN = { type: ['integer', 'null'] };
const B = { type: 'boolean' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
const profile = { type: 'string', enum: ['compact', 'default', 'full'], default: 'default' };
const depth = { type: 'string', enum: ['brief', 'standard', 'deep'], default: 'standard', description: 'Research breadth, independent of the final answer length. All depths have time and source limits.' };
const referenceInputs = { type: 'array', maxItems: 4, items: { type: 'string', minLength: 3, maxLength: 100 }, description: 'Known exact principal report references to prioritize and verify, e.g. bukhari:1166. Do not invent references or translate source numbers across collections.' };
const terms = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 4, description: 'Short concept search phrases, preferably including Arabic equivalents. Do not pass the entire natural-language question as a search phrase.' };
const sourceSchema = object({ id: NN, alias: NS, title_arabic: NS, title_english: NS, author_arabic: NS, author_english: NS });
const commentarySchema = object({ id: N, source: sourceSchema, hadith_reference: S, hadith_collection: S, url: S, text_arabic: NS, text_english: NS, truncated: B });
const statusSchema = { type: 'string', enum: ['found', 'searched_no_match', 'not_searched', 'unavailable'] };
const researchOutput = {
  question: S, depth: S, scope: S, queries: array(S),
  evidence: array(object({ tool: S, arguments: { type: 'object', additionalProperties: true }, relationship: S, status: statusSchema,
    data: { type: ['object', 'null'], additionalProperties: true, description: 'Selected source fields and bounded excerpts from the named tool. Truncated text is flagged; exact tools provide complete records. Search hits are discovery candidates, not verified conceptual relationships.' }, error: NS })),
  coverage: object({ exhaustive: B, calls_made: N, call_limit: N, time_limit_ms: N, deadline_reached: B,
    hadith_commentary: statusSchema, concept_research: statusSchema, omitted_candidates: N }),
  next_steps: array(S), interpretation_note: S
};
const DEFINITIONS = [
  { name: 'list_hadith_commentaries', title: 'List hadith commentaries',
    description: 'Use this to discover available hadith commentary works (shuruh), authors and aliases before selecting a source. These are commentary works, not the underlying hadith collections. Catalog presence does not guarantee coverage of a particular report.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 } }, additionalProperties: false },
    outputProperties: { sources: array(sourceSchema), total: N, next_offset: NN } },
  { name: 'search_hadith_commentary', title: 'Search hadith commentary',
    description: 'Use this for scholarly explanations, procedural details and disagreements, including when answering how to perform worship or researching Quranic concepts. Searches shuruh across collections. Results preserve the commentary work and associated hadith separately. Retrieve exact entries with lookup_hadith_commentary and verify reports with lookup_hadith_detail.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, source: { type: 'string', minLength: 1, description: 'Optional exact commentary alias from list_hadith_commentaries.' }, reference: { type: 'string', minLength: 3, description: 'Optional exact associated hadith reference.' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }, cursor: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false },
    outputProperties: { query: S, results: array(commentarySchema), pagination: object({ limit: N, returned: N, offset: N, total_available: NN, total_is_exact: B, has_more: B, next_cursor: NS }) } },
  { name: 'lookup_hadith_commentary', title: 'Look up hadith commentary',
    description: 'Retrieve an exact scholarly commentary entry by ID from commentary search or a hadith’s research inventory. Preserve its author and work attribution. Default bounds each language to 6000 characters; full retrieves all indexed text.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, response_profile: profile }, required: ['id'], additionalProperties: false },
    outputProperties: { commentary: commentarySchema } },
  { name: 'research_islamic_topic', title: 'Research an Islamic topic',
    description: 'Use this before answering substantive Islamic topic or practical worship questions, such as what istikharah is and how to pray it. Collects Quran/tafsir discovery candidates, verified hadith records, explanations from distinct shuruh and explicitly linked related reports. Supply short Arabic/English queries and known principal hadith_references when available to anchor the research. Inspect coverage and fetch omitted/truncated sources as needed within the same turn; do not treat topic matches as direct evidence or claim exhaustive research.',
    inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 2000 }, queries: terms, hadith_references: referenceInputs, depth }, required: ['question', 'queries'], additionalProperties: false }, outputProperties: researchOutput },
  { name: 'research_quran_ayah', title: 'Research a Quran ayah and its concepts',
    description: 'Use this for explanations of Quran ayahs. Retrieves the exact ayah and major available tafsirs (default Tabari, Ibn Kathir, Qurtubi; more at deep depth), then searches supplied concepts in Quran, tafsir, hadith and shuruh. If concepts are omitted, read the returned ayah/tafsirs, derive short grounded concept phrases, and call again with concepts without asking the user. Search matches are conceptual candidates, not proof a hadith directly explains this ayah. Verify relevant source text before synthesis. Respect explicitly requested tafsir sources.',
    inputSchema: { type: 'object', properties: { surah: { type: 'integer', minimum: 1, maximum: 114 }, ayah: { type: 'integer', minimum: 0, maximum: 286 }, concepts: terms, hadith_references: referenceInputs, tafsirs: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 100 }, description: 'Optional requested source names/aliases; overrides the default source selection.' }, depth }, required: ['surah', 'ayah'], additionalProperties: false }, outputProperties: researchOutput }
];

const txt = value => value === undefined || value === null || value === '' ? null : String(value);
function source(book = {}) {
  return { id: Number(book.id) || null, alias: txt(book.alias), title_arabic: txt(book.title || book.name), title_english: txt(book.title_en || book.name_en), author_arabic: txt(book.author), author_english: txt(book.author_en) };
}
function sourceForEntry(entry) {
  return source(entry.sharh_book || (global.books || []).find(book => Number(book.id) === Number(entry.bookId)) || {
    id: entry.bookId, alias: entry.commentary_alias, title: entry.commentary_name || entry.source_title || entry.title,
    title_en: entry.commentary_name_en || entry.title_en, author: entry.commentary_author || entry.author, author_en: entry.commentary_author_en || entry.author_en
  });
}
const refPattern = /^[a-z0-9_-]+:[0-9]+(?:[.-][0-9]+)*[a-z]?$/;
function relatedReports(metadata) {
  return ['takhrij', 'shawahid', 'similar'].flatMap(kind => (Array.isArray(metadata?.[kind]) ? metadata[kind] : [])
    .filter(entry => refPattern.test(entry.internal_ref || ''))
    .map(entry => ({ reference: entry.internal_ref, relationship: kind, label: txt(entry.label) })));
}
function inventory(metadata, reference) {
  const entries = Array.isArray(metadata?.sharh) ? metadata.sharh : [];
  const works = new Set(entries.map(entry => sourceForEntry(entry).id || `${entry.source_id}:${entry.source_title}`));
  return {
    commentary_status: metadata ? (entries.length ? 'found' : 'searched_no_match') : 'unavailable',
    commentary_entry_count: entries.length, commentary_work_count: works.size,
    commentaries: entries.map(entry => ({ id: Number(entry.id) || null, source: sourceForEntry(entry), hadith_reference: reference })),
    related_reports: relatedReports(metadata),
    commentary_text_included: false,
    next_step: entries.length ? 'Use lookup_hadith_commentary with entry IDs, or lookup_hadith_detail with response_profile default/full. Search other works with search_hadith_commentary.' : 'Search other works with search_hadith_commentary; absent attached commentary does not establish that no scholarly explanation exists.'
  };
}
function normalizeCommentary(row, baseUrl, maxChars = 1000) {
  if (!refPattern.test(row.ref || '') || !Number.isInteger(Number(row.id)) || Number(row.id) < 1)
    throw new Error('Invalid commentary identity in search index.');
  const ar = txt(row.text), en = txt(row.text_en);
  return { id: Number(row.id), source: sourceForEntry(row), hadith_reference: row.ref, hadith_collection: row.book_alias || row.ref.split(':')[0],
    url: `${baseUrl}/${row.ref}`, text_arabic: ar?.slice(0, maxChars) || null, text_english: en?.slice(0, maxChars) || null,
    truncated: !!((ar && ar.length > maxChars) || (en && en.length > maxChars)) };
}
async function commentaryDocs(query, offset, size, context) {
  try {
    const response = await axios.post(`${global.settings.search.domain}/sharhs/_search`, {
      query, from: offset, size, track_total_hits: true, timeout: '5s'
    }, SearchHttp.axiosConfig({ timeout: Math.min(5000, context.deadlineMs || 5000) }));
    if (response.data.timed_out || response.data._shards?.failed)
      throw new Error('Incomplete commentary search response.');
    const rows = response.data.hits.hits.map(hit => hit._source);
    rows.total = typeof response.data.hits.total === 'number' ? response.data.hits.total : response.data.hits.total?.value;
    return rows;
  } catch (error) {
    // Never log query text or axios request configuration (which may include credentials).
    throw new Error(`Hadith commentary index unavailable${error.response?.status ? ` (HTTP ${error.response.status})` : ''}.`);
  }
}

async function commentaryTool(name, args, context) {
  if (name === 'list_hadith_commentaries') {
    if (!Array.isArray(global.books)) throw new Error('Commentary catalog is not loaded.');
    const query = (args.query || '').trim().toLowerCase();
    const sources = global.books.filter(book => book.type === 'sharh').map(source)
      .filter(item => !query || Object.values(item).some(value => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(a.alias).localeCompare(String(b.alias)));
    const offset = args.offset || 0, limit = args.limit || 25;
    if (offset && offset >= sources.length) throw new Error('Commentary catalog offset is past the available sources.');
    return { sources: sources.slice(offset, offset + limit), total: sources.length, next_offset: offset + limit < sources.length ? offset + limit : null };
  }
  if (name === 'lookup_hadith_commentary') {
    const rows = await commentaryDocs({ term: { id: args.id } }, 0, 2, context);
    if (rows.length !== 1) throw new Error(`Commentary ${args.id} was not found or is ambiguous.`);
    return { commentary: normalizeCommentary(rows[0], context.baseUrls.hadith, args.response_profile === 'full' ? Infinity : args.response_profile === 'compact' ? 1000 : 6000) };
  }
  if (!args.query.trim()) throw new Error('query must not be blank.');
  if (args.reference && !refPattern.test(args.reference)) throw new Error('Invalid hadith reference.');
  let filters = ['sharh'];
  const indexFilters = args.reference ? [{ term: { ref: args.reference } }] : [];
  if (args.source) {
    const book = (global.books || []).find(book => book.type === 'sharh' && book.alias === args.source);
    if (!book) throw new Error('Unknown commentary source. Use list_hadith_commentaries.');
    filters = [book.alias];
    indexFilters.push({ term: { bookId: Number(book.id) } });
  }
  const search = context.commentarySearch || ((query, filters, offset, options) => commentaryDocs({ bool: { must: [{ multi_match: { query, fields: ['text', 'text_en'], operator: 'and' } }], filter: indexFilters } }, offset, options.resultSize, context));
  const page = await Search.searchPage({ scope: 'sharh', query: args.query.trim(), filters, limit: args.limit || 10, cursor: args.cursor,
    searchOptions: { excludeQuranAndTafsir: true, mcpHadithReference: args.reference || null },
    mapItem: row => row.doctype === 'sharh' && (!args.reference || row.ref === args.reference) ? normalizeCommentary(row, context.baseUrls.hadith) : null,
    key: item => String(item.id)
  }, { search, deadlineMs: context.deadlineMs });
  return { query: args.query, results: page.results, pagination: page.pagination };
}

function projectEvidence(data, maxChars) {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(item => projectEvidence(item, maxChars));
  const projected = {};
  let shortened = false;
  for (const [key, value] of Object.entries(data)) {
    // Normalized scripture repeats the same text in three representations.
    if ((key === 'text' || key === 'text_combined') && ('text_arabic' in data || 'text_english' in data)) continue;
    if ((key === 'arabic' || key === 'english') && ('text_arabic' in data || 'text_english' in data)) continue;
    if (key === 'metadata') {
      projected.metadata = { grades: value?.grades || [] };
      continue;
    }
    if (typeof value === 'string' && /^(text|body|footnote)/.test(key) && value.length > maxChars) {
      projected[key] = value.slice(0, maxChars); shortened = true;
    } else projected[key] = projectEvidence(value, maxChars);
  }
  if (shortened || data.truncated) projected.truncated = true;
  return projected;
}

const BUDGETS = { brief: { hadith: 2, commentary: 2, tafsir: 2, calls: 24 }, standard: { hadith: 4, commentary: 4, tafsir: 3, calls: 40 }, deep: { hadith: 6, commentary: 8, tafsir: 6, calls: 64 } };
function diverse(items, key, limit) {
  const seen = new Set(), first = [], rest = [];
  for (const item of items) { const k = key(item); if (seen.has(k)) rest.push(item); else { seen.add(k); first.push(item); } }
  return [...first, ...rest].slice(0, limit);
}
async function research(name, args, context, callTool) {
  const isAyah = name === 'research_quran_ayah';
  if ((args.hadith_references || []).some(ref => !refPattern.test(ref))) throw new Error('Invalid principal hadith reference.');
  const selectedDepth = args.depth || 'standard', budget = BUDGETS[selectedDepth];
  if (isAyah && args.ayah === 0 && args.surah !== 1) throw new Error('Ayah 0 is valid only for Surah 1.');
  const queries = [...new Set((isAyah ? args.concepts || [] : args.queries).map(value => value.trim()).filter(Boolean))];
  if ((!isAyah || args.concepts) && !queries.length) throw new Error('Provide at least one nonblank concept search phrase.');
  if (!isAyah && !args.question.trim()) throw new Error('question must not be blank.');
  const timeLimit = context.researchDeadlineMs || 25000, deadline = Date.now() + timeLimit;
  const evidence = [], cache = new Map();
  let calls = 0, omitted = 0;
  async function run(tool, input, relationship) {
    const key = JSON.stringify([tool, input]);
    if (cache.has(key)) return cache.get(key);
    const promise = (async () => {
      const entry = { tool, arguments: input, relationship, status: 'not_searched', data: null, error: null };
      evidence.push(entry);
      if (calls >= budget.calls || Date.now() >= deadline) { entry.error = 'Research call or time limit reached.'; omitted++; return entry; }
      calls++;
      let timer;
      try {
        const result = await Promise.race([
          callTool(tool, input, { ...context, deadlineMs: Math.max(1, deadline - Date.now()), fetch: (url, options = {}) => (context.fetch || fetch)(url, { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) }) }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Research deadline reached.')), Math.max(1, deadline - Date.now())); })
        ]);
        const data = result.structuredContent;
        if (result.isError || !data || data.error) throw new Error(data?.error || 'Source tool failed.');
        entry.data = data;
        const list = data.results || data.commentary || data.records || data.tafsirs;
        entry.status = Array.isArray(list) && !list.length ? 'searched_no_match' : 'found';
      } catch (error) { entry.status = 'unavailable'; entry.error = error.message; }
      finally { clearTimeout(timer); }
      return entry;
    })();
    cache.set(key, promise); return promise;
  }
  async function batch(tasks) {
    const results = [];
    for (let i = 0; i < tasks.length; i += 4) results.push(...await Promise.all(tasks.slice(i, i + 4).map(task => run(...task))));
    return results;
  }
  if (isAyah) {
    const verse = await run('lookup_quran_ayah', { surah: args.surah, ayah: args.ayah }, 'exact_ayah');
    if (verse.status !== 'found') return finish();
    const selected = args.tafsirs || ['tabari', 'ibn-kathir', 'qurtubi', 'baghawi', 'saadi', 'ibn-ashur'].slice(0, budget.tafsir);
    await batch(selected.map(tafsir => ['lookup_tafsir', { tafsir, surah: args.surah, ayah: args.ayah, response_profile: 'compact' }, 'direct_tafsir_of_ayah']));
  }
  const discovery = await batch(queries.flatMap(query => [
    ['search_hadith', { query, books: ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah'], limit: 8 }, 'concept_search_candidate'],
    ['search_hadith', { query, limit: 4 }, 'concept_search_candidate'],
    ['search_hadith_commentary', { query, limit: 10 }, 'concept_search_candidate'],
    ['search_tafsir', { query, limit: 4 }, 'concept_search_candidate'],
    ['search_quran', { query, limit: 3 }, 'concept_search_candidate']
  ]));
  const hadithCandidates = new Map((args.hadith_references || []).map(reference => [reference, { reference, book: { alias: reference.split(':')[0] } }]));
  const commentaryCandidates = new Map();
  const tafsirCandidates = new Map();
  const quranCandidates = new Map();
  for (const entry of discovery) for (const item of entry.data?.results || []) {
    if (entry.tool === 'search_hadith' && refPattern.test(item.reference || '')) { if (!hadithCandidates.has(item.reference)) hadithCandidates.set(item.reference, item); }
    if (entry.tool === 'search_hadith_commentary') {
      commentaryCandidates.set(item.id, item);
      hadithCandidates.set(item.hadith_reference, { reference: item.hadith_reference, book: { alias: item.hadith_collection } });
    }
    if (entry.tool === 'search_tafsir' && item.source?.alias && Number.isInteger(Number(item.surah)) && Number.isInteger(Number(item.ayah_from)))
      tafsirCandidates.set(`${item.source.alias}:${item.surah}:${item.ayah_from}`, item);
    if (entry.tool === 'search_quran' && /^quran:\d+:\d+$/.test(item.reference || '')) quranCandidates.set(item.reference, item);
  }
  const selectedHadiths = diverse([...hadithCandidates.values()], item => item.book?.alias, budget.hadith);
  omitted += Math.max(0, hadithCandidates.size - selectedHadiths.length);
  const exactHadiths = await batch(selectedHadiths.map(item => ['lookup_hadith_detail', { reference: item.reference, response_profile: 'default' }, 'exact_report_for_concept_candidate']));
  const related = new Map();
  const attachedCommentaries = new Map();
  for (const entry of exactHadiths) for (const record of entry.data?.records || []) {
    for (const item of record.research_inventory?.commentaries || []) if (item.id) attachedCommentaries.set(item.id, item);
    for (const item of record.research_inventory?.related_reports || []) if (!hadithCandidates.has(item.reference)) related.set(item.reference, item);
  }
  const selectedRelated = [...related.values()].slice(0, selectedDepth === 'deep' ? 4 : 2);
  omitted += Math.max(0, related.size - selectedRelated.length);
  const relatedDetails = await batch(selectedRelated.map(item => ['lookup_hadith_detail', { reference: item.reference, response_profile: 'default' }, `source_linked_${item.relationship}`]));
  for (const entry of relatedDetails) for (const record of entry.data?.records || []) for (const item of record.research_inventory?.commentaries || [])
    if (item.id) attachedCommentaries.set(item.id, item);
  const allCommentaries = new Map([...attachedCommentaries, ...commentaryCandidates]);
  const selectedCommentaries = diverse([...allCommentaries.values()], item => item.source?.id || item.source?.alias || item.source?.title_arabic, budget.commentary);
  omitted += Math.max(0, allCommentaries.size - selectedCommentaries.length);
  const selectedTafsirs = diverse([...tafsirCandidates.values()], item => item.source.alias, budget.tafsir);
  omitted += Math.max(0, tafsirCandidates.size - selectedTafsirs.length) + Math.max(0, quranCandidates.size - 2);
  await batch([
    ...[...new Set(selectedCommentaries.map(item => item.hadith_reference).filter(Boolean))].map(reference => ['lookup_hadith_detail', { reference, response_profile: 'default' }, 'exact_report_for_selected_commentary']),
    ...selectedCommentaries.map(item => ['lookup_hadith_commentary', { id: item.id, response_profile: 'default' }, 'scholarly_explanation_of_report_or_concept']),
    ...selectedTafsirs.map(item => ['lookup_tafsir', { tafsir: item.source.alias, surah: Number(item.surah), ayah: Number(item.ayah_from), response_profile: 'compact' }, 'tafsir_for_concept_candidate']),
    ...[...quranCandidates.keys()].slice(0, 2).map(ref => { const [, s, a] = ref.split(':'); return ['lookup_quran_ayah', { surah: Number(s), ayah: Number(a) }, 'quran_for_concept_candidate']; })
  ]);
  return finish();
  function finish() {
    const commentary = evidence.filter(item => ['search_hadith_commentary', 'lookup_hadith_commentary'].includes(item.tool));
    const summarize = entries => entries.some(item => item.status === 'found') ? 'found' : entries.some(item => item.status === 'unavailable') ? 'unavailable' : entries.some(item => item.status === 'searched_no_match') ? 'searched_no_match' : 'not_searched';
    return {
      question: isAyah ? `Explain Quran ${args.surah}:${args.ayah} and its concepts` : args.question,
      depth: selectedDepth, scope: isAyah ? 'quran_ayah' : 'topic', queries, evidence: evidence.map(entry => ({ ...entry, data: projectEvidence(entry.data, entry.tool.startsWith('search_') ? 500 : 3500) })),
      coverage: { exhaustive: false, calls_made: calls, call_limit: budget.calls, time_limit_ms: timeLimit, deadline_reached: Date.now() >= deadline,
        hadith_commentary: summarize(commentary), concept_research: summarize(evidence.filter(item => item.relationship === 'concept_search_candidate')), omitted_candidates: omitted },
      next_steps: [
        ...(isAyah && !queries.length ? ['Read the exact ayah and tafsirs, derive short Arabic/English concepts from them, and call research_quran_ayah again with concepts in the same turn. Do not ask the user to supply the research terms.'] : []),
        'Assess conceptual relevance before citing search candidates; a matching word does not establish a direct interpretation of the ayah.',
        'Retrieve full entries when truncated text could affect the conclusion, and follow search cursors or narrow queries if coverage is insufficient.'
      ],
      interpretation_note: 'This is a bounded source dossier of selected fields and excerpts, not a generated ruling or exhaustive scholarly survey. Duplicate text representations and detailed chain metadata are omitted; use exact lookup tools for complete records. Distinguish exact scripture, direct tafsir, scholarly explanation, source-linked parallel reports, and conceptual search candidates. Preserve grades and grader attribution; reports quoted in tafsir are not authenticated by their presence there.'
    };
  }
}

module.exports = { DEFINITIONS, inventory, commentaryTool, research, sourceSchema, sourceForEntry, diverse, isHadithReference: value => refPattern.test(value || '') };
