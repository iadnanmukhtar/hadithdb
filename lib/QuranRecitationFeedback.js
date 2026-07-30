'use strict';

const debug = require('./Debug')('hadithdb:QuranRecitationFeedback');
const QuranMushaf = require('./QuranMushaf');

const MAX_PROMPT_LENGTH = 12000;

function config() {
  return global.settings
    && global.settings.quran
    && global.settings.quran.recitationFeedback
    || {};
}

function isEnabled() {
  const enabled = config().enabled;
  return enabled === true || enabled === 1 || enabled === '1' || enabled === 'true';
}

function audioExtension(contentType) {
  if (/ogg/i.test(contentType)) return 'ogg';
  if (/mp4|m4a/i.test(contentType)) return 'mp4';
  if (/mpeg|mp3/i.test(contentType)) return 'mp3';
  if (/wav/i.test(contentType)) return 'wav';
  return 'webm';
}

function pagePrompt(mushaf) {
  const words = [];
  (mushaf.lines || []).forEach(line => {
    if (line.line_type === 'surah_name' && ![1, 9].includes(Number(line.surah_number))) {
      (mushaf.basmallahWords || []).forEach(word => {
        if (word.text) words.push(word.text);
      });
    }
    if (line.line_type !== 'ayah') return;
    (line.words || []).forEach(word => {
      if (!word.is_ayah_marker && word.text)
        words.push(word.text);
    });
  });
  return [
    'هذه تلاوة من القرآن الكريم. اكتب فقط الكلمات العربية التي تلاها القارئ، من دون شرح أو ترجمة.',
    'قد يبدأ القارئ أو يتوقف في أي موضع من نص الصفحة الآتي:',
    words.join(' ')
  ].join('\n').slice(0, MAX_PROMPT_LENGTH);
}

async function transcribe(pageNumber, audio, contentType) {
  if (!isEnabled())
    throw Object.assign(new Error('Recitation feedback is not enabled.'), { status: 404 });
  const endpoint = (config().endpoint || '').toString().trim();
  if (!endpoint)
    throw Object.assign(new Error('The self-hosted recitation service is not configured.'), { status: 503 });
  if (!Buffer.isBuffer(audio) || audio.length === 0)
    throw Object.assign(new Error('An audio recording is required.'), { status: 400 });

  const mushaf = await QuranMushaf.page(pageNumber);
  if (!mushaf)
    throw Object.assign(new Error('The requested Mushaf page was not found.'), { status: 404 });

  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType }), `recitation.${audioExtension(contentType)}`);
  form.append('language', 'ar');
  form.append('prompt', pagePrompt(mushaf));
  form.append('page', String(pageNumber));
  if (config().model)
    form.append('model', config().model.toString());

  const started = Date.now();
  const headers = {};
  if (config().token)
    headers.Authorization = `Bearer ${config().token}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(60000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = result && (result.error && result.error.message || result.error || result.detail);
    debug.error(`Self-hosted transcription failed status=${response.status} elapsedMs=${Date.now() - started}: ${providerMessage || response.statusText}`);
    throw Object.assign(new Error('The recitation could not be transcribed. Please try again.'), {
      status: response.status === 429 ? 429 : 502
    });
  }
  debug(`Self-hosted transcription complete page=${pageNumber} bytes=${audio.length} elapsedMs=${Date.now() - started}`);
  return {
    text: (result.text || '').toString().trim()
  };
}

module.exports = {
  config,
  isEnabled,
  transcribe
};
