import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'score.mjs');

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'app-audit-score-cli-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SCOPE = {
  system: 'acme-app', ref: 'd220421', environment: 'production',
  date: '2026-07-29', auditor: 'Jane Doe',
};

// layer 1 = 100% (one probe, scored 4/4), layer 2 = 0% (one probe, scored 0/4)
const DOC = {
  scope: SCOPE,
  probes: { '1.1': { score: 4, class: 'inspected' }, '2.1': { score: 0, class: 'inspected' } },
};

// Two probes is a deliberately partial document, so these runs pass --partial.
// The subject of these tests is weights threading, not completeness — the
// coverage guard has its own tests below.
function runScoreCli(scoresDoc, extraArgs = ['--partial']) {
  return withTempDir((dir) => {
    const scoresPath = join(dir, 'scores.json');
    writeFileSync(scoresPath, JSON.stringify(scoresDoc));
    const result = spawnSync(process.execPath, [CLI_PATH, scoresPath, '--out', dir, ...extraArgs], { encoding: 'utf8' });
    let card = null;
    try {
      card = JSON.parse(readFileSync(join(dir, 'scorecard.json'), 'utf8'));
    } catch {
      card = null;
    }
    return { result, card };
  });
}

// --- Important 2: score.mjs must actually wire scores.json's `weights` key through ---
//
// SKILL.md Phase 1 tells the auditor to re-weight layers for context, but score.mjs
// called scoreAudit(doc) with no second argument — opts.weights was always undefined
// and the scorer always fell back to the hardcoded default WEIGHTS table, no matter
// what was written into scores.json. scoreAudit(doc, {weights}) and weightedOverall's
// custom-weights math were already built and unit-tested (scoring.test.mjs); the gap
// was purely that score.mjs never reached in and passed the key through.

test('CLI: score.mjs scores against the default weights when scores.json carries none', () => {
  const { result, card } = runScoreCli(DOC);
  assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
  assert.ok(card, 'scorecard.json must be written');
  // default weights: layer1=6, layer2=10 -> (100*6 + 0*10) / 16 = 37.5
  assert.equal(card.weightedOverall, 37.5);
});

test('CLI: a custom weights map in scores.json reaches score.mjs\'s output', () => {
  const { result, card } = runScoreCli({ ...DOC, weights: { 1: 90, 2: 10 } });
  assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
  assert.ok(card, 'scorecard.json must be written even with a custom weights map');
  // layer1=100 w90, layer2=0 w10 -> (100*90 + 0*10) / 100 = 90 — differs from the
  // default-weights result above (37.5), proving the CLI actually threads
  // scores.json's weights key into scoreAudit, not just that scoreAudit itself
  // supports the option (already covered by scoring.test.mjs's "custom weights
  // override the defaults").
  assert.equal(card.weightedOverall, 90);
});

// --- Minor 6: --out must not swallow the next flag as its own value ---
//
// score.mjs previously resolved --out with a bare `args[i + 1]`, with no check that
// the following token wasn't itself a recognised flag. `score.mjs scores.json --out
// --baseline` (a missing --out value immediately followed by another flag) therefore
// created a directory literally named "--baseline" instead of falling back to the
// default output directory. Now backed by the same flagValue() guard collect-live.mjs
// already had, shared via lib/cli-args.mjs.

test('CLI: --out immediately followed by another flag falls back to the default out dir, not a literal "--baseline" directory', () => {
  withTempDir((dir) => {
    const scoresPath = join(dir, 'scores.json');
    writeFileSync(scoresPath, JSON.stringify(DOC));
    const result = spawnSync(
      process.execPath, [CLI_PATH, scoresPath, '--out', '--baseline', '--partial'],
      { encoding: 'utf8', cwd: dir },
    );
    assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
    assert.equal(existsSync(join(dir, '--baseline')), false, 'must not create a directory literally named --baseline');
    assert.equal(existsSync(join(dir, 'scorecard.json')), true, 'must fall back to the default out dir (".") and still write output');
  });
});

// --- A partial scores.json must not report a band ---
//
// The weighted overall renormalises over whatever layers are PRESENT, so a
// scores.json holding one probe scored 4 produced "overall 100 —
// Production-hardened" and exit 0. Phase 3 writes scores.json after every
// layer group, so the half-finished file is the normal intermediate state and
// scoring one by accident was easy. Everywhere else this skill caps what it
// cannot evidence; absent probes were the one place that silently improved the
// average instead of qualifying it.

function fullDoc() {
  // One probe per layer is still partial by probe count, so build a genuinely
  // complete document: every layer filled to its expected probe count.
  const COUNTS = { 1: 8, 2: 8, 3: 9, 4: 9, 5: 7, 6: 7, 7: 7, 8: 9, 9: 7, 10: 7, 11: 7, 12: 8, 13: 8 };
  const probes = {};
  for (const [layer, n] of Object.entries(COUNTS)) {
    for (let i = 1; i <= n; i++) probes[`${layer}.${i}`] = { score: 4, class: 'inspected' };
  }
  return { scope: SCOPE, probes };
}

test('CLI: a partial audit exits non-zero and reports no band', () => {
  const { result, card } = runScoreCli(
    { scope: SCOPE, probes: { '1.1': { score: 4, class: 'inspected' } } }, []);
  assert.equal(result.status, 1, 'an unacknowledged partial run must not exit 0');
  assert.match(result.stderr, /Refusing to report a partial audit/);
  assert.match(result.stderr, /no probes at all in layer\(s\) 2, 3/);
  assert.equal(card.band, null, 'a partial audit has no band');
  assert.equal(card.coverage.complete, false);
  assert.equal(card.coverage.scored, 1);
  assert.equal(card.coverage.expected, 101);
});

test('CLI: the scorecard says it is partial on the cover, not only in the log', () => {
  withTempDir((dir) => {
    const scoresPath = join(dir, 'scores.json');
    writeFileSync(scoresPath, JSON.stringify({ scope: SCOPE, probes: { '1.1': { score: 4, class: 'inspected' } } }));
    spawnSync(process.execPath, [CLI_PATH, scoresPath, '--out', dir, '--partial'], { encoding: 'utf8' });
    const md = readFileSync(join(dir, 'SCORECARD.md'), 'utf8');
    const cover = md.split('## ')[0];
    // The cover is the only section a reader may see, and it is what reaches a
    // client — the warning has to be there, not further down.
    assert.match(cover, /Coverage:\*\* 1\/101 probes/);
    assert.match(cover, /PARTIAL AUDIT — no band/);
    assert.match(cover, /This audit is incomplete/);
    assert.doesNotMatch(cover, /Production-hardened/);
  });
});

test('CLI: --partial still writes the scorecard and exits 0', () => {
  const { result, card } = runScoreCli(
    { scope: SCOPE, probes: { '1.1': { score: 4, class: 'inspected' } } }, ['--partial']);
  assert.equal(result.status, 0, 'an acknowledged interim scorecard is allowed');
  assert.ok(card, 'scorecard.json is still written');
  assert.equal(card.band, null, '--partial acknowledges the gap, it does not fill it');
});

test('CLI: a complete audit gets its band back and exits 0 with no flag', () => {
  const { result, card } = runScoreCli(fullDoc(), []);
  assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
  assert.equal(card.coverage.complete, true);
  assert.equal(card.coverage.scored, 101);
  assert.deepEqual(card.coverage.missingLayers, []);
  assert.equal(card.band, 'Production-hardened');
  assert.match(result.stdout, /coverage 101\/101 probes · 13\/13 layers/);
});

// --- scope is required, as Phase 1 already said it was ---

test('CLI: a scores.json with no scope is refused', () => {
  // Phase 1 calls the reference point non-negotiable, but nothing enforced it:
  // the cover rendered "(unspecified)" five times and scored anyway. A
  // scorecard with no ref can never be re-audited against.
  const { result } = runScoreCli({ probes: { '1.1': { score: 4, class: 'inspected' } } }, ['--partial']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing required scope field\(s\): system, ref, environment, date, auditor/);
});

test('CLI: a partially filled scope names only the fields actually missing', () => {
  const { result } = runScoreCli(
    { scope: { system: 'acme', environment: 'production', date: '2026-07-29', auditor: 'Jane' },
      probes: { '1.1': { score: 4, class: 'inspected' } } }, ['--partial']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing required scope field\(s\): ref$/m);
});

test('CLI: an empty-string scope field counts as missing', () => {
  // "" renders as blank on the cover exactly like an absent key, so it has to
  // fail the same way.
  const { result } = runScoreCli({ scope: { ...SCOPE, ref: '' }, probes: { '1.1': { score: 4, class: 'inspected' } } }, ['--partial']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ref/);
});
