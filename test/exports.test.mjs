import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const entry of ['', '/countries', '/currency', '/time', '/tax', '/laws']) {
  test(`ESM and CommonJS export parity: glocon${entry}`, async () => {
    const esm = await import(`glocon${entry}`);
    const cjs = require(`glocon${entry}`);
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    assert.ok(Object.keys(esm).length > 0);
  });
}
