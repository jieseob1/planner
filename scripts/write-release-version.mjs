import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const revision = process.env.NOWLINE_RELEASE_SHA;
assert.match(revision || '', /^[a-f0-9]{40}$/);
writeFileSync('dist/version.json', JSON.stringify({ revision, builtAt: new Date().toISOString() }));
