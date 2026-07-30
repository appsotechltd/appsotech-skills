import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('marketplace.json declares the audit plugin at its real path', () => {
  const m = read('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'appsotech');
  assert.equal(m.owner.name, 'Appsotech Limited');
  const plugin = m.plugins.find((p) => p.name === 'audit');
  assert.ok(plugin, 'audit plugin must be listed');
  assert.equal(plugin.source, './plugins/audit');
});

test('plugin.json is valid and versioned', () => {
  const p = read('plugins/audit/.claude-plugin/plugin.json');
  assert.equal(p.name, 'audit');
  // Semver shape, not a pinned literal. Asserting the exact version meant
  // every release edited a test to say the release happened, which tests
  // nothing — the invariant worth holding is the one below.
  assert.match(p.version, /^\d+\.\d+\.\d+$/, 'version must be semver');
  assert.equal(p.license, 'MIT');
  assert.equal(p.author.name, 'Appsotech Limited');
  assert.ok(p.description.length > 20, 'description must be substantive');
});

test('plugin.json and the marketplace entry declare the same version', () => {
  // These two are edited by hand in separate files and drift silently: the
  // marketplace is what a user installs from, plugin.json is what they get.
  const p = read('plugins/audit/.claude-plugin/plugin.json');
  const m = read('.claude-plugin/marketplace.json');
  const entry = m.plugins.find((x) => x.name === 'audit');
  assert.equal(entry.version, p.version, 'marketplace and plugin.json versions must match');
});
