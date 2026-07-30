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
  summarizeGovulncheckOutput,
  interpretGovulncheckResult,
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
// go.mod content here fails to parse ("unknown directive"), so go list
// itself produces no output — the only fixture in this suite where a Go
// root has zero 8.4 evidence from any source, which is what's needed to
// prove govulncheck's absence lands the probe in unavailable[] rather than
// being reconciled into a fact (see the govulncheck tests below).
const BROKEN_GOMOD = join(FIXTURES_EXTRA, 'broken-gomod');

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
const brokenGomodDeps = dependencyFacts(BROKEN_GOMOD);

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

// --- govulncheck: Go vulnerability evidence for probe 8.4 -------------------
//
// govulncheck is not installed on the machine this suite was written on
// (confirmed: spawnSync('govulncheck', ...) reports res.error.code ===
// 'ENOENT'), which is also expected to be the common case for contributors
// running this suite — govulncheck is an opt-in `go install`, not part of
// the Go toolchain. That makes the absent-tool path the one real,
// end-to-end scenario this suite can exercise without a mock; the
// reachable/uncalled parsing logic is covered separately below via
// summarizeGovulncheckOutput, against synthetic NDJSON matching
// govulncheck's documented schema.

test('govulncheck absence on a root where go list already succeeded reconciles into a fact, never unavailable (existing 8.4 contract)', () => {
  const { facts, unavailable } = goonlyDeps;
  const govulnFact = facts.find((f) => f.probe === '8.4' && /govulncheck/i.test(f.fact));
  assert.ok(
    govulnFact,
    `expected govulncheck's spawn failure to be reconciled into an 8.4 fact; facts=${JSON.stringify(facts)}`,
  );
  assert.match(govulnFact.fact, /could not be inspected/i);
  assert.match(govulnFact.fact, /go install golang\.org\/x\/vuln\/cmd\/govulncheck@latest/);
  assert.doesNotMatch(
    govulnFact.fact,
    /found no known vulnerabilit/i,
    'a spawn failure must never read like a clean scan',
  );
  assert.ok(
    !unavailable.some((u) => u.probe === '8.4'),
    'probe 8.4 already has real evidence (go list) and must not also appear in unavailable',
  );
});

test('govulncheck absence lands 8.4 in unavailable, naming the tool and the install command, when no other 8.4 evidence exists for the root', () => {
  const { facts, unavailable } = brokenGomodDeps;
  assert.ok(
    !facts.some((f) => f.probe === '8.4'),
    'go list also failed on this fixture, so 8.4 must have no fact at all',
  );
  const gap = unavailable.find((u) => u.probe === '8.4' && /govulncheck/i.test(u.reason));
  assert.ok(gap, `expected an 8.4 unavailable entry naming govulncheck; got ${JSON.stringify(unavailable)}`);
  assert.match(gap.reason, /go install golang\.org\/x\/vuln\/cmd\/govulncheck@latest/);
  assert.doesNotMatch(gap.reason, /found no known vulnerabilit/i, 'a spawn failure must never read like a clean scan');
});

test('summarizeGovulncheckOutput distinguishes a reachable (called) finding from an uncalled one', () => {
  const ndjson = [
    JSON.stringify({ config: { protocol_version: 'v1.0.0', scanner_name: 'govulncheck', scan_level: 'symbol' } }),
    JSON.stringify({ osv: { id: 'GO-2021-0113', summary: 'Denial of service via crafted Content-Type header' } }),
    JSON.stringify({ osv: { id: 'GO-2022-9999', summary: 'Path traversal in example/vulnerable-dep' } }),
    // Called: trace has function-bearing frames tracing from the vulnerable
    // symbol back to an entry point.
    JSON.stringify({
      finding: {
        osv: 'GO-2021-0113',
        fixed_version: 'v0.1.0',
        trace: [
          { module: 'golang.org/x/net', version: 'v0.0.0-20210917221730', package: 'golang.org/x/net/http2', function: 'ConfigureServer' },
          { module: 'example.com/goonly', package: 'example.com/goonly', function: 'main' },
        ],
      },
    }),
    // Uncalled: a single frame with no `function` field (package-level
    // finding — imported, never reached).
    JSON.stringify({
      finding: {
        osv: 'GO-2022-9999',
        trace: [{ module: 'example.com/vulnerable-dep', version: 'v1.2.3', package: 'example.com/vulnerable-dep/sub' }],
      },
    }),
  ].join('\n');

  const result = summarizeGovulncheckOutput(ndjson);
  assert.equal(result.findingLines.length, 2);

  const called = result.findingLines.find((l) => l.startsWith('GO-2021-0113'));
  assert.match(called, /reachable \(called\)/);
  assert.match(called, /fixed in v0\.1\.0/);

  const uncalled = result.findingLines.find((l) => l.startsWith('GO-2022-9999'));
  assert.match(uncalled, /not called \(uncalled\)/);
  assert.match(uncalled, /no fixed version published yet/);

  assert.match(result.summary, /2 known vulnerabilities/);
  assert.match(result.summary, /1 reachable \(called\), 1 imported but not called/);
});

test('summarizeGovulncheckOutput groups multiple findings for the same OSV and keeps the reachable verdict if any of them is called', () => {
  const ndjson = [
    JSON.stringify({ osv: { id: 'GO-2023-0001', summary: 'Example vuln' } }),
    // Module-level finding first (no function on its frame) ...
    JSON.stringify({ finding: { osv: 'GO-2023-0001', trace: [{ module: 'example.com/dep' }] } }),
    // ... then a symbol-level finding proving it is in fact called.
    JSON.stringify({
      finding: {
        osv: 'GO-2023-0001',
        trace: [
          { module: 'example.com/dep', package: 'example.com/dep/pkg', function: 'Vulnerable' },
          { module: 'example.com/app', package: 'example.com/app', function: 'main' },
        ],
      },
    }),
  ].join('\n');

  const result = summarizeGovulncheckOutput(ndjson);
  assert.equal(result.findingLines.length, 1);
  assert.match(result.findingLines[0], /reachable \(called\)/);
});

test('summarizeGovulncheckOutput reports a positive clean-scan summary when no findings are present', () => {
  // A bare config-only message is *not* used as the clean-scan fixture here
  // on purpose: govulncheck's own JSON stream has no explicit "scan
  // complete" message (see golang/go#62340 — still open), and its scan
  // runner writes `config` before package loading even begins, so
  // config-only is exactly the shape a run that failed immediately would
  // also produce. Content shape alone can never fully prove completion —
  // that's what interpretGovulncheckResult's exit-status check is for (see
  // below) — so this fixture instead includes a realistic progress message
  // too, to at least exercise "more happened than just startup" rather than
  // silently reusing the ambiguous shape as if it settled the question.
  const ndjson = [
    JSON.stringify({ config: { protocol_version: 'v1.0.0', scanner_name: 'govulncheck', scan_level: 'symbol' } }),
    JSON.stringify({ progress: { message: 'Scanning your code and 12 packages across 3 dependent modules for known vulnerabilities...' } }),
  ].join('\n');
  const result = summarizeGovulncheckOutput(ndjson);
  assert.equal(result.findingLines.length, 0);
  assert.match(result.summary, /found no known vulnerabilities/i);
});

test('summarizeGovulncheckOutput returns null when stdout has no parseable JSON at all', () => {
  assert.equal(summarizeGovulncheckOutput(''), null);
  assert.equal(summarizeGovulncheckOutput('not json\nalso not json'), null);
});

// --- interpretGovulncheckResult: exit status must gate stdout, not just error
//
// With `-json`, govulncheck's own docs state it "exits successfully
// (regardless of the number of detected vulnerabilities)" — so exit 0 covers
// both a clean scan and a scan that found things, and any *non-zero* exit
// means the run genuinely failed partway through. That matters because the
// scan runner writes the `config` message before package loading begins, so
// a run that fails immediately after (a build error under ./..., or no
// network access to the vulnerability database) can still emit one
// complete, parseable JSON line — which, if stdout were trusted without
// checking status first, would be indistinguishable from a genuine
// zero-findings result.

test('interpretGovulncheckResult treats a non-zero exit as a failed run even when stdout parses as a valid (but incomplete) clean-looking result', () => {
  const res = {
    error: null,
    status: 1,
    stdout: JSON.stringify({ config: { protocol_version: 'v1.0.0', scan_level: 'symbol' } }) + '\n',
    stderr: 'go: build failed: missing go.sum entry\n',
  };
  const result = interpretGovulncheckResult(res);
  assert.equal(result.ok, false, 'a non-zero exit must never be treated as a successful (even if empty) scan');
  assert.match(result.reason, /status 1/);
  assert.match(result.reason, /missing go\.sum entry/, 'stderr should be surfaced to explain the real failure');
  assert.doesNotMatch(
    result.reason ?? '',
    /found no known vulnerabilit/i,
    'must not be phrased as if it were a clean scan',
  );
});

test('interpretGovulncheckResult reports a real clean scan when status is 0', () => {
  const res = {
    error: null,
    status: 0,
    stdout: [
      JSON.stringify({ config: { protocol_version: 'v1.0.0', scan_level: 'symbol' } }),
      JSON.stringify({ progress: { message: 'Scanning your code and 12 packages across 3 dependent modules for known vulnerabilities...' } }),
    ].join('\n'),
    stderr: '',
  };
  const result = interpretGovulncheckResult(res);
  assert.equal(result.ok, true);
  assert.match(result.summary, /found no known vulnerabilities/i);
});

test('interpretGovulncheckResult names the tool and install command on a spawn error, distinct from an exit-status failure', () => {
  const res = { error: { code: 'ENOENT', message: 'spawnSync govulncheck ENOENT' }, status: null, stdout: null, stderr: null };
  const result = interpretGovulncheckResult(res);
  assert.equal(result.ok, false);
  assert.match(result.reason, /could not be invoked/i);
  assert.match(result.reason, /go install golang\.org\/x\/vuln\/cmd\/govulncheck@latest/);
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
  const results = [partialNpmDeps, monorepoDeps, goonlyDeps, brokenGomodDeps, collectStatic(TARGET)];
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
