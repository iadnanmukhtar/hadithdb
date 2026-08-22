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
});
