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
  assert.equal(p.version, '0.2.0');
  assert.equal(p.license, 'MIT');
  assert.equal(p.author.name, 'Appsotech Limited');
  assert.ok(p.description.length > 20, 'description must be substantive');
});
