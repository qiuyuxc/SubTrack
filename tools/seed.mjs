#!/usr/bin/env node
/** Writes demo subscriptions into the local SQLite database used by `npm start`. */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1 } from '../worker/test/d1-shim.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(root, '.data', 'subtrack.db');

await mkdir(join(root, '.data'), { recursive: true });
const db = createD1(DB_PATH);

for (const file of ['worker/schema.sql', 'worker/seed.sql']) {
  db._sqlite.exec(await readFile(join(root, file), 'utf8'));
}

const count = db._sqlite.prepare('SELECT COUNT(*) AS n FROM subscriptions').get();
const budget = db._sqlite.prepare("SELECT value FROM settings WHERE key = 'monthly_budget'").get();
console.log(`已写入演示数据：${count.n} 条订阅，月度预算 ${budget?.value ?? 0}`);
console.log(`数据库：${DB_PATH}`);
