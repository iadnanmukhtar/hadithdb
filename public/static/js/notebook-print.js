(() => {
  'use strict';
  window.NotebookPrint = {
    async open(note, render, isCurrent) {
      // Open during the click, before authentication/rendering can consume user activation.
      const popup = window.open('', '_blank');
      if (!popup) throw new Error('Allow pop-ups for this site to print or save as a PDF.');
      popup.opener = null;
      const doc = popup.document;
      doc.open();
      doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Note</title></head><body><aside>Preparing document…</aside><main></main></body></html>');
      doc.close();
      const style = doc.createElement('style');
      style.textContent = `
        @page { margin: 18mm; }
        * { box-sizing: border-box; }
        html { font-size: 12pt; }
        body { margin: 0; color: #111; background: white; font: 1rem/1.8 Georgia, "Times New Roman", serif; }
        main { max-width: 48rem; margin: 2rem auto; padding: 0 1rem; overflow-wrap: anywhere; }
        aside { padding: .75rem 1rem; background: #f3f3f3; font: 14px/1.5 system-ui, sans-serif; }
        button { margin-inline-end: 1rem; padding: .4rem .7rem; cursor: pointer; }
        .metadata { font-size: .85rem; color: #444; margin-block: .5rem; }
        header { border-bottom: 1px solid #ccc; padding-bottom: 1rem; margin-bottom: 1.5rem; }
        header h1 { margin: 0; font-size: 1.4rem; }
        .notebook-markdown { --note-ink: #111; --note-link: #111; --note-edge: #999; }
        .notebook-markdown mark { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .notebook-markdown pre { white-space: pre-wrap; overflow-wrap: anywhere; }
        .notebook-markdown tr, .notebook-markdown img { break-inside: avoid; }
        .notebook-markdown .footnotes-sep { break-after: avoid; }
        .notebook-markdown .footnotes { break-inside: avoid; }
        .notebook-markdown thead { display: table-header-group; }
        .notebook-markdown :is(h1,h2,h3,h4,h5,h6) { break-after: avoid; }
        .notebook-markdown :is(p,li) { orphans: 3; widows: 3; }
        .notebook-expand-reference, .footnote-backref { display: none; }
        @media print { aside { display: none; } main { max-width: none; margin: 0; padding: 0; } }
      `;
      const stylesheet = doc.createElement('link');
      stylesheet.rel = 'stylesheet';
      const version = document.querySelector('link[href*="/static/css/"]')?.href;
      stylesheet.href = location.origin + '/static/css/markdown-content.css' + (version ? new URL(version).search : '');
      const stylesReady = new Promise((resolve, reject) => {
        stylesheet.onload = resolve;
        stylesheet.onerror = () => reject(new Error('Unable to load print styles. Please try again.'));
      });
      // Attach the rejection handler before rendering may await authentication.
      stylesReady.catch(() => {});
      doc.head.append(stylesheet, style);
      try {
        const result = await render();
        if (popup.closed) return;
        if (!isCurrent()) { popup.close(); return; }
        note = result.note || note;
        const title = note.title?.trim() || note.source_title || 'Note';
        doc.title = title;
        const main = doc.querySelector('main');
        const header = doc.createElement('header');
        const heading = doc.createElement('h1');
        heading.dir = 'auto'; heading.textContent = title; header.append(heading);
        if (note.source_url && note.source_key !== 'general' && !note.source_key?.startsWith('general:')) {
          const url = new URL(note.source_url, location.origin);
          if (['http:', 'https:'].includes(url.protocol)) {
            const source = doc.createElement('p'); source.className = 'metadata'; source.dir = 'auto';
            const link = doc.createElement('a'); link.href = url.href; link.textContent = note.source_title || url.href;
            source.append(link); header.append(source);
          }
        }
        if (note.tags?.trim()) {
          const tags = doc.createElement('p'); tags.className = 'metadata'; tags.dir = 'auto';
          tags.textContent = note.tags; header.append(tags);
        }
        const article = doc.createElement('article');
        article.className = 'notebook-markdown';
        article.dir = 'auto';
        // Use sanitized output from the shared Markdown renderer.
        article.innerHTML = result.html;
        article.querySelectorAll('.notebook-expand-reference, .footnote-backref').forEach(node => node.remove());
        article.querySelectorAll('a[href]').forEach(link => {
          const href = link.getAttribute('href');
          if (href.startsWith('#')) link.removeAttribute('target');
          else link.href = new URL(href, location.href).href;
        });
        article.querySelectorAll('img').forEach(img => {
          img.loading = 'eager';
          if (img.getAttribute('src')) img.src = new URL(img.getAttribute('src'), location.href).href;
        });
        main.append(header, article);
        const toolbar = doc.querySelector('aside');
        toolbar.textContent = 'Choose Save as PDF in the print dialog to download a PDF, or select your printer.';
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Print / Save as PDF';
        button.disabled = true; button.addEventListener('click', () => popup.print()); toolbar.prepend(button);
        // Wait for Arabic fonts and images before the browser paginates the document.
        await stylesReady;
        await Promise.all([doc.fonts.ready, ...Array.from(doc.images, img => img.decode().catch(() => {}))]);
        if (popup.closed) return;
        if (!isCurrent()) { popup.close(); return; }
        button.disabled = false;
        popup.focus(); popup.print();
      } catch (err) {
        if (!popup.closed) popup.close();
        throw err;
      }
    }
  };
})();
