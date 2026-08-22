'use strict';

const fs = require('fs');
const path = require('path');

describe('shared header navigation', () => {
  const header = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'sub-views', 'header.ejs'),
    'utf8'
  );
  const styles = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'),
    'utf8'
  );
  const scripts = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'),
    'utf8'
  );

  test('uses the full page width', () => {
    expect(header).toContain('<nav class="navbar site-navbar fixed-top">');
    expect(header).toContain('<div class="container-fluid d-block">');
    expect(header).not.toContain('site-navbar fixed-top container col-lg-8');
    expect(styles).toContain('.site-navbar > .container-fluid > .site-navbar-main');
    expect(styles).not.toContain('.site-navbar > .site-navbar-main');
  });

  test('keeps one offcanvas hamburger outside breakpoint-specific actions', () => {
    expect(header.match(/class="[^"]*top-nav-menu-toggle[^"]*"/g)).toHaveLength(1);
    expect(header).toContain('<div class="col-auto d-flex align-items-center site-navbar-menu-toggle">');
    expect(header).toContain('data-bs-target="#offcanvas-topnav"');
  });

	test('renames only the Quran Sections menu label to Passages', () => {
	  expect(header).toContain("isQuranToc ? 'Show passages' : 'Show sections'");
	  expect(header).toContain("isQuranToc ? 'Passages' : 'Sections'");
	  expect(header).toContain('<span class="chapter-toc-current">§<%= page.context.section.h2 %></span>');
	  expect(header).toContain("<%= `§${section.h2 + (section.h3 ? `-${section.h3}` : '')}` %>");
	});

	test('fades the tafsir book carousel with reader navigation chrome', () => {
	  expect(styles).toContain('body.reader-infinite-nav-faded main.tafsir-only-page > .quran-tafsirs > .h-menu-wrap');
	  expect(styles).toMatch(/\.quran-tafsirs>\.h-menu-wrap\s*\{[^}]*transition: opacity \.22s ease, transform \.22s ease;/s);
	});

	test('keeps the tafsir book carousel below the live header height', () => {
	  expect(styles).toMatch(/\.quran-tafsirs>\.h-menu-wrap\s*\{[^}]*top: var\(--site-fixed-header-height, 4\.25rem\);/s);
	  expect(scripts).toContain('initFixedHeaderOffsetObserver();');
	  expect(scripts).toContain('fixedHeaderResizeObserver.observe(navbar);');
	  expect(scripts).toContain("fixedHeaderResizeObserver.observe(navbarMain);");
	});
});
