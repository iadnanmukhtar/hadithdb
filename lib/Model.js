// @ts-check
'user strict';

const u = require('./Utils');
const Index = require('./Index');
const Arabic = require('./Arabic');

/**
 * @type {Record}
 */
class Record {

	/** @type {number} */ book_id;

	constructor() { }

	/**
	 * @returns {Book}
	 */
	get book() {
		return Library.instance.findBook(this.book_id);
	}

}

/**
 * @type {Item}
 */
class Item extends Record {

	/** @type {string} */ static INDEX = 'hadiths';
	/** @type {string} */ static TABLE = 'hadiths';

	/** @type {Item} */ prev;
	/** @type {Item} */ next;
	/** @type {Chapter} */ chapter;
	/** @type {Section} */ section;
	/** @type {Subsection} */ subsection;

	/** @type {number} */ _id;
	/** @type {number} */ id;
	/** @type {number} */ hId;
	/** @type {string} */ ref;
	/** @type {string} */ path;
	/** @type {string} */ ref_ref;
	/** @type {number} */ prevId;
	/** @type {number} */ nextId;
	/** @type {number} */ grade_id;
	/** @type {number} */ grader_id;
	/** @type {number} */ level;
	/** @type {number} */ h1;
	/** @type {number} */ h1_id;
	/** @type {number} */ h2;
	/** @type {number} */ h2_id;
	/** @type {number} */ h3;
	/** @type {number} */ h3_id;
	/** @type {number} */ book_virtual;

	/** @type {string} */ book_shortName_en;
	/** @type {string} */ book_shortName;
	/** @type {string} */ book_name_en;
	/** @type {string} */ book_name;
	/** @type {string} */ h1_title_en;
	/** @type {string} */ h1_title;
	/** @type {string} */ h1_intro_en;
	/** @type {string} */ h1_intro;
	/** @type {string} */ h2_title_en;
	/** @type {string} */ h2_title;
	/** @type {string} */ h2_intro_en;
	/** @type {string} */ h2_intro;
	/** @type {string} */ h3_title_en;
	/** @type {string} */ h3_title;
	/** @type {string} */ h3_intro_en;
	/** @type {string} */ h3_intro;
	/** @type {string} */ num;
	/** @type {number} */ num0;
	/** @type {string} */ grade_grade_en;
	/** @type {string} */ grade_grade;
	/** @type {string} */ grader_shortName_en;
	/** @type {string} */ grader_shortName;
	/** @type {string} */ grader_name_en;
	/** @type {string} */ grader_name;
	/** @type {string} */ title_en;
	/** @type {string} */ title;
	/** @type {string} */ part_en;
	/** @type {string} */ part;
	/** @type {string} */ chain_en;
	/** @type {string} */ chain;
	/** @type {string} */ body_en;
	/** @type {string} */ body;
	/** @type {string} */ footnote_en;
	/** @type {string} */ footnote;

	/** @type {number} */ hId_ref;
	/** @type {string} */ book_alias_ref;
	/** @type {string} */ book_shortName_en_ref;
	/** @type {number} */ book_shortName_ref;
	/** @type {string} */ book_name_en_ref;
	/** @type {string} */ book_name_ref;
	/** @type {string} */ book_author_ref;
	/** @type {number} */ level_ref;
	/** @type {string} */ path_ref;
	/** @type {number} */ ordinal_ref;
	/** @type {number} */ numInChapter_ref;
	/** @type {string} */ num_ref;
	/** @type {number} */ num0_ref;
	/** @type {number} */ h1_id_ref;
	/** @type {string} */ h1_ref;
	/** @type {string} */ h1_title_en_ref;
	/** @type {string} */ h1_title_ref;
	/** @type {string} */ h1_intro_en_ref;
	/** @type {string} */ h1_intro_ref;
	/** @type {number} */ h1_start_ref;
	/** @type {number} */ h1_count_ref;
	/** @type {number} */ h2_id_ref;
	/** @type {string} */ h2_ref;
	/** @type {string} */ h2_title_en_ref;
	/** @type {string} */ h2_title_ref;
	/** @type {string} */ h2_intro_en_ref;
	/** @type {string} */ h2_intro_ref;
	/** @type {number} */ h2_start_ref;
	/** @type {number} */ h2_count_ref;
	/** @type {number} */ h3_id_ref;
	/** @type {string} */ h3_ref;
	/** @type {string} */ h3_title_en_ref;
	/** @type {string} */ h3_title_ref;
	/** @type {string} */ h3_intro_en_ref;
	/** @type {string} */ h3_intro_ref;
	/** @type {number} */ h3_start_ref;
	/** @type {number} */ h3_count_ref;

	/**
	 * @param {*} item
	 * @override
	 */
	constructor(item) {
		super();
		if (item === undefined)
			item = {};
		for (var k in item)
			this[k] = item[k];
		if (this.id === undefined)
			this.id = this._id;
		if (this.id === undefined)
			this.id = this.hId;
		if (this.bookId === undefined)
			this.bookId = this.book_id;

		var clone = {};
		if (u.isTruthy(this.h3)) {
			// generate subsection from item
			for (k in item)
				clone[k] = item[k];
			clone.level = this.level = 3;
			clone.id = clone._id = clone.hId = clone.tId = clone.h3_id;
			clone.path = clone.ref = `${this.book.alias}/${this.h1}/${this.h2}/${this.h3}`;
			clone.prevId = clone.nextId = null;
			this.subsection = new Subsection(clone);
		}
		if (u.isTruthy(this.h2)) {
			// generate section from item
			for (k in item)
				clone[k] = item[k];
			clone.level = this.level = 2;
			clone.id = clone._id = clone.hId = clone.tId = clone.h2_id;
			clone.path = clone.ref = `${this.book.alias}/${this.h1}/${this.h2}`;
			clone.h3 = clone.prevId = clone.nextId = null;
			this.section = new Section(clone);
		}
		if (u.isTruthy(this.h1)) {
			// generate chapter from item
			for (k in item)
				clone[k] = item[k];
			clone.level = this.level = 1;
			clone.id = clone._id = clone.hId = clone.tId = clone.h1_id;
			clone.path = clone.ref = `${this.book.alias}/${this.h1}`;
			clone.h2 = clone.h3 = clone.prevId = clone.nextId = null;
			this.chapter = new Chapter(clone);
		}

		this.en = {};
		this.ar = {};

		if (this.book_virtual === 1) {
			this.actual = {};
			this.en.actual = {};
			this.ar.actual = {};
			this.actual.id = this.actual.hId = this.hId_ref;
			this.actual.book_alias = this.book_alias_ref;
			this.en.actual.book_shortName = this.book_shortName_en_ref;
			this.ar.actual.book_shortName = this.book_shortName_ref;
			this.en.actual.book_name = this.book_name_en_ref;
			this.ar.actual.book_name = this.book_name_ref;
			this.actual.book_author = this.book_author_ref;
			this.actual.level = this.level_ref;
			this.actual.path = this.path_ref;
			this.actual.ordinal = this.ordinal_ref;
			this.actual.numInChapter = this.numInChapter_ref;
			this.en.actual.num = this.num_ref;
			this.ar.actual.num = Arabic.toArabicDigits(this.num_ref);
			this.actual.num0 = this.num0_ref;
			this.actual.h1_id = this.h1_id_ref;
			this.actual.h1 = this.h1_ref;
			this.en.actual.h1_title = this.h1_title_en_ref;
			this.ar.actual.h1_title = this.h1_title_ref;
			this.en.actual.h1_intro = this.h1_intro_en_ref;
			this.ar.actual.h1_intro = this.h1_intro_ref;
			this.actual.h1_start = this.h1_start_ref;
			this.actual.h1_count = this.h1_count_ref;
			this.actual.h2_id = this.h2_id_ref;
			this.actual.h2 = this.h2_ref;
			this.en.actual.h2_title = this.h2_title_en_ref;
			this.ar.actual.h2_title = this.h2_title_ref;
			this.en.actual.h2_intro = this.h2_intro_en_ref;
			this.ar.actual.h2_intro = this.h2_intro_ref;
			this.actual.h2_start = this.h2_start_ref;
			this.actual.h2_count = this.h2_count_ref;
			this.actual.h3_id = this.h3_id_ref;
			this.actual.h3 = this.h3_ref;
			this.en.actual.h3_title = this.h3_title_en_ref;
			this.ar.actual.h3_title = this.h3_title_ref;
			this.en.actual.h3_intro = this.h3_intro_en_ref;
			this.ar.actual.h3_intro = this.h3_intro_ref;
			this.actual.h3_start = this.h3_start_ref;
			this.actual.h3_count = this.h3_count_ref;
		}
		this.en.book_shortName = this.book_shortName_en;
		this.ar.book_shortName = this.book_shortName;
		this.en.book_name = this.book_name_en;
		this.ar.book_name = this.book_name;
		this.en.h1_title = this.h1_title_en;
		this.ar.h1_title = this.h1_title;
		this.en.h1_intro = this.h1_intro_en;
		this.ar.h1_intro = this.h1_intro;
		this.en.h2_title = this.h2_title_en;
		this.ar.h2_title = this.h2_title;
		this.en.h2_intro = this.h2_intro_en;
		this.ar.h2_intro = this.h2_intro;
		this.en.h3_title = this.h3_title_en;
		this.ar.h3_title = this.h3_title;
		this.en.h3_intro = this.h3_intro_en;
		this.ar.h3_intro = this.h3_intro;
		this.en.num = this.num;
		this.ar.num = Arabic.toArabicDigits(this.num);
		this.en.grade_grade = this.grade_grade_en;
		this.ar.grade_grade = this.grade_grade;
		this.en.grader_shortName = this.grader_shortName_en;
		this.ar.grader_shortName = this.grader_shortName;
		this.en.grader_name = this.grader_name_en;
		this.ar.grader_name = this.grader_name;
		this.en.title = this.title_en;
		this.ar.title = this.title;
		this.en.part = this.part_en;
		this.ar.part = this.part;
		this.en.chain = this.chain_en;
		this.ar.chain = this.chain;
		this.en.body = this.body_en;
		this.ar.body = this.body;
		this.en.footnote = this.footnote_en;
		this.ar.footnote = this.footnote;
	}

	/**
	 * @returns {Grade}
	 */
	get grade() {
		return Library.instance.findGrade(this.grade_id);
	}

	/**
	 * @returns {Grader}
	 */
	get grader() {
		return Library.instance.findGrader(this.grader_id);
	}

	/**
	 * @returns (Heading)
	 */
	get heading() {
		return this.subsection || this.section || this.chapter;
	}

	/**
	 * @returns {Promise<Item>}
	 */
	async getPrev() {
		if (this.prev === undefined) {
			var prev = await Index.docFromId(Item.INDEX, this.prevId);
			this.prev = prev ? new Item(prev) : null;
		}
		return this.prev;
	}

	/**
	 * @returns {Promise<Item>}
	 */
	async getNext() {
		if (this.next === undefined) {
			var next = await Index.docFromId(Item.INDEX, this.nextId);
			this.next = next ? new Item(next) : null;
		}
		return this.next;
	}

	/**
	 * @returns {Promise<Chapter>}
	 */
	async getChapter() {
		if (this.chapter === undefined) {
			var chapter = await Index.docFromId(Heading.INDEX, this.h1_id);
			if (!chapter)
				throw new ReferenceError(`Not found: Chapter Id ${this.h1_id}`);
			chapter = new Chapter(chapter);
		}
		return this.chapter;
	}

	/**
	 * @returns {Promise<Section>}
	 */
	async getSection() {
		if (this.section === undefined) {
			var section = await Index.docFromId(Heading.INDEX, this.h2_id);
			if (!section)
				throw new ReferenceError(`Not found: Section Id ${this.h2_id}`);
			section = new Section(section);
		}
		return this.section;
	}

	/**
	 * @returns {Promise<Subsection>}
	 */
	async getSubsection() {
		if (this.subsection === undefined) {
			var subsection = await Index.docFromId(Heading.INDEX, this.h3_id);
			if (!subsection)
				throw new ReferenceError(`Not found: Subsection Id ${this.h3_id}`);
			subsection = new Subsection(subsection);
		}
		return this.subsection;
	}

	/**
	 * @override
	 */
	toString() {
		return this.book_virtual ? `Virtual Item ${this.ref_ref}` : `Item ${this.ref}`;
	}

	/**
	 * @param {string|number} ref Item reference number or Item Id
	 * @returns {Promise<Item>}
	 */
	static async itemFromRef(ref) {
		var item;
		if (Number.isInteger(ref)) {
			item = await Index.docFromId(Item.INDEX, ref);
			if (!item)
				throw new ReferenceError(`Not found: Item ${ref}`);
		} else {
			item = await Index.docsFromKeyValue(Item.INDEX, { ref: ref }, 0, 1);
			if (item.length < 1)
				throw new ReferenceError(`Not found: Item ${ref}`);
			item = item[0];
		}
		item = new Item(item);
		return item;
	}

}

/**
 * @type {GhostItem}
 */
class GhostItem extends Item {

	/**
	 * @param {Heading} heading;
	 * @override
	 */
	constructor(heading) {
		super(heading);
		this.id = this.hId = undefined;
		this.title_en = this.en.title_en = 'Ghost Item';
	}

}

/**
 * @type {Heading} A heading in a book
 */
class Heading extends Record {

	/** @type {string} */ static INDEX = 'toc';
	/** @type {string} */ static TABLE = 'v_toc';
	/** @type {string} */ static TABLE_RAW = 'toc';

	/** @type {Heading} */ prev;
	/** @type {Heading} */ next;
	/**
	 * @type {{ 
	* 		hasNext: boolean; 
	* 		offset: number; 
	* 		number: number; 
	* 		prevOffset: number; 
	* 		nextOffset: number; 
	* 		hasPrev: boolean;
	* }}
	*/
	page;

	/** @type {number} */ _id;
	/** @type {number} */ id;
	/** @type {number} */ ordinal;
	/** @type {number} */ prevId;
	/** @type {number} */ nextId;
	/** @type {string} */ path;
	/** @type {number} */ level;
	/** @type {string} */ book_alias;
	/** @type {number} */ h1;
	/** @type {number} */ h1_id;
	/** @type {number} */ h2;
	/** @type {number} */ h2_id;
	/** @type {number} */ h3;
	/** @type {number} */ h3_id;
	/** @type {boolean} */ incomplete;
	/** @type {Heading} @package */ _parent;
	/** @type {Heading[]} @package */ _children;

	/**
	 * @param {*} heading
	 * @override
	 */
	constructor(heading) {
		super();
		if (heading === undefined)
			heading = {};
		for (var k in heading)
			this[k] = heading[k];
		if (this.id === undefined)
			this.id = this._id;
		normalizeHeadingAttributes(this);
		if (this.prevId !== null)
			this.incomplete = false;
	}

	get previous() {
		return this.prev;
	}

	/**
	 * @returns {Promise<Heading>}
	 */
	async getPrev() {
		if (this.prev === undefined) {
			var prev;
			switch (this.level) {
				case 1:
					prev = await Index.docsFromQueryString(Heading.INDEX, `ordinal:<${this.ordinal} AND level:1`, 0, 1, 'ordinal DESC');
					break;
				case 2:
					prev = await Index.docsFromQueryString(Heading.INDEX, `ordinal:<${this.ordinal} AND level:2`, 0, 1, 'ordinal DESC');
					break;
			}
			this.prev = (prev.length > 0) ? Heading.toLevel(prev[0]) : null;
		}
		return this.prev;
	}

	/**
	 * @returns {Promise<Heading>}
	 */
	async getNext() {
		if (this.next === undefined) {
			var next;
			switch (this.level) {
				case 1:
					next = await Index.docsFromQueryString(Heading.INDEX, `ordinal:>${this.ordinal} AND level:1`, 0, 1, 'ordinal ASC');
					break;
				case 2:
					next = await Index.docsFromQueryString(Heading.INDEX, `ordinal:>${this.ordinal} AND level:2`, 0, 1, 'ordinal ASC');
					break;
			}
			this.next = (next.length > 0) ? Heading.toLevel(next[0]) : null;
		}
		return this.next;
	}

	/**
	 * @returns {Promise<Heading>}
	 */
	async getParent() {
		if (this._parent === undefined) {
			var parent;
			switch (this.level) {
				case 2:
					parent = await Index.docsFromKeyValue(Heading.INDEX, { h1_id: this.h1_id });
					break;
				case 3:
					parent = await Index.docsFromKeyValue(Heading.INDEX, { h2_id: this.h2_id });
					break;
				default:
					throw new TypeError(`Parent undefined for Level ${this.level}`);
			}
			if (parent.length < 1)
				throw new ReferenceError(`Not found: Parent for Heading Id ${this.id}`);
			this._parent = Heading.toLevel(parent[0]);
		}
		return this._parent;
	}

	/**
	 * @returns {Promise<Heading[]>}
	 */
	async getChildren() {
		if (this._children === undefined) {
			var children;
			switch (this.level) {
				case 0:
					children = await Index.docsFromQueryString(Heading.INDEX,
						`book_alias:${this.book_alias} AND level:1`, 0, 1000, 'ordinal');
					for (var i in children)
						children[i] = new Chapter(children[i]);
					break;
				case 1:
					children = await Index.docsFromQueryString(Heading.INDEX,
						`book_alias:${this.book_alias} AND level:2 AND h1:${this.h1}`, 0, 1000, 'ordinal');
					for (i in children)
						children[i] = new Section(children[i]);
					break;
				case 2:
					children = await Index.docsFromQueryString(Heading.INDEX,
						`book_alias:${this.book_alias} AND level:3 AND h1:${this.h1} AND h2:${this.h2}`, 0, 1000, 'ordinal');
					for (i in children)
						children[i] = new Subsection(children[i]);
					break;
				case 3:
					throw new TypeError(`Level 3 heading cannot have any child headings`);
				default:
					throw new TypeError(`Children undefined for Level ${this.level}`);
			}
			this._children = children;
		}
		return this._children;
	}

	/**
	 * @param {number} [offset] = 0
	 * @param {number} [size]
	 * @returns {Promise<Item[]>}
	 */
	async getItems(offset, size) {
		// normalize offset
		if (offset === undefined)
			offset = 0;
		offset = Math.floor(offset / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage
		// get items per page based on offset
		if (size === undefined)
			size = global.settings.search.itemsPerPage;
		var items;
		if (this.book.virtual == 1) {
			switch (this.level) {
				case 1:
					items = await global.query(
						`SELECT DISTINCT * FROM v_hadiths_virtual WHERE book_id=${this.book.id} 
							AND h1=${this.h1}
						ORDER BY ordinal
						LIMIT ${offset},${size + 1}`);
					break;
				case 2:
					items = await global.query(
						`SELECT DISTINCT * FROM v_hadiths_virtual WHERE book_id=${this.book.id} 
							AND h1=${this.h1} AND h2=${this.h2}
						ORDER BY ordinal
						LIMIT ${offset},${size + 1}`);
					break;
				case 3:
					items = await global.query(
						`SELECT DISTINCT * FROM v_hadiths_virtual WHERE book_id=${this.book.id} 
							AND h1=${this.h1} AND h2=${this.h2} AND h3=${this.h3}
						ORDER BY ordinal
						LIMIT ${offset},${size + 1}`);
					break;
			}
		} else {
			switch (this.level) {
				case 0:
					items = await Index.docsFromQueryString(Item.INDEX,
						`book_alias:${this.book_alias} AND level:1`, offset, size + 1, 'ordinal');
					break;
				case 1:
					items = await Index.docsFromQueryString(Item.INDEX,
						`book_alias:${this.book_alias} AND h1:${this.h1}`, offset, size + 1, 'ordinal');
					break;
				case 2:
					items = await Index.docsFromQueryString(Item.INDEX,
						`book_alias:${this.book_alias} AND h1:${this.h1} AND h2:${this.h2}`, offset, size + 1, 'ordinal');
					break;
				case 3:
					items = await Index.docsFromQueryString(Item.INDEX,
						`book_alias:${this.book_alias} AND h1:${this.h1} AND h2:${this.h2} AND h3:${this.h3}`, offset, size + 1, 'ordinal');
					break;
			}
		}
		for (var i in items)
			items[i] = new Item(items[i]);
		this._items = items;
		// set offset based attributes
		this.page = {
			offset: offset,
			number: (offset / size) + 1,
			hasNext: (this._items.length > size),
			prevOffset: ((offset - size) < size) ? 0 : offset - size,
			nextOffset: offset + size,
			hasPrev: ((offset - size) >= 0),
		};
		if (this.page.hasNext)
			this._items.pop();
		return this._items;
	}

	/**
	 * @param {number} [offset] = 0
	 * @returns {Promise<Item[]>}
	 */
	async getVirtualItems(offset) {

	}

	/**
	 * @override
	 */
	toString() {
		return `Heading ${this.path}`;
	}

	/**
	 * @param {number|string} ref Heading ref
	 * @returns {Promise<Chapter|Section|Subsection>}
	 */
	static async headingFromRef(ref) {
		var heading;
		if (Number.isInteger(ref)) {
			heading = await Index.docFromId(Heading.INDEX, ref);
			if (!heading)
				throw new ReferenceError(`Not found: Heading ${ref}`);
		} else {
			heading = await Index.docsFromKeyValue(Heading.INDEX, { path: ref }, 0, 1);
			if (heading.length < 1)
				throw new ReferenceError(`Not found: Heading ${ref}`);
			heading = heading[0];
		}
		heading = Heading.toLevel(heading);
		return heading;
	}

	/**
	 * @param {*} heading
	 * @returns {Chapter|Section|Subsection}
	 */
	static toLevel(heading) {
		switch (heading.level) {
			case 1:
				return new Chapter(heading);
			case 2:
				return new Section(heading);
			case 3:
				return new Subsection(heading);
			default:
				throw new TypeError(`Heading undefined for Level ${heading.level}`);
		}
	}

}

/**
 * @type {Subsection}
 */
class Subsection extends Heading {

	/** @type {Chapter} */ chapter;
	/** @type {Section} */ section;

	/**
	 * @param {Object} subsection
	 */
	constructor(subsection) {
		super(subsection);
	}

	/**
	 * @returns {Promise<Chapter>}
	 */
	async getChapter() {
		if (this.chapter === undefined) {
			var chapter = await Index.docsFromQueryString(Heading.INDEX,
				`book_alias:${this.book_alias} AND level:1 AND h1:${this.h1}`, 0, 1);
			if (chapter.length < 1)
				throw new ReferenceError(`Not found: Chapter ${this.h1}`);
			this.chapter = new Chapter(chapter[0]);
		}
		return this.chapter;
	}

	/**
	 * @returns {Promise<Heading>}
	 */
	async getSection() {
		if (this.section === undefined)
			this.section = new Section(await this.getParent());
		this._parent = this.section;
		return this.section;
	}

	/**
	 * @override
	 */
	toString() {
		return `Subsection ${this.path}`;
	}

	/**
	 * @param {number|string} ref Heading ref
	 * @returns {Promise<Subsection>}
	 */
	static async subsectionFromRef(ref) {
		return /** @type {Subsection} */ (await Heading.headingFromRef(ref));
	}

}

/**
 * @type {Section} A section in a book chapter
 */
class Section extends Heading {

	/** @type {Chapter} */ chapter;
	/** @type {Subsection[]} */ subsections;

	/**
	 * @param {Object} section
	 */
	constructor(section) {
		super(section);
	}

	/**
	 * @returns {Promise<Chapter>}
	 */
	async getChapter() {
		if (this.chapter === undefined) {
			var chapter = await Index.docsFromQueryString(Heading.INDEX,
				`book_alias:${this.book_alias} AND level:1 AND h1:${this.h1}`, 0, 1);
			if (chapter.length < 1)
				throw new ReferenceError(`Not found: Chapter ${this.h1}`);
			this.chapter = new Chapter(chapter[0]);
		}
		return this.chapter;
	}

	/**
	 * @returns {Promise<Subsection[]>}
	 */
	async getSubsections() {
		if (this.subsections === undefined) {
			var subsections = await Index.docsFromQueryString(Heading.INDEX,
				`book_alias:${this.book_alias} AND level:3 AND h1:${this.h1} AND h2:${this.h2}`, 0, 1000, 'ordinal');
			for (var i in subsections)
				subsections[i] = new Subsection(subsections[i]);
			this.subsections = subsections;
		}
		return this.subsections;
	}

	/**
	 * @override
	 */
	toString() {
		return `Section ${this.path}`;
	}

	/**
	 * @param {number|string} ref Heading ref
	 * @returns {Promise<Section>}
	 */
	static async sectionFromRef(ref) {
		return /** @type {Section} */ (await Heading.headingFromRef(ref));
	}

}

/**
 * @type {Chapter} A chapter of a book
 */
class Chapter extends Heading {

	/** @type {Section} */ firstSection;
	/** @type {Section[]} */ sections;

	/**
	 * @param {Object} chapter
	 */
	constructor(chapter) {
		super(chapter);
	}

	/**
	 * @param {number} [offset] = 0
	 * @param {number} [size]
	 * @returns {Promise<Item[]>}
	 * @override
	 */
	async getItems(offset, size) {
		var items = await super.getItems(offset, size);
		// add missing empty sections
		if (offset === undefined)
			offset = 0;
		if (size === undefined)
			size = global.settings.search.itemsPerPage;
		var _sections = [...(await this.getSections())];
		for (var section of _sections) {
			if (!items.find(item => { return item.path === section.path })) {
				items.push(new GhostItem(section));
			}
		}
		items = items.sort((item1, item2) => {
			if (item1.h1 < item2.h1) return -1;
			if (item1.h1 > item2.h1) return 1;
			if (item1.h2 < item2.h2) return -1;
			if (item1.h2 > item2.h2) return 1;
			if (item1.h3 < item2.h3) return -1;
			if (item1.h3 > item2.h3) return 1;
			if (item1.num0 < item2.num0) return -1;
			if (item1.num0 > item2.num0) return 1;
			return 0;
		});
		// trim ghost items from top from subsequent pages
		if (offset > 0) {
			var start = items.findIndex(item => {
				return !(item instanceof GhostItem);
			});
			items.splice(0, start);
		}
		// trim ghost items from bottom from subsequent pages
		var reverseItems = items.reverse();
		var end = reverseItems.findIndex(item => {
			return !(item instanceof GhostItem);
		});
		reverseItems.splice(0, end);
		items = reverseItems.reverse();
		return items;
	}

	/**
	 * @returns {Promise<Section>}
	 */
	async getFirstSection() {
		if (this.firstSection === undefined) {
			var _sections = await Index.docsFromQueryString(Heading.INDEX,
				`book_alias:${this.book_alias} AND level:2 AND h1:${this.h1}`, 0, 1, 'ordinal');
			if (_sections.length > 0)
				this.firstSection = new Section(_sections[0]);
			else
				this.firstSection = null;
		}
		return this.firstSection;
	}

	/**
	 * @returns {Promise<Section[]>}
	 */
	async getSections() {
		if (this.sections === undefined) {
			var _sections = await Index.docsFromQueryString(Heading.INDEX,
				`book_alias:${this.book_alias} AND level:2 AND h1:${this.h1}`, 0, 1000, 'ordinal');
			for (var i in _sections)
				_sections[i] = new Section(_sections[i]);
			this.sections = _sections;
		}
		return this.sections;
	}

	/**
	 * @override
	 */
	toString() {
		return `Chapter ${this.path}`;
	}

	/**
	 * @param {number|string} ref Heading ref
	 * @returns {Promise<Chapter>}
	 */
	static async chapterFromRef(ref) {
		return /** @type {Chapter} */ (await Heading.headingFromRef(ref));
	}

}


/**
 * @type {Book} A book in the library
 */
class Book {

	/** @type {number} */ id;
	/** @type {string} */ alias;
	/** @type {number} */ virtual;
	/** @type {Chapter[]} */ chapters;


	/**
	 * @param {*} record 
	 */
	constructor(record) {
		if (record === undefined)
			record = {};
		for (var k in record)
			this[k] = record[k];
	}

	/**
	 * @returns {Promise<Chapter[]}
	 */
	async getChapters() {
		if (this.chapters === undefined) {
			var chapters = await Index.docsFromQueryString(Heading.INDEX,
				`book_alias:${this.alias} AND level:1`, 0, 1000, 'ordinal');
			for (var i in chapters) {
				chapters[i] = new Chapter(chapters[i]);
				await chapters[i].getFirstSection();
			}
			this.chapters = chapters;
		}
		return this.chapters;
	}

	/**
	 * @param {number|string} ref 
	 * @returns {Promise<Book>}
	 */
	static async fromId(ref) {
		if (ref === undefined)
			throw new ReferenceError(`Not found: Book ${ref}`);
		var book = null;
		if (global.library !== undefined) {
			book = global.library.findBook(ref);
		} else {
			if (Number.isInteger(ref))
				book = await global.query(`SELECT * FROM books WHERE id=${ref} LIMIT 1`);
			else
				book = await global.query(`SELECT * FROM books WHERE alias='${ref}' LIMIT 1`);
			book = book[0];
		}
		if (!book)
			throw new ReferenceError(`Not found: Book ${ref}`);
		return new Book(book);
	}

}

/**
 * @type {Library} The library in the app
 */
class Library {

	/** @type {Library} @package */ static _singleton = new Library();

	/** @type {boolean} @package */ _initialized = false;
	/** @type {Book[]} @package */ _books;
	/** @type {Grade[]} @package */ _grades;
	/** @type {Grader[]} @package */ _graders;

	constructor() {
		if (!Library._singleton)
			Library._singleton = this;
	}

	/**
	 * @param {number|string} ref 
	 * @returns {Book}
	 */
	findBook(ref) {
		return this._books.find(function (book) {
			return (book.alias === ref || book.id === ref);
		});
	}

	/**
	 * @param {number} id 
	 * @returns {Grade}
	 */
	findGrade(id) {
		return this._grades.find(function (grade) {
			return (grade.id === id);
		});
	}

	/**
	 * @param {number} id 
	 * @returns {Grader}
	 */
	findGrader(id) {
		return this._graders.find(function (grader) {
			return (grader.id === id);
		});
	}

	/**
	 * @returns {Promise<Library>}
	 * @package
	 */
	static async init() {
		var library = Library._singleton;
		if (library._books === undefined) {
			global.library = library;
			library._books = global.books = await Library._allBooks();
			library._grades = global.grades = await Library._allGrades();
			library._graders = global.graders = await Library._allGraders();
			library._initialized = true;
			console.info(`initialized library`);
		}
		return library;
	}

	/**
	 * @returns {Library}
	 */
	static get instance() {
		if (Library._singleton && !Library._singleton._initialized)
			throw new ReferenceError(`Library is not initialized`);
		return Library._singleton;
	}

	/**
	 * @returns {Promise<Book[]>}
	 */
	static async _allBooks() {
		var rows = await global.query(`SELECT * FROM books ORDER BY id`);
		var books = [];
		for (var row of rows)
			books.push(new Book(row));
		return books;
	}

	/**
	 * @returns {Promise<Grade[]>}
	 */
	static async _allGrades() {
		var rows = await global.query(`SELECT * FROM grades ORDER BY id`);
		var grades = [];
		for (var row of rows)
			grades.push(new Grade(row));
		return grades;
	}

	/**
	 * @returns {Promise<Grader[]>}
	 */
	static async _allGraders() {
		var rows = await global.query(`SELECT * FROM graders ORDER BY id`);
		var graders = [];
		for (var row of rows)
			graders.push(new Grader(row));
		return graders;
	}

}

/**
 * @type {Grade} Grade of a hadith in the library
 */
class Grade {

	/** @type {number} */ id;

	/**
	 * @param {*} record 
	 */
	constructor(record) {
		if (record === undefined)
			record = {};
		for (var k in record)
			this[k] = record[k];
	}

	/**
	 * @param {number} id 
	 * @returns {Promise<Grade>}
	 */
	static async fromId(id) {
		if (id === undefined)
			throw new ReferenceError(`Not found: Grade Id ${id}`);
		var grade = null;
		if (global.library !== undefined)
			grade = global.library.findGrade(id);
		else
			grade = await global.query(`SELECT * FROM grades WHERE id=${id} LIMIT 1`);
		if (!grade)
			throw new ReferenceError(`Not found: Grade Id ${id}`);
		return new Grade(grade);
	}

}

/**
 * @type {Grader} Grader of a hadith in the library
 */
class Grader {

	/** @type {number} */ id;

	/**
	 * @param {*} record 
	 */
	constructor(record) {
		if (record === undefined)
			record = {};
		for (var k in record)
			this[k] = record[k];
	}

	/**
	 * @param {number} id 
	 * @returns {Promise<Grader>}
	 */
	static async fromId(id) {
		if (id === undefined)
			throw new ReferenceError(`Not found: Grader Id ${id}`);
		var grader = null;
		if (global.library !== undefined)
			grader = global.library.findGrader(id);
		else
			grader = await global.query(`SELECT * FROM graders WHERE id=${id} LIMIT 1`);
		if (!grader)
			throw new ReferenceError(`Not found: Grader Id ${id}`);
		return new Grader(grader);
	}

}

/**
 * @param {Heading} h
 * @private
 */
function normalizeHeadingAttributes(h) {
	normalizeOneHeadingAttribute(h, 'id');
	normalizeOneHeadingAttribute(h, 'title_en');
	normalizeOneHeadingAttribute(h, 'title');
	normalizeOneHeadingAttribute(h, 'intro_en');
	normalizeOneHeadingAttribute(h, 'intro');
	normalizeOneHeadingAttribute(h, 'start');
	normalizeOneHeadingAttribute(h, 'count');
}

/**
 * @param {Heading} h 
 * @param {string} attr
 * @private
 */
function normalizeOneHeadingAttribute(h, attr) {
	h[attr] = h[`h${h.level}_${attr}`];
}

module.exports = {
	Record,
	Item,
	Heading,
	Subsection,
	Section,
	Chapter,
	Library,
	Book,
	Grade,
	Grader
};