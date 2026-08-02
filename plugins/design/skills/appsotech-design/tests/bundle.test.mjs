import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBundle, splitFrontmatter, ORDER } from '../scripts/bundle.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'bundle.mjs');
const ROOT = join(import.meta.dirname, '..');
const DIST = join(import.meta.dirname, '..', '..', '..', '..', '..', 'dist', 'appsotech-design.md');

function run(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('every reference on disk is in the bundle order', () => {
  // A reference added later and forgotten here would be silently missing from
  // the portable copy while the directory install still had it — the worst
  // kind of drift, because both look complete on their own.
  const onDisk = readdirSync(join(ROOT, 'references')).sort();
  assert.deepEqual([...ORDER].sort(), onDisk);
});

test('the bundle carries the skill and every reference', () => {
  const bundle = buildBundle();
  for (const f of ORDER) {
    assert.ok(bundle.includes(`<!-- references/${f} -->`), `missing ${f}`);
    // A marker with no content behind it would satisfy the check above.
    const body = readFileSync(join(ROOT, 'references', f), 'utf8');
    const distinctive = body.split('\n').find((l) => l.length > 60 && !l.startsWith('#'));
    assert.ok(bundle.includes(distinctive.trim().slice(0, 50)), `${f} marker but no body`);
  }
});

test('it keeps the frontmatter, so it drops in as a SKILL.md unchanged', () => {
  const { frontmatter } = splitFrontmatter(buildBundle());
  assert.ok(frontmatter, 'no frontmatter — it would not register as a skill');
  assert.match(frontmatter, /^name: appsotech-design$/m);
  assert.match(frontmatter, /Stack-agnostic/);
});

test('exactly one h1 survives, so the document has a single title', () => {
  // References are demoted a level; two competing h1s read as two documents
  // stapled together.
  const h1s = buildBundle().split('\n').filter((l) => /^# /.test(l));
  assert.equal(h1s.length, 1, h1s.join(' | '));
});

test('it says plainly that the scripts are absent', () => {
  // The bundle is a degraded copy. Shipping it without saying so is how a
  // by-hand checklist gets mistaken for a mechanical gate.
  const bundle = buildBundle();
  assert.match(bundle, /scripts are not here and cannot be/);
  assert.match(bundle, /by-hand check/);
  for (const s of ['gate.mjs', 'contrast.mjs', 'responsive-check.mjs']) {
    assert.ok(bundle.includes(s), `does not name ${s} as missing`);
  }
});

test('it points at the directory install for the full skill', () => {
  assert.match(buildBundle(), /cp -r appsotech-skills\/plugins\/design\/skills\/appsotech-design/);
});

test('the reference map lets a cross-reference be followed', () => {
  // The prose says things like "see motion.md". In one file that is a dead
  // pointer unless something maps the name to a section.
  const bundle = buildBundle();
  assert.match(bundle, /## What is in this file/);
  for (const f of ORDER) assert.ok(bundle.includes(`\`references/${f}\``), f);
});

// --- the committed copy stays current ---------------------------------------

test('the committed bundle matches the skill it was generated from', () => {
  // The tokens.dart lesson: a generated file nobody regenerates is a stale
  // file that looks authoritative. This is the check that makes the committed
  // dist/ trustworthy rather than a snapshot of whenever someone last ran it.
  assert.equal(readFileSync(DIST, 'utf8').trimEnd(), buildBundle().trimEnd(),
    'dist/appsotech-design.md is stale — regenerate with scripts/bundle.mjs');
});

// --- cli --------------------------------------------------------------------

test('--check fails once the bundle drifts, and passes when regenerated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const out = join(dir, 'b.md');
  assert.equal(run(['-o', out]).status, 0);
  assert.equal(run(['-o', out, '--check']).status, 0);

  writeFileSync(out, readFileSync(out, 'utf8').replace('Stack-agnostic', 'Stack-specific'));
  const res = run(['-o', out, '--check']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /drifted/);
  assert.match(res.stderr, /directory is the master/);
});

test('--check on a file that was never generated says so, not "drifted"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const res = run(['-o', join(dir, 'nope.md'), '--check']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /does not exist/);
});

test('a run without -o is refused rather than writing somewhere arbitrary', () => {
  assert.equal(run([]).status, 2);
});
