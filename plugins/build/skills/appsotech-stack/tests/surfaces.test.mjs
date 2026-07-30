import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACES, SURFACE_KEYS, PORTED_SURFACES, surface,
  normaliseSelection, selectionWarnings,
} from '../scripts/lib/surfaces.mjs';

test('every surface declares the fields the scaffolder reads', () => {
  for (const s of SURFACES) {
    assert.equal(typeof s.key, 'string', `${s.key}: key`);
    assert.equal(typeof s.dir, 'string', `${s.key}: dir`);
    assert.equal(typeof s.kind, 'string', `${s.key}: kind`);
    assert.equal(typeof s.summary, 'string', `${s.key}: summary`);
    assert.ok(s.offset === null || Number.isInteger(s.offset), `${s.key}: offset`);
  }
});

test('surface keys are unique', () => {
  assert.equal(new Set(SURFACE_KEYS).size, SURFACE_KEYS.length);
});

test('port offsets are unique and contiguous from zero', () => {
  const offsets = PORTED_SURFACES.map((s) => s.offset).sort((a, b) => a - b);
  assert.deepEqual(offsets, [0, 1, 2, 3]);
});

test('the ported surfaces are exactly the four web surfaces', () => {
  assert.deepEqual(
    PORTED_SURFACES.map((s) => s.key),
    ['platform-web', 'tenant-web', 'webapp', 'admin-web'],
  );
});

test('offsets follow canonical apps/ order', () => {
  // The port block is assigned by offset and the docs table renders by array
  // order. If those two disagree, the table describes ports nobody is on.
  const ported = SURFACES.filter((s) => s.offset !== null);
  ported.forEach((s, i) => assert.equal(s.offset, i, `${s.key} out of order`));
});

test('only the webapp is served under a path prefix', () => {
  assert.match(surface('webapp').hostname, /\/app$/);
  assert.match(surface('backend').hostname, /\/v1$/);
  assert.equal(surface('mobile').hostname, null);
});

test('there is no gateway surface', () => {
  // A Caddy gateway does on-demand TLS, which requires owning :443 — and
  // Coolify's Traefik already owns it. Two public ingresses on one box either
  // fight for the port or leave one of them receiving nothing.
  assert.throws(() => surface('gateway'), /unknown surface/);
  assert.ok(!SURFACE_KEYS.includes('gateway'));
});

test('surface() rejects an unknown key with the valid list', () => {
  assert.throws(() => surface('frontend'), /unknown surface "frontend"/);
  assert.throws(() => surface('frontend'), /platform-web/);
});

test('normaliseSelection returns canonical order and de-duplicates', () => {
  assert.deepEqual(
    normaliseSelection(['backend', 'platform-web', 'backend', 'webapp']),
    ['platform-web', 'webapp', 'backend'],
  );
});

test('normaliseSelection rejects an empty or non-array selection', () => {
  assert.throws(() => normaliseSelection([]), /at least one surface/);
  assert.throws(() => normaliseSelection(null), /at least one surface/);
  assert.throws(() => normaliseSelection('backend'), /at least one surface/);
});

test('web surfaces without a backend are warned about', () => {
  const warnings = selectionWarnings(['platform-web']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /relative path/);
});

test('mobile without a backend is warned about for a different reason', () => {
  const warnings = selectionWarnings(['mobile']);
  assert.match(warnings.join(' '), /absolute API base URL/);
});

test('a webapp with no tenant-web is warned about', () => {
  const warnings = selectionWarnings(['backend', 'webapp']).join(' ');
  assert.match(warnings, /organisation host/);
});

test('a coherent selection produces no warnings', () => {
  assert.deepEqual(selectionWarnings(['backend', 'tenant-web', 'webapp']), []);
  assert.deepEqual(selectionWarnings(['backend']), []);
});
