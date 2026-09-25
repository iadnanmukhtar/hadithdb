(() => {
  'use strict';
  window.NotebookPrint = {
    async open(note, render, isCurrent) {
      // Open during the click, before authentication/rendering can consume user activation.
      const popup = window.open('', '_blank');
      if (!popup) throw new Error('Allow pop-ups for this site to print or save your note as a PDF.');
      popup.opener = null;
      const doc = popup.document;
      doc.open();
      doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Note</title></head><body><aside>Preparing note…</aside><main></main></body></html>');
      doc.close();
      const style = doc.createElement('style');
      style.textContent = `
        @font-face { font-family: Kitab; src: url("${location.origin}/static/fonts/kitab-base.woff2"); }
        @font-face { font-family: Kitab; font-weight: 700; src: url("${location.origin}/static/fonts/kitab-base-b.woff2"); }
        @page { margin: 18mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111; background: white; font: 12pt/1.65 Georgia, Kitab, serif; }
        main { max-width: 48rem; margin: 2rem auto; padding: 0 1rem; overflow-wrap: anywhere; }
        aside { padding: .75rem 1rem; background: #f3f3f3; font: 14px/1.5 system-ui, sans-serif; }
        button { margin-inline-end: 1rem; padding: .4rem .7rem; cursor: pointer; }
        h1 { font-size: 22pt; } h2 { font-size: 18pt; } h3 { font-size: 15pt; }
        h1, h2, h3, h4, h5, h6 { line-height: 1.4; break-after: avoid; }
        [dir="auto"] { unicode-bidi: plaintext; text-align: start; }
        :is(p,h1,h2,h3,h4,h5,h6,li,td,th):dir(rtl), .notebook-arabic { font-family: Kitab, serif; line-height: 2; }
        .notebook-arabic { font-size: 1.2em; } .notebook-arabic .notebook-arabic { font-size: inherit; }
        [data-notebook-overline] { font-family: Arial, 'Noto Naskh Arabic', sans-serif; }
        strong, strong .notebook-arabic { font-weight: 700; }
        em, em .notebook-arabic { font-style: italic; font-synthesis: style; }
        mark { background: #ffe680; color: #111; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        u { text-decoration: none; }
        .notebook-underline { text-decoration: underline; text-underline-offset: .15em; }
        .metadata { font-size: 10pt; color: #444; margin-block: .5rem; }
        header { border-bottom: 1px solid #ccc; padding-bottom: 1rem; margin-bottom: 1.5rem; }
        header h1 { margin: 0; }
        a { color: inherit; text-decoration: underline; }
        blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid #ccc; }
        pre { white-space: pre-wrap; overflow-wrap: anywhere; direction: ltr; text-align: left; }
        img { max-width: 100%; height: auto; break-inside: avoid; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        td, th { border: 1px solid #bbb; padding: .4rem; vertical-align: top; }
        tr { break-inside: avoid; } thead { display: table-header-group; }
        p, li { orphans: 3; widows: 3; }
        .notebook-expand-reference, .footnote-backref { display: none; }
        @media print { aside { display: none; } main { max-width: none; margin: 0; padding: 0; } }
      `;
      doc.head.append(style);
      try {
        const result = await render();
        if (popup.closed) return;
        if (!isCurrent()) { popup.close(); return; }
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
        // Use the authenticated notebook renderer, which disables raw HTML.
        article.innerHTML = result.html;
        article.querySelectorAll('.notebook-expand-reference, .footnote-backref').forEach(node => node.remove());
        article.querySelectorAll('a[href]').forEach(link => {
          const href = link.getAttribute('href');
          if (href.startsWith('#')) link.removeAttribute('target');
          else link.href = new URL(href, location.href).href;
        });
        article.querySelectorAll('img').forEach(img => { img.loading = 'eager'; });
        main.append(header, article);
        const toolbar = doc.querySelector('aside');
        toolbar.textContent = 'Choose Save as PDF in the print dialog to download a PDF, or select your printer.';
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Print / Save as PDF';
        button.disabled = true; button.addEventListener('click', () => popup.print()); toolbar.prepend(button);
        // Wait for Arabic fonts and images before the browser paginates the document.
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
