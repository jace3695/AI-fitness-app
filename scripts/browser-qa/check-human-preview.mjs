import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { humanPreviewPath } from './human-preview-path.mjs';

const kind = process.argv[2];
const path = humanPreviewPath(kind);
const expected = JSON.parse(readFileSync(new URL('./human-preview-sha256.json', import.meta.url)))[kind];
assert.match(expected, /^[0-9a-f]{64}$/);
assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected,
  'Current preview differs from the reviewed build snapshot; preserve archived previews and update this digest with source changes.');
console.log(`PASS ${kind}: complete current preview SHA-256 matches reviewed build`);
