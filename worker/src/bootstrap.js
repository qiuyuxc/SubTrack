/**
 * Creates the D1 tables on first use and adds the columns introduced after the
 * first release, so deploying the worker is the only setup step.
 *
 * Every statement is idempotent and a database that is already up to date is
 * left untouched. Statements run individually rather than in one transaction,
 * so a database that only partially matches the schema (say, one someone built
 * by hand from an older migration) still gains whatever it is missing. The work
 * happens once per D1 binding per isolate.
 */
import { COLUMN_UPGRADES, SCHEMA_STATEMENTS } from './schema.js';

const ready = new WeakMap();

/** `IF NOT EXISTS` covers the common case; these are the errors left over. */
function isAlreadyApplied(error) {
  return /already exists|duplicate column name/i.test(String(error?.message ?? error));
}

async function apply(db, sql) {
  try {
    await db.prepare(sql).run();
  } catch (error) {
    if (!isAlreadyApplied(error)) throw error;
  }
}

async function build(db) {
  for (const sql of SCHEMA_STATEMENTS) await apply(db, sql);
  for (const sql of COLUMN_UPGRADES) await apply(db, sql);
}

/**
 * Resolves once the schema is in place. Concurrent requests share one promise,
 * and a failure is forgotten rather than cached so the next request retries.
 */
export function ensureSchema(db) {
  let pending = ready.get(db);
  if (pending) return pending;
  pending = build(db).catch((error) => {
    ready.delete(db);
    throw error;
  });
  ready.set(db, pending);
  return pending;
}
