'use strict';
// Stable virtual-entry ownership, independent of the currently selected original.
// Separate rows per entry allow two virtual references to converge on one hadith
// and later diverge without stealing or deleting each other's commentary.
const triggers = {
  virtual_sharh_after_update: `CREATE TRIGGER virtual_sharh_after_update AFTER UPDATE ON hadiths_virtual FOR EACH ROW
BEGIN
  IF NOT (OLD.hadithId <=> NEW.hadithId) THEN
    IF NEW.hadithId IS NULL AND EXISTS (SELECT 1 FROM hdith_virtual_sharh_links WHERE virtual_id=NEW.id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='A commentary-linked virtual entry must select an original hadith';
    END IF;
    UPDATE hdith_hadith_sharh hs JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id
      SET hs.hadith_id=NEW.hadithId WHERE vl.virtual_id=NEW.id;
  END IF;
END`,
  virtual_sharh_before_delete: `CREATE TRIGGER virtual_sharh_before_delete BEFORE DELETE ON hadiths_virtual FOR EACH ROW
BEGIN
  DELETE hs FROM hdith_hadith_sharh hs JOIN hdith_virtual_sharh_links vl ON vl.sharh_id=hs.id WHERE vl.virtual_id=OLD.id;
END`
};
async function ensureSchema(query) {
  // Entry numbers belong to their source; independent commentaries can coexist.
  const indexes = await query('SHOW INDEX FROM hdith_hadith_sharh');
  const identity = indexes.filter(i=>i.Key_name === 'hdith_sharh_entry').sort((a,b)=>a.Seq_in_index-b.Seq_in_index).map(i=>i.Column_name).join(',');
  if (identity === 'hadith_id,source_entry_id')
    await query('ALTER TABLE hdith_hadith_sharh DROP INDEX hdith_sharh_entry, ADD UNIQUE KEY hdith_sharh_entry (hadith_id,source_id,source_entry_id)');
  else if (identity !== 'hadith_id,source_id,source_entry_id')
    throw Error('Unexpected commentary identity index');
  await query(`CREATE TABLE IF NOT EXISTS hdith_virtual_sharh_links (
    sharh_id BIGINT NOT NULL PRIMARY KEY,
    virtual_id INT NOT NULL,
    source_number INT NOT NULL,
    KEY virtual_sharh_entry (virtual_id),
    CONSTRAINT virtual_sharh_row_fk FOREIGN KEY (sharh_id) REFERENCES hdith_hadith_sharh(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT virtual_sharh_virtual_fk FOREIGN KEY (virtual_id) REFERENCES hadiths_virtual(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const existing = await query("SHOW TRIGGERS WHERE `Table`='hadiths_virtual'");
  for (const [name,sql] of Object.entries(triggers)) {
    const old = existing.find(t=>t.Trigger === name);
    if (!old) await query(sql);
    else if (old.Statement.replace(/\s+/g,' ').trim() !== sql.slice(sql.indexOf('BEGIN')).replace(/\s+/g,' ').trim())
      throw Error(`Unexpected existing trigger: ${name}`);
  }
}
// Call inside the importing transaction after inserting the commentary rows.
async function linkRows(query, entries) {
  if (!entries.length) return;
  const existing = await query('SELECT sharh_id,virtual_id,source_number FROM hdith_virtual_sharh_links WHERE sharh_id IN (?)', [entries.map(e=>e.sharhId)]);
  for (const row of existing) {
    const entry = entries.find(e=>e.sharhId === row.sharh_id);
    if (entry.virtualId !== row.virtual_id || entry.number !== row.source_number)
      throw Error(`Conflicting virtual commentary ownership: ${row.sharh_id}`);
  }
  const pending = entries.filter(e=>!existing.some(r=>r.sharh_id === e.sharhId));
  for (let i=0;i<pending.length;i+=500) {
    await query('INSERT INTO hdith_virtual_sharh_links (sharh_id,virtual_id,source_number) VALUES ?',
      [pending.slice(i,i+500).map(e=>[e.sharhId,e.virtualId,e.number])]);
  }
}
module.exports = { ensureSchema, triggers, linkRows };
