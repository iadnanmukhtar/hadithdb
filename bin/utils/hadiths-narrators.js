#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const crypto = require('crypto');
const util = require('util');
const DEFAULT_CHANGE_NAME = 'hadiths_narrators_split';
const options = readOptions(process.argv.slice(2));
require('../../lib/Globals');
const MySQL = require('mysql');
const { Library } = require('../../lib/Model');

(async () => {
    global.library = await Library.init();
    if (options.undoChangeId) {
        await undoChange(options.undoChangeId, options.appliedBy);
        return;
    }

    var resolvedBookId = await resolveBookId(options);
    var changeId = options.changeId || crypto.randomUUID();

    console.log('Processing: split hadith chain and body');
    console.log(`Change id: ${changeId}`);
    console.log(`Change name: ${options.changeName}`);
    if (options.fromNum0 !== null)
        console.log(`Starting from hadith number ${options.fromNum0}`);
    var rows = await getRows(resolvedBookId, options);
    var changed = 0;
    var skipped = 0;
    var failed = 0;
    for (var row of rows) {
        var ref = row.ref || `${row.bookId}:${row.num}`;
        try {
            var split = splitHadith(row);
            if (!split) {
                skipped++;
                console.log(`Skipped hadith ${ref} (no split change)`);
                continue;
            }

            if (options.dryRun) {
                console.log(`Would update hadith ${ref}`);
                changed++;
                continue;
            }

            await applyHadithChange(row, split, {
                changeId: changeId,
                changeName: options.changeName,
                appliedBy: options.appliedBy
            });
            changed++;
            console.log(`Updated hadith ${ref}`);
        } catch (err) {
            failed++;
            console.error(`ERROR ${ref}: ${err.message}`);
        }
    }
    console.log(
        `${options.dryRun ? 'Would update' : 'Updated'} ${changed} hadith(s), ` +
        `skipped ${skipped}, failed ${failed}.`
    );
    if (failed > 0)
        process.exitCode = 1;
})().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
}).finally(() => {
    if (global.dbPool)
        global.dbPool.end();
});

async function getRows(bookId, options) {
    var where = [];
    if (bookId !== null) {
        console.log(`Filtering by book id ${bookId}`);
        where.push(`h.bookId=${bookId}`);
    }
    if (options.fromNum0 !== null)
        where.push(`h.num0 >= ${options.fromNum0}`);
    var whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    if (bookId === null)
        return global.query(`
            SELECT h.*, CONCAT(b.alias, ':', h.num) AS ref
            FROM hadiths h
            LEFT JOIN books b ON b.id = h.bookId
            ${whereClause}
            ORDER BY h.bookId, h.h1, h.h2, h.h3, h.num0`);
    return global.query(`
        SELECT h.*, CONCAT(b.alias, ':', h.num) AS ref
        FROM hadiths h
        LEFT JOIN books b ON b.id = h.bookId
        ${whereClause}
        ORDER BY h.h1, h.h2, h.h3, h.num0`);
}

async function applyHadithChange(row, split, change) {
    await withTransaction(async (db) => {
        await db.query(
            `INSERT INTO hadiths_change_log ` +
            `(change_id, change_name, table_name, row_id, ref, old_chain, old_body, new_chain, new_body, applied_by) ` +
            `VALUES (` +
            `${MySQL.escape(change.changeId)}, ` +
            `${MySQL.escape(change.changeName)}, ` +
            `'hadiths', ` +
            `${row.id}, ` +
            `${MySQL.escape(row.ref)}, ` +
            `${MySQL.escape(row.chain)}, ` +
            `${MySQL.escape(row.body)}, ` +
            `${MySQL.escape(split.chain)}, ` +
            `${MySQL.escape(split.body)}, ` +
            `${MySQL.escape(change.appliedBy)}` +
            `)`
        );
        var result = await db.query(
            `UPDATE hadiths SET ` +
            `chain=${MySQL.escape(split.chain)}, ` +
            `body=${MySQL.escape(split.body)}, ` +
            `lastfixed=CURRENT_TIMESTAMP() ` +
            `WHERE id=${row.id} ` +
            `AND chain=${MySQL.escape(row.chain)} ` +
            `AND body=${MySQL.escape(row.body)}`
        );
        if (result.affectedRows !== 1)
            throw new Error(`Hadith changed before update could be applied: ${row.ref || row.id}`);
    });
}

async function undoChange(changeId, rolledBackBy) {
    var rows = await global.query(
        `SELECT * FROM hadiths_change_log ` +
        `WHERE change_id=${MySQL.escape(changeId)} ` +
        `AND table_name='hadiths' ` +
        `AND rolled_back_at IS NULL ` +
        `ORDER BY row_id`
    );
    if (rows.length < 1)
        throw new Error(`No unapplied rollback rows found for change id ${changeId}`);

    var restored = 0;
    await withTransaction(async (db) => {
        for (var row of rows) {
            var update = await db.query(
                `UPDATE hadiths SET ` +
                `chain=${MySQL.escape(row.old_chain)}, ` +
                `body=${MySQL.escape(row.old_body)}, ` +
                `lastfixed=CURRENT_TIMESTAMP() ` +
                `WHERE id=${row.row_id} ` +
                `AND chain=${MySQL.escape(row.new_chain)} ` +
                `AND body=${MySQL.escape(row.new_body)}`
            );
            if (update.affectedRows !== 1)
                throw new Error(`Hadith no longer matches logged new value: ${row.ref || row.row_id}`);

            var result = await db.query(
                `UPDATE hadiths_change_log SET ` +
                `rolled_back_at=CURRENT_TIMESTAMP(), ` +
                `rolled_back_by=${MySQL.escape(rolledBackBy)} ` +
                `WHERE change_id=${MySQL.escape(changeId)} ` +
                `AND row_id=${row.row_id} ` +
                `AND rolled_back_at IS NULL`
            );
            restored += result.affectedRows || 0;
            console.log(`Restored ${row.ref || row.row_id}`);
        }
    });

    console.log(`Rolled back ${restored} hadith change(s) for ${changeId}.`);
}

async function withTransaction(fn) {
    var connection = await getConnection();
    var db = {
        query: util.promisify(connection.query).bind(connection),
        beginTransaction: util.promisify(connection.beginTransaction).bind(connection),
        commit: util.promisify(connection.commit).bind(connection),
        rollback: util.promisify(connection.rollback).bind(connection)
    };
    try {
        await db.beginTransaction();
        var result = await fn(db);
        await db.commit();
        return result;
    } catch (err) {
        try {
            await db.rollback();
        } catch (_rollbackErr) {
            // Preserve the original error.
        }
        throw err;
    } finally {
        connection.release();
    }
}

function getConnection() {
    return new Promise((resolve, reject) => {
        global.dbPool.getConnection((err, connection) => {
            if (err)
                reject(err);
            else
                resolve(connection);
        });
    });
}

function splitHadith(row) {
    var text = normalizeTextForSplit(row.text || [row.chain, row.body].filter(Boolean).join(' '));
    var textMarked = text + '';
    var bodyMarked = '';
    textMarked = textMarked.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
    textMarked = textMarked.replace(/و?(حدثنا|حدثني|حدثناه|حدثه|ثنا) /g, '~ ');
    textMarked = textMarked.replace(/و?(أخبرنا|أخبرناه|أخبرني|أخبره|آنا) /g, '~ ');
    textMarked = textMarked.replace(/و?(أنبأنا|أنبأناه|أنبأني|أنبأه|آنبأ) /g, '~ ');
    textMarked = textMarked.replace(/و?(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
    textMarked = textMarked.replace(/(عن) /g, '~ ');
    textMarked = textMarked.replace(/(يبلغ به) /g, '~~ ');
    textMarked = textMarked.replace(/(أنه|أن|أنها) /g, '~ ');
    textMarked = textMarked.replace(/(قال|قالت) /g, '~ ');
    textMarked = textMarked.replace(/\s+/g, ' ').trim();
    var chainDelims = textMarked.split(/~/);
    if (chainDelims) {
        var chainToksWordCount = [];
        for (var tok of chainDelims)
            chainToksWordCount.push(wordCount(tok));
        for (var j = 0; j < chainDelims.length; j++) {
            if (chainDelims[j].match(/(نبي|رسول)/)) {
                bodyMarked = chainDelims.slice(j).join('~ ');
                break;
            } else if (chainToksWordCount[j] > 7 && !chainDelims[j].match(/ (بن|ابن) /)) {
                bodyMarked = chainDelims.slice(j).join('~ ');
                break;
            }
        }
        if (bodyMarked == '')
            bodyMarked = chainDelims[chainDelims.length - 1];
    }
    if (bodyMarked == null)
        throw new Error(`Unable to split hadith ${row.ref || `${row.bookId}:${row.num}`}`);
    bodyMarked = bodyMarked.replace(/\s+/g, ' ').trim();

    var textToks = text.split(/ /);
    var textMarkedToks = textMarked.split(/ /);
    var bodyMarkedToks = bodyMarked.split(/ /);
    var chain = row.chain || '';
    var body = text;
    if (textToks && bodyMarkedToks && textToks.length != bodyMarkedToks.length) {
        var diff = textToks.length - bodyMarkedToks.length;
        for (var j = (diff - 1); j >= 0; j--) {
            if (textMarkedToks[j].endsWith('~'))
                diff--;
            else
                break;
        }
        chain = textToks.slice(0, diff).join(' ').trim();
        body = textToks.slice(diff).join(' ').trim();
    }
    chain = global.utils.replaceRA(global.utils.replacePBUH(chain)).replace(/\s+/g, ' ').trim();
    body = global.utils.replaceRA(global.utils.replacePBUH(body)).replace(/\s+/g, ' ').trim();

    if (chain === (row.chain || '') && body === (row.body || ''))
        return null;
    return {
        chain: chain,
        body: body
    };
}

function normalizeTextForSplit(text) {
    text = text || '';
    text = text.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
    text = global.utils.replaceRA(text).replace(/ؓ/g, '');
    return text.replace(/\s+/g, ' ').trim();
}

async function resolveBookId(options) {
    if (options.bookId !== null)
        return options.bookId;
    if (options.book === null)
        return null;

    var book = global.library.findBook(options.book);
    if (!book)
        throw new ReferenceError(`Not found: Book ${options.book}`);
    console.log(`Resolved book ${book.alias} to id ${book.id}`);
    return book.id;
}

function readOptions(argv) {
    try {
        return parseArgs(argv);
    } catch (err) {
        console.error(`Error: ${err.message}\n`);
        printUsage();
        process.exit(1);
    }
}

function parseArgs(argv) {
    var options = {
        bookId: null,
        book: null,
        fromNum0: null,
        changeId: null,
        changeName: DEFAULT_CHANGE_NAME,
        appliedBy: process.env.USER || 'script',
        undoChangeId: null,
        dryRun: false
    };
    var positional = [];
    for (var i = 0; i < argv.length; i++) {
        var arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--book-id') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a book id`);
            options.bookId = parseBookId(argv[i], arg);
        } else if (arg === '--book' || arg === '--book-alias' || arg === '-b') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a book id or alias`);
            options.book = argv[i];
        } else if (arg === '--from' || arg === '--from-num0' || arg === '--start' || arg === '-f') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a numeric hadith number`);
            options.fromNum0 = parseNum0(argv[i], arg);
        } else if (arg === '--change-id') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a change id`);
            options.changeId = parseChangeId(argv[i], arg);
        } else if (arg === '--change-name') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a change name`);
            options.changeName = parseChangeName(argv[i]);
        } else if (arg === '--applied-by') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a user or label`);
            options.appliedBy = argv[i];
        } else if (arg === '--undo') {
            i++;
            if (!argv[i])
                throw new Error(`${arg} requires a change id`);
            options.undoChangeId = parseChangeId(argv[i], arg);
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg.startsWith('-')) {
            throw new Error(`Unknown argument: ${arg}`);
        } else {
            positional.push(arg);
        }
    }
    if (positional.length > 1)
        throw new Error(`Too many positional arguments: ${positional.join(' ')}`);
    if (positional.length === 1)
        options.book = positional[0];
    if (options.bookId !== null && options.book !== null)
        throw new Error(`Use either --book-id or --book, not both`);
    if (options.undoChangeId && (options.bookId !== null || options.book !== null || options.fromNum0 !== null || options.changeId !== null || options.dryRun))
        throw new Error(`Use --undo by itself, optionally with --applied-by`);
    return options;
}

function parseBookId(value, arg) {
    var bookId = parseInt(value, 10);
    if (!Number.isInteger(bookId) || bookId < 0 || `${bookId}` !== `${value}`.trim())
        throw new Error(`${arg} requires a non-negative integer book id`);
    return bookId;
}

function parseNum0(value, arg) {
    var num0 = Number(value);
    if (!Number.isFinite(num0))
        throw new Error(`${arg} requires a numeric hadith number`);
    return num0;
}

function parseChangeId(value, arg) {
    value = `${value}`.trim();
    if (!/^[A-Za-z0-9_-]{1,36}$/.test(value))
        throw new Error(`${arg} has invalid characters`);
    return value;
}

function parseChangeName(value) {
    value = `${value}`.trim();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(value))
        throw new Error(`Invalid change name: ${value}`);
    return value;
}

function printUsage() {
    console.log(
        'Usage:\n' +
        '  node bin/utils/hadiths-narrators.js\n' +
        '  node bin/utils/hadiths-narrators.js --book-id 16\n' +
        '  node bin/utils/hadiths-narrators.js --book bazzar\n' +
        '  node bin/utils/hadiths-narrators.js --book-alias bazzar\n' +
        '  node bin/utils/hadiths-narrators.js --book bazzar --from 4454\n' +
        '  node bin/utils/hadiths-narrators.js --book bazzar --change-name fix_bazzar_split --dry-run\n' +
        '  node bin/utils/hadiths-narrators.js --undo <change-id>\n' +
        '\n' +
        'No arguments processes every hadith. --book accepts either a book id or alias.\n' +
        '--change-id can be supplied for a stable rollback id; otherwise a UUID is generated.\n' +
        '--applied-by overrides the audit label used for apply or undo.'
    );
}

function wordCount(s) {
    return s.split(' ').length;
}
