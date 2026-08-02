import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  tokenSets, generateDart, dartName, toDartColor, toDartDouble,
  isDarkSelector, OUT_SUFFIX,
} from '../scripts/tokens-dart.mjs';
import { collect } from '../scripts/audit-markup.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'tokens-dart.mjs');

const CSS = `
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 217 91% 60%;
  --primary-foreground: 0 0% 100%;
  --radius: 0.5rem;
}
.dark {
  --background: 222 47% 4%;
  --foreground: 210 40% 98%;
}
`;

function run(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}
function project(css = CSS) {
  const dir = mkdtempSync(join(tmpdir(), 'dart-'));
  mkdirSync(join(dir, 'design'), { recursive: true });
  const cssPath = join(dir, 'design', 'tokens.css');
  writeFileSync(cssPath, css);
  return { dir, cssPath, out: join(dir, 'lib', 'design', 'tokens.dart') };
}

// --- conversion -------------------------------------------------------------

test('HSL triplets become Color(0xFFRRGGBB)', () => {
  assert.equal(toDartColor('0 0% 100%'), 'Color(0xFFFFFFFF)');
  assert.equal(toDartColor('0 0% 0%'), 'Color(0xFF000000)');
  assert.equal(toDartColor('#3B82F6'), 'Color(0xFF3B82F6)');
  assert.equal(toDartColor('not a colour'), null);
});

test('rem and px both resolve to a Dart double, rem at 16px', () => {
  assert.equal(toDartDouble('0.5rem'), '8.0');
  assert.equal(toDartDouble('12px'), '12.0');
  assert.equal(toDartDouble('2'), '2.0');
  assert.equal(toDartDouble('auto'), null);
});

test('token names become Dart camelCase', () => {
  assert.equal(dartName('primary-foreground'), 'primaryForeground');
  assert.equal(dartName('background'), 'background');
  assert.equal(dartName('muted-foreground'), 'mutedForeground');
});

test('dark selectors are recognised in each form they are written', () => {
  for (const s of ['.dark', '[data-theme="dark"]', 'html.dark', '@media (prefers-color-scheme: dark)']) {
    assert.equal(isDarkSelector(s), true, s);
  }
  assert.equal(isDarkSelector(':root'), false);
  // A token named for something else must not be mistaken for a dark block.
  assert.equal(isDarkSelector('.darkroom-banner'), false);
});

// --- the cascade ------------------------------------------------------------

test('dark inherits every token it does not override', () => {
  // .dark lists only what CHANGES — that is how the cascade is meant to be
  // used. Emitting dark's own keys alone would produce a palette full of holes
  // where the CSS has none, and the app would render black text on black.
  const { light, dark } = tokenSets(CSS);
  assert.equal(dark.background, '222 47% 4%', 'overridden');
  assert.equal(dark.primary, light.primary, 'not overridden — inherits light');
  assert.equal(dark['primary-foreground'], light['primary-foreground']);
});

test('every light colour has a Dark counterpart in the output', () => {
  const { dart } = generateDart(CSS);
  for (const name of ['background', 'foreground', 'primary', 'primaryForeground']) {
    assert.match(dart, new RegExp(`static const ${name} = Color`), name);
    assert.match(dart, new RegExp(`static const ${name}Dark = Color`), `${name}Dark`);
  }
});

test('a non-colour token becomes a metric, not a dropped token', () => {
  const { dart } = generateDart(CSS);
  assert.match(dart, /class AppMetrics \{[\s\S]*static const radius = 8\.0;/);
  // …and it is not silently emitted as a broken Color.
  assert.doesNotMatch(dart, /radius = Color/);
});

test('the class shape matches what patterns-mobile.md prescribes', () => {
  // The reference file shows AppColors with `xxxDark` siblings. A generator
  // that emitted some other shape would leave the docs describing a file
  // nothing produces.
  const { dart } = generateDart(CSS);
  assert.match(dart, /class AppColors \{/);
  assert.match(dart, /import 'package:flutter\/material\.dart';/);
  assert.match(dart, /DO NOT EDIT BY HAND/);
});

test('an unparseable token is reported, never guessed at', () => {
  const { skipped } = generateDart(':root { --shadow: 0 1px 2px rgba(0,0,0,.1); }');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /shadow/);
});

// --- cli --------------------------------------------------------------------

test('generate then --check is clean', () => {
  const { cssPath, out } = project();
  assert.equal(run([cssPath, '-o', out]).status, 0);
  assert.match(readFileSync(out, 'utf8'), /class AppColors/);
  assert.equal(run([cssPath, '-o', out, '--check']).status, 0);
});

test('--check fails once the Dart is edited by hand', () => {
  // This is the whole point: the rule "never hand-maintained beside it" was
  // unenforceable until something compared them.
  const { cssPath, out } = project();
  run([cssPath, '-o', out]);
  const edited = readFileSync(out, 'utf8').replace('0xFFFFFFFF', '0xFFEEEEEE');
  writeFileSync(out, edited);
  const res = run([cssPath, '-o', out, '--check']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /drifted/);
  assert.match(res.stderr, /CSS is the master/);
});

test('--check fails when the CSS moved on and nobody regenerated', () => {
  const { dir, cssPath, out } = project();
  run([cssPath, '-o', out]);
  writeFileSync(cssPath, CSS.replace('217 91% 60%', '10 90% 50%'));
  assert.equal(run([cssPath, '-o', out, '--check']).status, 1);
  // Regenerating settles it.
  assert.equal(run([cssPath, '-o', out]).status, 0);
  assert.equal(run([cssPath, '-o', out, '--check']).status, 0);
  assert.ok(dir);
});

test('--check on a file that was never generated says so, not "drifted"', () => {
  const { cssPath, out } = project();
  const res = run([cssPath, '-o', out, '--check']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /does not exist/);
});

test('a stylesheet with no tokens exits 2 rather than writing an empty theme', () => {
  const { dir } = project();
  const empty = join(dir, 'empty.css');
  writeFileSync(empty, 'body { color: red; }');
  const res = run([empty, '-o', join(dir, 'x.dart')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /look like success/);
});

test('a missing input file exits 2', () => {
  assert.equal(run(['/nope/tokens.css']).status, 2);
});

// --- where the file goes ----------------------------------------------------

test('a run without -o is refused rather than guessing a location', () => {
  // mkdirSync is recursive, so a guessed default of apps/mobile/… would CREATE
  // a phantom directory tree on a project with no Flutter at all — the gate's
  // old "no Flutter surface" bug, but writing to disk instead of misreading it.
  const { cssPath, dir } = project();
  const res = run([cssPath]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /-o is required/);
  assert.ok(!existsSync(join(dir, 'apps')), 'must not invent an apps/ tree');
});

test('the discovered suffix keeps the file inside lib/ under a design/ dir', () => {
  // Dart resolves library code relative to lib/, so a file at the repository
  // root is not importable; the design/ segment keeps the markup audit off it.
  // gate.mjs discovers exactly this suffix — the two must agree or generated
  // files stop being found.
  assert.equal(OUT_SUFFIX, 'lib/design/tokens.dart');
});

test('the generated Dart is exempt from the hardcoded-colour rule', () => {
  // It is full of Color(0xFF…) by design. The design/ path segment is what
  // keeps audit-markup.mjs off it — if that ever changed, every generated
  // token would become a finding and the gate would fail on its own output.
  const { cssPath, out } = project();
  run([cssPath, '-o', out]);
  const dir = join(out, '..', '..', '..');
  assert.deepEqual(collect(dir).filter((f) => f.path.endsWith('tokens.dart')), []);
});
