import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalPalette, fingerprint, readFingerprint, writeFingerprint, verdict, MARKER,
} from '../scripts/freeze-check.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'freeze-check.mjs');

const CSS = `:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 217 91% 60%;
}
.dark { --background: 222 47% 4%; --foreground: 210 40% 98%; }`;

function project(css = CSS, md = '# Design system\n\nSlate on white.\n') {
  const dir = mkdtempSync(join(tmpdir(), 'freeze-'));
  mkdirSync(join(dir, 'design'), { recursive: true });
  const cssPath = join(dir, 'design', 'tokens.css');
  const mdPath = join(dir, 'design', 'design-system.md');
  writeFileSync(cssPath, css);
  writeFileSync(mdPath, md);
  return { dir, cssPath, mdPath };
}
function run(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// --- what counts as a change ------------------------------------------------

test('reordering and reformatting is not a restyle', () => {
  // A fingerprint that moved when someone ran a formatter would be noise, and
  // a noisy gate is one people disable.
  const a = fingerprint(CSS);
  const reordered = `:root {
  --primary:217 91% 60%;

  --foreground:   222 47% 11%;
  --background: 0 0% 100%;
}
.dark {
  --foreground: 210 40% 98%;
  --background: 222 47% 4%;
}`;
  assert.equal(fingerprint(reordered), a);
});

test('a changed value is a changed palette', () => {
  assert.notEqual(fingerprint(CSS), fingerprint(CSS.replace('217 91% 60%', '340 82% 52%')));
});

test('a new token changes the palette, and a removed one does too', () => {
  const added = CSS.replace('--primary:', '--accent: 12 80% 50%;\n  --primary:');
  assert.notEqual(fingerprint(CSS), fingerprint(added));
  const removed = CSS.replace('  --primary: 217 91% 60%;\n', '');
  assert.notEqual(fingerprint(CSS), fingerprint(removed));
});

test('the dark block is part of the fingerprint', () => {
  // A dark-only restyle is still a restyle, and flattening the blocks would
  // hide it — the same failure the contrast gate guards against.
  const darkOnly = CSS.replace('222 47% 4%', '0 0% 5%');
  assert.notEqual(fingerprint(CSS), fingerprint(darkOnly));
});

test('a comment in the stylesheet does not move the fingerprint', () => {
  const commented = CSS.replace(':root {', '/* the frozen palette */\n:root {');
  assert.equal(fingerprint(commented), fingerprint(CSS));
});

test('canonical form is deterministic and sorted', () => {
  const c = canonicalPalette(CSS);
  assert.equal(c, canonicalPalette(CSS));
  assert.match(c, /^\.dark\{/, 'blocks sort before :root');
});

test('a stylesheet with no tokens has no fingerprint', () => {
  assert.equal(fingerprint('body { color: red; }'), null);
});

// --- the marker -------------------------------------------------------------

test('the fingerprint round-trips through the markdown', () => {
  const md = writeFingerprint('# Design system\n\nSlate.\n', 'abc123def456');
  assert.equal(readFingerprint(md), 'abc123def456');
  assert.match(md, new RegExp(`<!-- ${MARKER}: abc123def456 -->`));
});

test('re-recording replaces the marker instead of stacking a second one', () => {
  let md = writeFingerprint('# Design system\n', 'aaaaaaaaaaaa');
  md = writeFingerprint(md, 'bbbbbbbbbbbb');
  assert.equal(readFingerprint(md), 'bbbbbbbbbbbb');
  assert.equal(md.match(new RegExp(MARKER, 'g')).length, 1);
});

test('prose is preserved when the marker is added', () => {
  const md = writeFingerprint('# Design system\n\nThe reasoning lives here.\n', 'abc123');
  assert.match(md, /The reasoning lives here\./);
});

// --- verdicts ---------------------------------------------------------------

test('the three verdicts are distinguished, not collapsed into "failed"', () => {
  assert.equal(verdict({ css: CSS, markdown: '# x' }).code, 'unrecorded');
  assert.equal(verdict({ css: 'body{}', markdown: '# x' }).code, 'no-tokens');
  const good = writeFingerprint('# x', fingerprint(CSS));
  assert.equal(verdict({ css: CSS, markdown: good }).code, 'match');
  assert.equal(verdict({ css: CSS.replace('91%', '40%'), markdown: good }).code, 'drifted');
});

test('a drifted verdict carries both hashes so the report is actionable', () => {
  const good = writeFingerprint('# x', fingerprint(CSS));
  const v = verdict({ css: CSS.replace('91%', '40%'), markdown: good });
  assert.ok(v.recorded && v.actual && v.recorded !== v.actual);
});

// --- cli --------------------------------------------------------------------

test('--record then check is clean', () => {
  const { cssPath, mdPath } = project();
  assert.equal(run([cssPath, mdPath, '--record']).status, 0);
  assert.match(readFileSync(mdPath, 'utf8'), new RegExp(MARKER));
  assert.equal(run([cssPath, mdPath]).status, 0);
});

test('a silent restyle fails, and the message names both possibilities', () => {
  // Either someone edited tokens without updating the master, or it was a
  // deliberate restyle. The tool cannot know which, so it says both.
  const { cssPath, mdPath } = project();
  run([cssPath, mdPath, '--record']);
  writeFileSync(cssPath, CSS.replace('217 91% 60%', '340 82% 52%'));
  const res = run([cssPath, mdPath]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no longer holds the palette/);
  assert.match(res.stderr, /in so many words/);
  assert.match(res.stderr, /deliberate restyle/);
});

test('an unrecorded palette says how to record it, not that it drifted', () => {
  const { cssPath, mdPath } = project();
  const res = run([cssPath, mdPath]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--record/);
  assert.doesNotMatch(res.stderr, /no longer holds/);
});

test('a missing file exits 2, distinct from a failed check', () => {
  const { cssPath } = project();
  assert.equal(run([cssPath, '/nope/design-system.md']).status, 2);
});
