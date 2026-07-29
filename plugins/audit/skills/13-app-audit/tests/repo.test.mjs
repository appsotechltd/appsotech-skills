import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, relative, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  discoverRoots,
  migrationFacts,
  ciFacts,
  containerFacts,
  dependencyFacts,
  bundleFacts,
  collectStatic,
} from '../scripts/lib/repo.mjs';

const TARGET = join(import.meta.dirname, 'fixtures', 'target');
const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'collect-static.mjs');

// Fixtures that carry a real lockfile/go.mod (and therefore cause
// dependencyFacts to actually shell out to npm/go) live under a sibling
// fixtures-extra/ directory, never under fixtures/ itself. The "nothing to
// inspect" test below points collectStatic at the whole fixtures/ directory
// and relies on discovery finding nothing subprocess-worthy there; putting
// npm/go-bearing fixtures anywhere under fixtures/ would make that
// directory-emptiness unit test silently start shelling out to npm and go,
// which is exactly the test-hygiene defect this layout avoids.
const FIXTURES_EXTRA = join(import.meta.dirname, 'fixtures-extra');
const MONOREPO = join(FIXTURES_EXTRA, 'monorepo');
const GOONLY = join(FIXTURES_EXTRA, 'goonly');
const NO_FROM_DOCKERFILE = join(FIXTURES_EXTRA, 'nofromdockerfile');
const PARTIAL_NPM = join(FIXTURES_EXTRA, 'partial-npm');

// dependencyFacts on these three fixtures shells out to real npm/go
// processes (deliberately, to prove Critical 2's fix and the 8.4
// reconciliation fix against real spawnSync behaviour rather than a mock —
// no mocking library exists under this project's zero-dependency
// constraint). Several tests below assert different things about the same
// result, so each fixture is collected exactly once at module load and
// reused by reference, instead of every test re-triggering its own set of
// subprocess spawns. This is the same "don't shell out more than the test
// actually needs" principle the fixture-relocation fix above applies, aimed
// at the redundant-computation half of the problem rather than the
// wrong-directory half.
const monorepoDeps = dependencyFacts(MONOREPO);
const goonlyDeps = dependencyFacts(GOONLY);
const partialNpmDeps = dependencyFacts(PARTIAL_NPM);

test('migration facts flag the up without a matching down', () => {
  const { facts } = migrationFacts(TARGET);
  assert.ok(facts.every((f) => f.probe === '3.3'));
  const irreversible = facts.find((f) => /000002/.test(f.fact));
  assert.ok(irreversible, 'must name the irreversible migration');
  assert.match(irreversible.fact, /no matching down/i);
});

test('migration facts do not flag a complete up/down pair', () => {
  const { facts } = migrationFacts(TARGET);
  assert.ok(!facts.some((f) => /000001.*no matching down/i.test(f.fact)));
});

test('CI facts record which jobs exist and whether tests run', () => {
  const { facts } = ciFacts(TARGET);
  assert.ok(facts.some((f) => f.probe === '7.1' && /test/.test(f.fact)));
  assert.ok(facts.some((f) => f.probe === '7.3' && /lint/.test(f.fact)));
});

test('CI facts report the absence of dependency and secret scanning', () => {
  const { facts } = ciFacts(TARGET);
  const scan = facts.find((f) => f.probe === '7.4');
  assert.ok(scan, 'probe 7.4 must always produce a fact, present or absent');
  assert.match(scan.fact, /no (dependency|secret) scan/i);
});

test('container facts flag an unpinned base image', () => {
  const { facts } = containerFacts(TARGET);
  const pin = facts.find((f) => f.probe === '7.5');
  assert.match(pin.fact, /not pinned by digest/i);
  assert.match(pin.source, /Dockerfile/);
});

test('bundle facts find secrets in dist and cite file, line and column', () => {
  const { facts } = bundleFacts(TARGET);
  const jwt = facts.find((f) => /JWT/.test(f.fact));
  assert.equal(jwt.probe, '1.4');
  assert.match(jwt.source, /dist[\\/]app\.js:\d+:\d+/);
});

test('no fact carries a score field', () => {
  for (const f of collectStatic(TARGET).facts) {
    assert.equal(f.score, undefined, `${f.probe} smuggled a score into a collector`);
  }
});

test('every fact declares evidence class inspected', () => {
  for (const f of collectStatic(TARGET).facts) assert.equal(f.class, 'inspected');
});

test('a probe with nothing to inspect lands in unavailable, not silently absent', () => {
  const doc = collectStatic(join(import.meta.dirname, 'fixtures'));  // no migrations dir here
  assert.ok(doc.unavailable.some((u) => u.probe === '3.3'));
});

// --- Critical 1: bounded project-root discovery ---------------------------

test('discoverRoots finds nested project roots and does not descend into node_modules', () => {
  const roots = discoverRoots(MONOREPO);
  assert.ok(roots.includes(join(MONOREPO, 'backend')), 'must find backend/ (go.mod, Dockerfile)');
  assert.ok(roots.includes(join(MONOREPO, 'frontend')), 'must find frontend/ (package.json, Dockerfile, dist/)');
  assert.ok(!roots.some((r) => r.includes('node_modules')), 'must not treat a vendored package as a project root');
});

test('containerFacts discovers Dockerfiles in nested project roots, not just the target root', () => {
  const { facts, unavailable } = containerFacts(MONOREPO);
  assert.ok(facts.some((f) => f.probe === '7.5' && /backend[\\/]Dockerfile/.test(f.source)));
  assert.ok(facts.some((f) => f.probe === '7.5' && /frontend[\\/]Dockerfile/.test(f.source)));
  assert.equal(unavailable.length, 0, 'evidence exists at depth 1, so this must not read as unavailable');
});

test('dependencyFacts reports 1.7 for both an npm root and a go root in the same tree', () => {
  const { facts } = monorepoDeps;
  assert.ok(facts.some((f) => f.probe === '1.7' && /package\.json/.test(f.source)));
  assert.ok(facts.some((f) => f.probe === '1.7' && /go\.mod/.test(f.source)));
});

test('a clean nested bundle scan produces a positive fact, not silence', () => {
  const { facts, unavailable } = bundleFacts(MONOREPO);
  assert.ok(facts.some((f) => f.probe === '1.4' && /scanned/.test(f.fact) && /no secret-shaped findings/.test(f.fact)));
  assert.equal(unavailable.length, 0);
});

test('collectStatic records which project roots were discovered', () => {
  const doc = collectStatic(MONOREPO);
  const rootsFact = doc.facts.find((f) => f.probe === 'meta.roots');
  assert.ok(rootsFact, 'an auditor needs to know what was covered');
  assert.match(rootsFact.fact, /backend/);
  assert.match(rootsFact.fact, /frontend/);
});

// --- Critical 2: npm audit must actually run on Windows --------------------

test('npm audit is actually invoked (no swallowed EINVAL) and reports a real result', () => {
  const { facts, unavailable } = monorepoDeps;
  const npmAuditFact = facts.find((f) => f.probe === '8.4' && /package-lock\.json/.test(f.source));
  assert.ok(
    npmAuditFact,
    `expected a real npm audit result fact; got unavailable=${JSON.stringify(unavailable)}`,
  );
  assert.match(npmAuditFact.fact, /vulnerability counts/i);
});

test('go list runs and reports a real result for the go root', () => {
  const { facts, unavailable } = monorepoDeps;
  const goListFact = facts.find((f) => f.probe === '8.4' && /go\.mod/.test(f.source));
  assert.ok(goListFact, `expected a real go list result fact; got unavailable=${JSON.stringify(unavailable)}`);
  assert.match(goListFact.fact, /module/i);
});

// --- Critical 3: per-probe coverage must be explicit, not array-emptiness --

test('dependencyFacts still reports 1.7 on a Go-only target with no package.json anywhere', () => {
  const { facts, unavailable } = goonlyDeps;
  assert.ok(facts.some((f) => f.probe === '1.7'), '1.7 must not vanish just because 8.4 already has a go-list fact');
  assert.ok(!unavailable.some((u) => u.probe === '1.7'));
});

test('a Dockerfile with no FROM instruction still produces an explicit 7.5 fact', () => {
  const { facts, unavailable } = containerFacts(NO_FROM_DOCKERFILE);
  const f = facts.find((f) => f.probe === '7.5');
  assert.ok(f, 'must not silently produce zero facts for 7.5 just because there is no FROM line');
  assert.match(f.fact, /no FROM instruction/i);
  assert.equal(unavailable.length, 0);
});

// --- Important 5: target.path must be absolute ------------------------------

test('target.path is resolved to an absolute path even when given a relative one', () => {
  const relInput = relative(process.cwd(), TARGET) || '.';
  const doc = collectStatic(relInput);
  assert.equal(doc.target.path, resolve(TARGET));
});

// --- Important (round 2): 8.4 must never appear in both facts and unavailable

test('a partial npm audit failure across roots reconciles to one outcome per probe', () => {
  // goodnpm has a valid zero-dependency lockfile (npm audit succeeds);
  // badnpm has a package-lock.json that exists but is not valid JSON that
  // npm can use, so npm audit itself fails structurally (deterministic,
  // offline — no dependency on registry reachability).
  const { facts, unavailable } = partialNpmDeps;

  const audit84Facts = facts.filter((f) => f.probe === '8.4');
  const audit84Unavailable = unavailable.filter((u) => u.probe === '8.4');

  assert.ok(
    audit84Facts.some((f) => /vulnerability counts/i.test(f.fact) && /goodnpm/i.test(f.source)),
    'the successful root must still be reported as a fact',
  );
  assert.ok(
    audit84Facts.some((f) => /badnpm/i.test(f.fact) && /could not be inspected/i.test(f.fact)),
    'the failed root must be reported as a fact noting it could not be inspected, not as a gap',
  );
  assert.equal(
    audit84Unavailable.length,
    0,
    'probe 8.4 has real evidence from goodnpm, so it must not also appear in unavailable',
  );
});

test('no probe appears in both facts and unavailable for any collector', () => {
  const results = [partialNpmDeps, monorepoDeps, goonlyDeps, collectStatic(TARGET)];
  for (const { facts, unavailable } of results) {
    const factProbes = new Set(facts.map((f) => f.probe));
    for (const { probe } of unavailable) {
      assert.ok(
        !factProbes.has(probe),
        `probe ${probe} appears in both facts and unavailable — exactly one outcome per probe is required`,
      );
    }
  }
});

// --- discoverRoots computed once and threaded through -----------------------
//
// collectStatic previously called discoverRoots() once for its own
// meta.roots fact, then containerFacts, dependencyFacts and bundleFacts each
// called it again independently — four filesystem walks of the same target
// per run. containerFacts/dependencyFacts/bundleFacts now accept an optional
// second `roots` argument; collectStatic computes it once and passes it in.
// The argument is optional specifically so every direct call above (and in
// real use of the library) keeps working unchanged.

test('containerFacts and bundleFacts return identical results whether roots is precomputed or self-discovered', () => {
  const roots = discoverRoots(MONOREPO);
  assert.deepEqual(containerFacts(MONOREPO, roots), containerFacts(MONOREPO));
  assert.deepEqual(bundleFacts(MONOREPO, roots), bundleFacts(MONOREPO));
});

// --- collect-static.mjs CLI: reject a target that does not exist ------------
//
// Important 3: collectStatic() reports a real target with nothing in it
// (no CI, no Dockerfile, no build output) the exact same way it reports a
// typo'd path — a well-formed document, every relevant probe in
// unavailable[]. The CLI validates existence itself so a nonexistent target
// gets a clean, distinguishable "usage" refusal (matching score.mjs's own
// missing-input behaviour) instead of silently producing plausible-looking
// evidence for a directory that was never there.

test('CLI: a nonexistent target directory exits 2 with the usage message, not a silently well-formed evidence document', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, join(TARGET, 'does-not-exist')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: collect-static\.mjs/);
  assert.equal(result.stdout, '');
});

test('CLI: a target path that is a file, not a directory, exits 2', () => {
  const filePath = join(TARGET, 'package.json');
  const result = spawnSync(process.execPath, [CLI_PATH, filePath], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: collect-static\.mjs/);
});

test('CLI: a missing target argument exits 2 with the usage message', () => {
  const result = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: collect-static\.mjs/);
});

// --- collect-static.mjs CLI: shared flagValue/positionals guard -------------
//
// Minor 6: collect-static.mjs used to find its target with a naive
// `args.find(a => !a.startsWith('--'))`, which had no notion of "this token
// belongs to the previous flag" — so `--out X target` picked "X" (the value
// meant for --out) as the target instead of "target". Now backed by the same
// shared positionals() helper collect-live.mjs already used.

test('CLI: --out <path> <target> audits the target directory, not --out\'s own value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-audit-static-cli-'));
  try {
    const outPath = join(dir, 'static.json');
    const result = spawnSync(process.execPath, [CLI_PATH, '--out', outPath, TARGET], { encoding: 'utf8' });
    assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
    const doc = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(doc.target.path, resolve(TARGET), 'must have audited TARGET, not --out\'s own value');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
