'use strict';

// Opt in against the configured database. Uses only uniquely named disposable
// fixtures; no application records or production routines are modified.
const mysql = require('mysql');
const { promisify } = require('util');
const { connectionSettings } = require('../bin/initializeHadithAttributions');
const { definition } = require('../bin/utils/install-atomic-virtual-snapshot');
const suite = process.env.HADITHDB_MYSQL_INTEGRATION === '1' ? describe : describe.skip;

suite('atomic virtual snapshot (MySQL concurrency and rollback)', () => {
  const prefix = `snapshot_test_${process.pid}_${Date.now()}`;
  const source = `${prefix}_source`, target = `${prefix}_target`, routine = `${prefix}_refresh`;
  let writer, reader, q, r;
  beforeAll(async () => {
    writer = mysql.createConnection(connectionSettings());
    reader = mysql.createConnection(connectionSettings());
    q = promisify(writer.query).bind(writer);
    r = promisify(reader.query).bind(reader);
    await q(`CREATE TABLE ${source} (id INT, book_id INT, body VARCHAR(20)) ENGINE=InnoDB`);
    await q(`CREATE TABLE ${target} (id INT PRIMARY KEY, book_id INT, body VARCHAR(20)) ENGINE=InnoDB`);
    await q(`CREATE TRIGGER ${prefix}_delay BEFORE INSERT ON ${target} FOR EACH ROW DO SLEEP(0.2)`);
    await q(definition.replaceAll('refresh_v_hadiths_virtual_snapshot', routine)
      .replaceAll('v_hadiths_virtual_snapshot_refresh', `${prefix}_lock`)
      .replaceAll('v_hadiths_virtual_snapshot', target).replaceAll('v_hadiths_virtual', source));
  });
  afterAll(async () => {
    try {
      for (const sql of [`DROP PROCEDURE IF EXISTS ${routine}`, `DROP TABLE IF EXISTS ${target}`, `DROP TABLE IF EXISTS ${source}`])
        await q(sql);
    } finally {
      writer?.destroy();
      reader?.destroy();
    }
  });
  beforeEach(async () => {
    await q(`DELETE FROM ${target}`);
    await q(`DELETE FROM ${source}`);
    await q(`INSERT INTO ${target} VALUES (1,61,'before edit'),(2,61,'unchanged')`);
    await q(`INSERT INTO ${source} VALUES (1,61,'after edit'),(2,61,'unchanged')`);
  });
  test.each(['61', 'NULL'])('readers never see missing rows during refresh(%s)', async bookId => {
    const samples = [];
    let done = false;
    const refresh = q(`CALL ${routine}(${bookId})`).finally(() => { done = true; });
    while (!done) {
      samples.push(await r(`SELECT id,body FROM ${target} ORDER BY id`));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await refresh;
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every(rows => rows.length === 2)).toBe(true);
    expect(samples.some(rows => rows[0].body === 'before edit')).toBe(true);
    expect((await r(`SELECT body FROM ${target} WHERE id=1`))[0].body).toBe('after edit');
  });
  test.each(['61', 'NULL'])('failed refresh(%s) preserves the previous complete snapshot', async bookId => {
    await q(`INSERT INTO ${source} VALUES (1,61,'duplicate')`);
    await expect(q(`CALL ${routine}(${bookId})`)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    expect(await r(`SELECT body FROM ${target} ORDER BY id`)).toEqual([{ body: 'before edit' }, { body: 'unchanged' }]);
  });
});
