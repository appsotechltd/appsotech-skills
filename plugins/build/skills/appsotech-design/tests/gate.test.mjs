import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classify, surfaceDirs, flutterTokenFiles, hasFlutterPackage, PASS, FAIL, SKIP,
} from '../scripts/gate.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'gate.mjs');

const TOKENS = `:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 222 47% 11%;
  --primary-foreground: 210 40% 98%;
  --ring: 222 47% 11%;
}
.dark { --background: 222 47% 4%; --foreground: 210 40% 98%; --ring: 210 40% 98%; }`;

function project({ tokens = TOKENS, src = 'export const C = () => <button>Go</button>;',
  domain = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(dir, 'design'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'apps', 'webapp', 'src'), { recursive: true });
  writeFileSync(join(dir, 'design', 'tokens.css'), tokens);
  writeFileSync(join(dir, 'design', 'design-system.md'), '# Design system\n\nSlate on white.\n');
  writeFileSync(join(dir, 'apps', 'webapp', 'src', 'C.tsx'), src);
  if (domain) writeFileSync(join(dir, 'docs', 'domain.md'), '# Domain\n\nOne tenant is a clinic.\n');
  return dir;
}
function run(cwd, args = []) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}
function record(dir) {
  execFileSync(process.execPath, [
    join(import.meta.dirname, '..', 'scripts', 'freeze-check.mjs'),
    'design/tokens.css', 'design/design-system.md', '--record',
  ], { cwd: dir });
}

// --- classification ---------------------------------------------------------

test('exit 3 is a skip only where a skip was declared possible', () => {
  // responsive-check exits 3 for "Playwright absent". No other step has a
  // could-not-run code, so 3 from them would be a genuine failure.
  assert.equal(classify(3, { skipStatus: 3 }), SKIP);
  assert.equal(classify(3), FAIL);
  assert.equal(classify(0), PASS);
  assert.equal(classify(1), FAIL);
});

test('exit 2 is a failure, never a skip', () => {
  // 2 means bad input — the gate was pointed at the wrong directory. Treating
  // that as "did not apply" is exactly how a scan of nothing reads as clean.
  assert.equal(classify(2, { skipStatus: 3 }), FAIL);
});

test('surface directories are discovered from the conventions', () => {
  const dir = project();
  const found = surfaceDirs(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0], join(dir, 'apps', 'webapp', 'src'));
});

test('a project with no apps/ yields no surfaces rather than throwing', () => {
  assert.deepEqual(surfaceDirs(mkdtempSync(join(tmpdir(), 'empty-'))), []);
});

// --- the run ----------------------------------------------------------------

test('a clean project passes, with the un-runnable steps marked SKIP', () => {
  const dir = project();
  record(dir);
  const res = run(dir, ['--domain', join('docs', 'domain.md')]);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /PASS {2}domain/);
  assert.match(res.stdout, /PASS {2}contrast/);
  assert.match(res.stdout, /PASS {2}freeze/);
  assert.match(res.stdout, /PASS {2}markup/);
  assert.match(res.stdout, /SKIP {2}responsive/);
  assert.match(res.stdout, /SKIP {2}tokens\.dart/);
});

test('skips are never counted as passes, and are called out every run', () => {
  // The whole reason this file exists: a partial run that reads as a clean one
  // is worse than no gate, because it is believed.
  const dir = project();
  record(dir);
  const out = run(dir, ['--domain', join('docs', 'domain.md')]).stdout;
  assert.match(out, /4 passed, 0 failed, 2 skipped/);
  assert.match(out, /did not run\. They are not passes/);
});

test('an unrecorded palette fails the gate', () => {
  const dir = project();   // no record() — the fingerprint was never written
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL {2}freeze/);
});

test('a token below the contrast floor fails the gate', () => {
  const dir = project({
    tokens: TOKENS.replace('--primary-foreground: 210 40% 98%', '--primary-foreground: 222 40% 20%'),
  });
  record(dir);
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL {2}contrast/);
  // The failing step's own output is reproduced, so the summary is actionable
  // without re-running the individual script.
  assert.match(res.stdout, /--- contrast/);
});

test('a hardcoded colour in a component fails the gate', () => {
  const dir = project({ src: 'export const C = () => <div style={{color:"#3B82F6"}} />;' });
  record(dir);
  const res = run(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL {2}markup/);
  assert.match(res.stdout, /hardcoded-colour/);
});

test('a missing design/ reports what did not run rather than passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bare-'));
  const res = run(dir);
  assert.match(res.stdout, /SKIP {2}contrast/);
  assert.match(res.stdout, /selection and freeze never ran/);
  assert.match(res.stdout, /did not run/);
});

test('--src overrides discovery for a single surface', () => {
  const dir = project();
  record(dir);
  const res = run(dir, ['--src', join('apps', 'webapp', 'src')]);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /markup\s+apps/);
});

test('every step is one of exactly three states', () => {
  const dir = project();
  record(dir);
  for (const line of run(dir).stdout.split('\n')) {
    const m = line.match(/^ {2}(\w+) {2}\w/);
    if (m) assert.ok([PASS, FAIL, SKIP].includes(m[1]), line);
  }
});

test('a domain that was never written down is surfaced, not passed over', () => {
  // Phase 9: a phase that was skipped is said plainly, not omitted. Until this
  // step existed, a project whose domain lived only in a chat transcript
  // passed the gate in silence — and a cloud session inherits nothing from a
  // transcript.
  const dir = project({ domain: false });
  record(dir);
  const res = run(dir, ['--domain', join('docs', 'domain.md')]);
  assert.match(res.stdout, /SKIP {2}domain/);
  assert.match(res.stdout, /never written down/);
  // A missing domain is a gap in the record, not a broken build. It reports
  // and does not fail, the same way an absent Flutter surface does.
  assert.equal(res.status, 0, res.stdout);
});

test('the domain step asserts existence only, never contents', () => {
  // Whether the domain notes are any good, and whether a spec's acceptance
  // criteria honestly became tests, are judgement calls. Automating those
  // badly would convert a real human check into a green tick.
  const dir = project();
  writeFileSync(join(dir, 'docs', 'domain.md'), 'tbd\n');
  record(dir);
  assert.match(run(dir, ['--domain', join('docs', 'domain.md')]).stdout, /PASS {2}domain/);
});

test('without --domain there is no domain step at all', () => {
  // A design-only project has no docs/domain.md and never will. Defaulting the
  // path would print a permanent SKIP for a file nobody intended to write,
  // which is how a real warning gets trained into background noise.
  const dir = project({ domain: false });
  record(dir);
  const out = run(dir).stdout;
  assert.doesNotMatch(out, /domain/);
  assert.match(out, /3 passed, 0 failed, 2 skipped/);
});

// --- finding the Flutter package ---------------------------------------------

function flutterProject({ at = join('mobile'), tokens = true, pubspec = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'flut-'));
  mkdirSync(join(dir, 'design'), { recursive: true });
  mkdirSync(join(dir, at, 'lib', 'design'), { recursive: true });
  writeFileSync(join(dir, 'design', 'tokens.css'), TOKENS);
  writeFileSync(join(dir, 'design', 'design-system.md'), '# Design system\n\nSlate.\n');
  if (pubspec) writeFileSync(join(dir, at, 'pubspec.yaml'), 'name: app\n');
  if (tokens) {
    execFileSync(process.execPath, [
      join(import.meta.dirname, '..', 'scripts', 'tokens-dart.mjs'),
      'design/tokens.css', '-o', join(at, 'lib', 'design', 'tokens.dart'),
    ], { cwd: dir });
  }
  return dir;
}

test('the Flutter token file is found wherever the package sits', () => {
  // The old fixed apps/mobile/... default reported "no Flutter surface" for a
  // project that HAS one, so the drift check silently skipped a real file
  // while asserting something false.
  for (const at of ['mobile', join('apps', 'mobile'), join('packages', 'app')]) {
    const dir = flutterProject({ at });
    assert.deepEqual(flutterTokenFiles(dir),
      [join(dir, at, 'lib', 'design', 'tokens.dart')], at);
  }
});

test('a package at the repository root is found too', () => {
  const dir = flutterProject({ at: '.' });
  assert.deepEqual(flutterTokenFiles(dir), [join(dir, 'lib', 'design', 'tokens.dart')]);
});

test('build output is never walked', () => {
  const dir = flutterProject({ at: 'mobile' });
  mkdirSync(join(dir, 'node_modules', 'x', 'lib', 'design'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'x', 'lib', 'design', 'tokens.dart'), '// no');
  assert.deepEqual(flutterTokenFiles(dir), [join(dir, 'mobile', 'lib', 'design', 'tokens.dart')]);
});

test('a discovered Flutter token file is actually checked for drift', () => {
  const dir = flutterProject({ at: 'mobile' });
  record(dir);
  assert.match(run(dir, ['--src', join('mobile', 'lib')]).stdout,
    /PASS {2}tokens\.dart {2}mobile/);
});

test('a Flutter package with no generated tokens is a finding, not an absence', () => {
  // These two used to read identically. One means "there is no Flutter here";
  // the other means "there is, and its palette was never generated" — which is
  // how the app and the website drift apart.
  const dir = flutterProject({ at: 'mobile', tokens: false });
  record(dir);
  assert.equal(hasFlutterPackage(dir), true);
  const out = run(dir, ['--src', join('mobile', 'lib')]).stdout;
  assert.match(out, /SKIP {2}tokens\.dart/);
  assert.match(out, /never generated/);
});

test('no Flutter anywhere says exactly that', () => {
  const dir = project();
  record(dir);
  assert.equal(hasFlutterPackage(dir), false);
  assert.deepEqual(flutterTokenFiles(dir), []);
  assert.match(run(dir).stdout, /no Flutter package found/);
});

test('--dart still overrides discovery', () => {
  const dir = flutterProject({ at: 'mobile' });
  record(dir);
  const explicit = join('mobile', 'lib', 'design', 'tokens.dart');
  assert.match(run(dir, ['--dart', explicit, '--src', join('mobile', 'lib')]).stdout,
    /PASS {2}tokens\.dart/);
});
