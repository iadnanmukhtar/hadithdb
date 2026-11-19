'use strict';

const { load } = require('cheerio');
const { escapeHtml } = require('markdown-it')().utils;
const linkify = require('markdown-it')().linkify;

// Work from visible rendered content so code samples and hidden Markdown never
// become previews. Keep source links (including timestamps) intact.
module.exports = function videoPreviews(html) {
  if (!/https?:/i.test(html)) return html;
  const $ = load(html, null, false);
  if ($('.markdown-video-previews').length) return html;
  const { videoFor } = require('./CommunityMedia');
  const seen = new Set();
  const cards = [];
  function add(url, label, description = '') {
    const video = videoFor(url);
    if (!video || seen.has(video.src)) return;
    seen.add(video.src);
    const id = video.src.match(/youtube-nocookie\.com\/embed\/([\w-]{11})$/)?.[1];
    const source = id ? 'YouTube' : video.type === 'iframe' ? 'Vimeo' : 'Video';
    const title = label && label !== url ? label : `Watch video on ${new URL(url).hostname}`;
    const summary = description && description !== title
      ? `<span class="markdown-video-description" dir="auto">${escapeHtml(description)}</span>` : '';
    const image = id ? `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">` : '';
    cards.push(`<a class="markdown-video-preview" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="markdown-video-thumbnail">${image}<span class="markdown-video-play" aria-hidden="true">▶</span></span><span class="markdown-video-copy"><strong dir="auto">${escapeHtml(title)}</strong>${summary}<small>${source} · Watch video</small></span></a>`);
  }
  function visit(node) {
    const el = $(node);
    if (el.is('pre, code, .footnotes, [hidden], [data-note-hidden]')) return;
    if (node.type === 'tag' && node.name === 'a') {
      add(el.attr('href') || '', el.text().trim(), el.attr('title') || '');
      return;
    }
    if (node.type === 'text') {
      for (const link of linkify.match(node.data) || []) add(link.url, '');
    }
    for (const child of node.children || []) visit(child);
  }
  visit($.root()[0]);
  if (!cards.length) return html;
  const previews = `\n<aside class="markdown-video-previews" aria-label="Videos">${cards.join('')}</aside>\n`;
  const footnotes = $.root().children('section.footnotes').last();
  if (!footnotes.length) return html + previews;
  const separator = footnotes.prev('hr.footnotes-sep');
  (separator.length ? separator : footnotes).before(previews);
  return $.html();
};
