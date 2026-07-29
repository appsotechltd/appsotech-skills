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

// layer 1 = 100% (one probe, scored 4/4), layer 2 = 0% (one probe, scored 0/4)
const DOC = { probes: { '1.1': { score: 4, class: 'inspected' }, '2.1': { score: 0, class: 'inspected' } } };

function runScoreCli(scoresDoc, extraArgs = []) {
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
    const result = spawnSync(process.execPath, [CLI_PATH, scoresPath, '--out', '--baseline'], { encoding: 'utf8', cwd: dir });
    assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
    assert.equal(existsSync(join(dir, '--baseline')), false, 'must not create a directory literally named --baseline');
    assert.equal(existsSync(join(dir, 'scorecard.json')), true, 'must fall back to the default out dir (".") and still write output');
  });
});
