/**
 * Minimal D1 adapter over node:sqlite so the worker can be exercised locally
 * without Miniflare. Implements exactly the surface `src/*.js` relies on:
 * prepare / bind / all / first / run / batch.
 */
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function createD1(sqlitePath = ':memory:') {
  const db = new DatabaseSync(sqlitePath);
  return {
    _sqlite: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}
