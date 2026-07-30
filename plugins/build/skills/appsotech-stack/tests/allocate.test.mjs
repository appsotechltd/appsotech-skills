import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate, parseAllocations, nextWebBlock, nextApiPort, blockOf,
  validateSlug, portLocations, SUITE_WEB_BLOCK, SUITE_API_PORT,
} from '../scripts/lib/allocate.mjs';

test('a slug must be a bare DNS label', () => {
  assert.equal(validateSlug('primary'), 'primary');
  assert.equal(validateSlug('aitutor2'), 'aitutor2');
  // Hyphens are rejected because the slug is also a Go package path element.
  assert.throws(() => validateSlug('my-product'), /invalid product slug/);
  assert.throws(() => validateSlug('Primary'), /invalid product slug/);
  assert.throws(() => validateSlug('2fast'), /invalid product slug/);
  assert.throws(() => validateSlug(''), /invalid product slug/);
  assert.throws(() => validateSlug(undefined), /invalid product slug/);
});

test('reserved labels can never be a product slug', () => {
  for (const label of ['app', 'admin', 'api', 'www']) {
    assert.throws(() => validateSlug(label), /reserved label/);
  }
});

test('the suite block and API port are never handed to a product', () => {
  assert.notEqual(nextWebBlock([]), SUITE_WEB_BLOCK);
  assert.notEqual(nextApiPort([]), SUITE_API_PORT);
  // Even when nothing else is allocated and 3100 would otherwise be lowest.
  assert.equal(nextWebBlock([]), 3200);
  assert.equal(nextApiPort([]), 8080);
});

test('blockOf rounds a port down to its block of ten', () => {
  assert.equal(blockOf(3220), 3220);
  assert.equal(blockOf(3223), 3220);
  assert.equal(blockOf(3229), 3220);
  assert.equal(blockOf(3230), 3230);
});

test('the next free block skips every block already in use', () => {
  assert.equal(nextWebBlock([3200, 3210, 3220]), 3230);
  // A single port in a block reserves the whole block, not just that port.
  assert.equal(nextWebBlock([3203]), 3210);
  // Gaps are reused rather than always appending.
  assert.equal(nextWebBlock([3200, 3220]), 3210);
});

test('the next free API port skips those in use', () => {
  assert.equal(nextApiPort([8080, 8081, 8082]), 8083);
  assert.equal(nextApiPort([8080, 8082]), 8081);
});

test('ports come from the surface offset, not from counting selections', () => {
  // tenant-web (+1) is absent, but webapp must STILL land on +2. If ports were
  // assigned by position in the selection, webapp would take +1 here and move
  // the day tenant-web is added — silently wrong in a Dockerfile.
  const a = allocate({ slug: 'demo', surfaces: ['platform-web', 'webapp', 'backend'] });
  assert.equal(a.ports['platform-web'], a.block + 0);
  assert.equal(a.ports['webapp'], a.block + 2);
  assert.equal(a.ports['tenant-web'], undefined);
});

test('adding the skipped surface later does not move the others', () => {
  const before = allocate({ slug: 'demo', surfaces: ['platform-web', 'webapp'] });
  const after = allocate({
    slug: 'demo',
    surfaces: ['platform-web', 'tenant-web', 'webapp'],
    used: { webBlock: before.block },
  });
  assert.equal(after.ports['platform-web'], before.ports['platform-web']);
  assert.equal(after.ports['webapp'], before.ports['webapp']);
  assert.equal(after.ports['tenant-web'], before.block + 1);
});

test('an API port is allocated only when backend is selected', () => {
  assert.equal(allocate({ slug: 'demo', surfaces: ['webapp'] }).apiPort, null);
  assert.equal(typeof allocate({ slug: 'demo', surfaces: ['backend'] }).apiPort, 'number');
});

test('the database name is derived from the prefix and slug', () => {
  assert.equal(allocate({ slug: 'demo', surfaces: ['backend'] }).database, 'akadesk_demo');
  assert.equal(
    allocate({ slug: 'demo', surfaces: ['backend'], dbPrefix: 'npf' }).database,
    'npf_demo',
  );
  assert.equal(
    allocate({ slug: 'demo', surfaces: ['backend'], dbName: 'legacy_name' }).database,
    'legacy_name',
  );
});

test('a database name already in use is refused rather than shared', () => {
  assert.throws(
    () => allocate({
      slug: 'demo',
      surfaces: ['backend'],
      used: { databases: ['akadesk_demo'] },
    }),
    /already allocated/,
  );
});

test('surfaces come back in canonical order whatever order they went in', () => {
  const a = allocate({ slug: 'demo', surfaces: ['backend', 'webapp', 'platform-web'] });
  assert.deepEqual(a.surfaces, ['platform-web', 'webapp', 'backend']);
});

test('an unknown surface is rejected loudly', () => {
  assert.throws(() => allocate({ slug: 'demo', surfaces: ['frontend'] }), /unknown surface/);
});

test('an empty selection is rejected', () => {
  assert.throws(() => allocate({ slug: 'demo', surfaces: [] }), /at least one surface/);
});

test('parseAllocations reads the real table despite footnotes and em-dashes', () => {
  // This is the shape the live docs/ports-and-databases.md actually has: a
  // footnote marker after a port, em-dashes for absent surfaces, and a prose
  // paragraph spliced into the middle of the database table. A parser that
  // required well-formed rows returned nothing here and handed out a
  // colliding block.
  const md = `
| Product | platform-web | tenant-web | webapp | admin-web | API |
|---|---|---|---|---|---|
| **platform** (akadesk.com) | 3100 | — | — | 3101 | 8100 *(plan 2)* |
| **aitutor** | 3200 | 3201 | 3202 | 3203 | 8080 |
| **primary** | 3220 | 3221 | 3222 | 3223 | 8081 |

| aitutor | \`akadesk_aitutor\` | ... |

Some prose that wandered into the table.

| primary | \`akadesk_primary\` | ... |
`;
  const used = parseAllocations(md);
  assert.deepEqual(used.webBlocks, [3100, 3200, 3220]);
  assert.deepEqual(used.apiPorts, [8080, 8081, 8100]);
  assert.ok(used.databases.includes('akadesk_aitutor'));
  assert.ok(used.databases.includes('akadesk_primary'));

  // And the allocation that follows from it avoids every one of them.
  const a = allocate({ slug: 'newthing', surfaces: ['platform-web', 'backend'], used });
  assert.equal(a.block, 3210);
  assert.equal(a.apiPort, 8082);
});

test('parseAllocations tolerates an empty or absent document', () => {
  assert.deepEqual(parseAllocations('').webBlocks, []);
  assert.deepEqual(parseAllocations(undefined).apiPorts, []);
  assert.deepEqual(parseAllocations(null).databases, []);
});

test('the Go API port location names SERVER_ADDR, not PORT alone', () => {
  const locations = portLocations('backend').join(' ');
  assert.match(locations, /SERVER_ADDR/);
  // The whole point of the note: PORT alone does not move the listener.
  assert.match(locations, /NOT `PORT`/);
});

test('port locations are surface-kind specific', () => {
  assert.match(portLocations('platform-web').join(' '), /package\.json/);
  assert.match(portLocations('webapp').join(' '), /vite\.config\.ts/);
  // Flutter and the gateway have no per-product port at all.
  assert.deepEqual(portLocations('mobile'), []);
  assert.deepEqual(portLocations('gateway'), []);
});
