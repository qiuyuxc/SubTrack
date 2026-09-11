#!/usr/bin/env node
/**
 * Writes worker/schema.sql from the canonical schema in worker/src/schema.js,
 * so the file people may apply by hand matches what the worker creates at
 * runtime. `worker/test/smoke.mjs` fails if the two drift apart.
 *
 *   npm run schema
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL } from '../worker/src/schema.js';

const target = fileURLToPath(new URL('../worker/schema.sql', import.meta.url));
await writeFile(target, `${SCHEMA_SQL.trimEnd()}\n`, 'utf8');
console.log(`wrote ${target}`);
