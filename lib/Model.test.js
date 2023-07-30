// @ts-check
'use strict';
require('./Globals');
const { Item, Chapter, Section, Subsection, Heading, Library } = require("./Model");

describe('Models tests', () => {

	test('item from id', async () => {
		var item;
		Library.init();
		expect((item = await Item.itemFromRef(210884))).toBeDefined();
		expect(item.hId).toBe(210884);
		expect((item = await Item.itemFromRef('tabarani:236'))).toBeDefined();
		expect(item.ref).toBe('tabarani:236');
	});

	test('item prev/next', async () => {
		var item = await (await Item.itemFromRef('tabarani:236')).getPrev();
		expect(item.ref).toBe('tabarani:235');
		item = await (await Item.itemFromRef('tabarani:236')).getNext();
		expect(item.ref).toBe('tabarani:237');
	});

	test('item headings', async () => {
		var item = await Item.itemFromRef('tabarani:236');
		expect(item.chapter).toBeInstanceOf(Chapter);
		expect(item.section).toBeInstanceOf(Section);
		expect(item.subsection).toBeInstanceOf(Subsection);
		var chapter = await (await Item.itemFromRef('tabarani:236')).getChapter();
		expect(chapter).toBeInstanceOf(Chapter);
		var section = await (await Item.itemFromRef('tabarani:236')).getSection();
		expect(section).toBeInstanceOf(Section);
		var subsection = await (await Item.itemFromRef('tabarani:236')).getSubsection();
		expect(subsection).toBeInstanceOf(Subsection);
	});

	test('heading from id/path', async () => {
		var heading;
		expect((heading = await Heading.headingFromRef(89392))).toBeDefined();
		expect(heading.path).toBe('tabarani/1/6/1');
		expect((heading = await Heading.headingFromRef('tabarani/1/6/1'))).toBeDefined();
		expect(heading.hId).toBe(89392);
	});

	test('heading prev/next', async () => {
		var heading = await (await Heading.headingFromRef('tabarani/1/6/1')).getPrev();
		expect(heading).toBeInstanceOf(Section);
		expect(heading.path).toBe('tabarani/1/6');
		heading = await (await Heading.headingFromRef('tabarani/1/6/1')).getNext();
		expect(heading).toBeInstanceOf(Subsection);
		expect(heading.path).toBe('tabarani/1/6/2');
	});

	test('heading parent', async () => {
		var heading = await (await Heading.headingFromRef('tabarani/1/6/1')).getParent();
		expect(heading).toBeInstanceOf(Section);
		expect(heading.path).toBe('tabarani/1/6');
	});

	test('heading children', async () => {
		var chapter = await Heading.headingFromRef('tabarani/1');
		expect(chapter).toBeInstanceOf(Chapter);
		var sections = await chapter.getChildren();
		expect(sections).toBeInstanceOf(Array);
		expect(sections[0]).toBeInstanceOf(Section);
		expect(sections[0].path).toBe('tabarani/1/1');
		var subsections = await sections[0].getChildren();
		expect(subsections).toBeInstanceOf(Array);
		expect(subsections[0]).toBeInstanceOf(Subsection);
		expect(subsections[0].path).toBe('tabarani/1/1/1');
	});

	test('heading items', async () => {
		var items = await (await Heading.headingFromRef('tabarani/1/1/1')).getItems();
		expect(items).toBeInstanceOf(Array);
	});

});