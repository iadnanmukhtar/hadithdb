'use strict';

// Use the same public title, description, image and canonical as the HTML head.
module.exports = function pageStructuredData({ page, title, description, image, url, siteName, siteUrl, logo, breadcrumbs, bookUrl, chapterUrl, commentaryUrl }) {
  const context = page.context || {};
  const website = { '@type': 'WebSite', '@id': siteUrl + '#website', name: siteName, url: siteUrl };
  const publisher = { '@type': 'Organization', '@id': siteUrl + '#publisher', name: siteName, url: siteUrl, logo };
  website.publisher = { '@id': publisher['@id'] };
  if (page.menu === 'Home') {
    website.potentialAction = {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: siteUrl + '/?q={search_term_string}' },
      'query-input': 'required name=search_term_string'
    };
  }
  const webPage = {
    '@type': page.schemaType || 'WebPage', '@id': url, name: title, description, url,
    image, dateModified: page.dateModified, isPartOf: { '@id': website['@id'] }
  };
  const nodes = [publisher, website, webPage];
  if (breadcrumbs.length > 1) {
    webPage.breadcrumb = { '@id': url + '#breadcrumbs' };
    nodes.push({ '@type': 'BreadcrumbList', ...webPage.breadcrumb, itemListElement: breadcrumbs });
  }
  function addBook(book, href) {
    if (!book || !href) return;
    const author = book.author_en || book.author;
    const node = {
      '@type': 'Book', '@id': href + '#book', url: href,
      name: book.name_en || book.shortName_en || book.title || book.name || book.alias,
      alternateName: book.title || book.name || book.shortName || undefined,
      author: author ? { '@type': 'Person', name: author } : undefined
    };
    nodes.push(node);
    webPage.about = { '@id': node['@id'] };
  }
  addBook(context.book, bookUrl);
  addBook(page.sharhBook || context.quranCommentaryBook || context.commentaryBook, commentaryUrl);
  if (context.chapter && chapterUrl && bookUrl) {
    const chapter = context.chapter;
    nodes.push({
      '@type': 'Chapter', name: chapter.title_en || chapter.title || String(chapter.h1),
      url: chapterUrl, isPartOf: { '@id': bookUrl + '#book' }
    });
  }
  if (page.articleType) {
    webPage.mainEntity = { '@id': url + '#article' };
    nodes.push({
      '@type': page.articleType, ...webPage.mainEntity, headline: title, description, image, url,
      mainEntityOfPage: { '@id': url }, dateModified: page.dateModified,
      author: page.articleAuthor ? { '@type': 'Person', name: page.articleAuthor } : undefined,
      isPartOf: webPage.about, publisher: website.publisher
    });
  }
  return nodes.map(node => ({ '@context': 'https://schema.org', ...node }));
};
