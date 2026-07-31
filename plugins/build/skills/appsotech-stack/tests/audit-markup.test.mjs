import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  auditFile, auditFiles, extractTags, collect, isNextRouteFile, dartCallArgs,
} from '../scripts/audit-markup.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'audit-markup.mjs');

const audit = (path, content) => auditFile({ path, content });
const rules = (path, content) => audit(path, content).map((f) => f.rule);

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function runCli(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

// --- the tag scanner --------------------------------------------------------

test('a JSX arrow function inside an attribute does not truncate the tag', () => {
  // /<div[^>]*>/ stops at the `>` in `() =>`, so the onClick is never seen and
  // the exact bug this file exists to catch reads as clean.
  const tags = extractTags('<div onClick={() => doThing()} className="x">hi</div>', ['div']);
  assert.equal(tags.length, 1);
  assert.match(tags[0].attrs, /onClick/);
  assert.match(tags[0].attrs, /className/);
});

test('the scanner reports the correct line for a multi-line tag', () => {
  const tags = extractTags('\n\n<img\n  src="a.png"\n/>', ['img']);
  assert.equal(tags[0].line, 3);
});

test('the scanner does not match a tag whose name merely starts the same', () => {
  assert.equal(extractTags('<division />', ['div']).length, 0);
  assert.equal(extractTags('<img />', ['img']).length, 1);
});

// --- hardcoded colour -------------------------------------------------------

test('a hex colour in a component is an error', () => {
  const found = audit('src/Card.tsx', 'const c = "#3B82F6";');
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'hardcoded-colour');
  assert.equal(found[0].severity, 'error');
});

test('hsl(var(--token)) is the correct pattern and is never flagged', () => {
  // A bare search for "hsl(" would fire on every correctly-written file, which
  // is the fastest way to get the whole audit ignored.
  assert.deepEqual(rules('src/a.css', '.x { color: hsl(var(--primary)); }'), []);
  assert.deepEqual(rules('src/b.css', '.x { color: hsl(var(--primary) / 0.9); }'), []);
});

test('a literal hsl() or rgb() is flagged', () => {
  assert.ok(rules('src/a.css', '.x { color: hsl(222 47% 11%); }').includes('hardcoded-colour'));
  assert.ok(rules('src/b.css', '.x { color: rgba(0,0,0,.5); }').includes('hardcoded-colour'));
});

test('anchors and SVG references are not mistaken for colours', () => {
  assert.deepEqual(rules('src/a.tsx', '<a href="#abc">x</a>'), []);
  assert.deepEqual(rules('src/b.tsx', '<use xlink:href="#icon" />'), []);
  assert.deepEqual(rules('src/c.css', '.x { fill: url(#grad); }'), []);
});

test('an HTML entity is not read as a colour', () => {
  assert.deepEqual(rules('src/a.tsx', '<p>&#123;</p>'), []);
});

test('Flutter Color literals are flagged, and only in .dart', () => {
  const found = audit('lib/card.dart', 'const c = Color(0xFF3B82F6);');
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'hardcoded-colour');
});

test('the design/ directory is exempt, since tokens live there', () => {
  const dir = project({
    'design/tokens.css': ':root { --primary: #0F172A; }',
    'src/ok.tsx': 'export const x = 1;',
  });
  assert.deepEqual(collect(dir).map((f) => f.path), ['src/ok.tsx']);
});

test('a token declaration is where raw colour belongs and is exempt', () => {
  // Caught by running all three gates against a page the skill itself
  // prescribes: for a single-file prototype there is no design/ to write to,
  // so the :root and .dark blocks go inline at the top of the artefact — and
  // the audit was flagging that prescribed answer as four errors.
  assert.deepEqual(rules('index.html', ':root { --bg: #FFFFFF; --fg: #10202B; }'), []);
  assert.deepEqual(rules('a.css', '.dark { --background: #08141B; }'), []);
  // hsl() and rgb() in a declaration are token definitions too.
  assert.deepEqual(rules('b.css', ':root { --primary: hsl(222 47% 11%); }'), []);
});

test('a colour used in a normal property is still an error', () => {
  assert.ok(rules('a.css', '.btn { color: #3B82F6; }').includes('hardcoded-colour'));
  // And the exemption does not leak across declarations on one line.
  const mixed = audit('a.css', ':root { --bg: #FFFFFF; color: #3B82F6; }');
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].text, '#3B82F6');
});

test('a design-ok comment suppresses the line', () => {
  assert.deepEqual(rules('src/a.tsx', 'const brand = "#3B82F6"; // design-ok: vendor logo'), []);
  // And on the line above, for cases where the line itself is full.
  assert.deepEqual(rules('src/b.tsx', '// design-ok\nconst brand = "#3B82F6";'), []);
});

// --- dynamic tailwind -------------------------------------------------------

test('a dynamic Tailwind class is an error but a static one is not', () => {
  assert.ok(rules('src/a.tsx', 'const c = `bg-${color}-500`;').includes('dynamic-tailwind-class'));
  assert.ok(!rules('src/b.tsx', 'const c = "bg-blue-500";').includes('dynamic-tailwind-class'));
  // An object map is the prescribed fix and must stay clean.
  assert.ok(!rules('src/c.tsx', 'const m = { blue: "bg-blue-500" };').includes('dynamic-tailwind-class'));
});

// --- non-semantic click -----------------------------------------------------

test('a div with onClick and nothing else is an error', () => {
  assert.ok(rules('src/a.tsx', '<div onClick={go}>Go</div>').includes('non-semantic-click'));
});

test('a properly built div control is exempt', () => {
  // role + tabIndex + key handler is a real, accessible control. Flagging it
  // would punish the correct fix.
  const src = '<div role="button" tabIndex={0} onClick={go} onKeyDown={k}>Go</div>';
  assert.ok(!rules('src/a.tsx', src).includes('non-semantic-click'));
});

test('a real button is never flagged', () => {
  assert.deepEqual(rules('src/a.tsx', '<button onClick={go}>Go</button>'), []);
});

// --- images and inputs ------------------------------------------------------

test('an img without alt is an error and alt="" is accepted', () => {
  assert.ok(rules('src/a.tsx', '<img src="x.png" />').includes('img-missing-alt'));
  assert.ok(!rules('src/b.tsx', '<img src="x.png" alt="" />').includes('img-missing-alt'));
  assert.ok(!rules('src/c.tsx', '<img src="x.png" alt="A cat" />').includes('img-missing-alt'));
});

test('an input with a bound label elsewhere in the file is exempt', () => {
  // The correct pattern spans two elements; checking the tag alone would
  // report every well-formed form in the codebase.
  const good = '<label htmlFor="email">Email</label>\n<input id="email" type="email" />';
  assert.ok(!rules('src/a.tsx', good).includes('input-missing-label'));

  const orphan = '<label htmlFor="other">Other</label>\n<input id="email" type="email" />';
  assert.ok(rules('src/b.tsx', orphan).includes('input-missing-label'));
});

test('aria-label satisfies the input rule, and a placeholder does not', () => {
  assert.ok(!rules('src/a.tsx', '<input aria-label="Search" />').includes('input-missing-label'));
  assert.ok(rules('src/b.tsx', '<input placeholder="Search" />').includes('input-missing-label'));
});

test('hidden and submit inputs are not expected to have labels', () => {
  assert.ok(!rules('src/a.tsx', '<input type="hidden" name="t" />').includes('input-missing-label'));
  assert.ok(!rules('src/b.tsx', '<input type="submit" value="Go" />').includes('input-missing-label'));
});

// --- fonts ------------------------------------------------------------------

test('a banned face is flagged only as the primary, not as a fallback', () => {
  assert.ok(rules('src/a.css', 'body { font-family: Inter, sans-serif; }')
    .includes('banned-display-font'));
  // Arial deep in a fallback stack is correct practice.
  assert.ok(!rules('src/b.css', 'body { font-family: "Work Sans", Arial, sans-serif; }')
    .includes('banned-display-font'));
});

// --- focus ------------------------------------------------------------------

test('outline:none is an error alone and a warning where focus styling exists', () => {
  const bare = audit('src/a.css', '.b { outline: none; }');
  assert.equal(bare[0].severity, 'error');

  const replaced = audit('src/b.css', '.b { outline: none; }\n.b:focus-visible { outline: 2px solid; }');
  assert.equal(replaced.find((f) => f.rule === 'outline-none').severity, 'warn');
});

// --- motion -----------------------------------------------------------------

test('animating layout properties warns without failing the run', () => {
  const found = audit('src/a.css', '.x { transition: width 200ms; }');
  const f = found.find((r) => r.rule === 'layout-animation');
  assert.equal(f.severity, 'warn');
  assert.ok(!rules('src/b.css', '.x { transition: opacity 200ms; }').includes('layout-animation'));
});

// --- cli --------------------------------------------------------------------

test('the CLI exits 1 on errors and 0 on a clean project', () => {
  const bad = project({ 'src/a.tsx': '<img src="x.png" />' });
  assert.equal(runCli([bad]).status, 1);

  const good = project({ 'src/a.tsx': '<img src="x.png" alt="x" />' });
  const clean = runCli([good]);
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /Nothing to fix/);
});

test('warnings alone do not fail the run', () => {
  const dir = project({ 'src/a.css': '.x { transition: width 200ms; }' });
  const res = runCli([dir]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /1 warning/);
});

test('--warn-only downgrades errors so the audit can be surveyed first', () => {
  const dir = project({ 'src/a.tsx': '<img src="x.png" />' });
  assert.equal(runCli([dir]).status, 1);
  assert.equal(runCli([dir, '--warn-only']).status, 0);
});

test('scanning a directory with no source exits 2 rather than reporting clean', () => {
  // Zero findings on the wrong path is indistinguishable from success, and
  // that is the failure mode most likely to go unnoticed.
  const dir = project({ 'notes.md': '# hello' });
  const res = runCli([dir]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /No source files matched/);
});

test('a missing directory exits 2', () => {
  const res = runCli(['/nonexistent/place']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such directory/);
});

test('--json emits parseable output', () => {
  const dir = project({ 'src/a.tsx': '<img src="x.png" />' });
  const res = runCli([dir, '--json']);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.findings[0].rule, 'img-missing-alt');
  assert.equal(parsed.scanned, 1);
});

test('node_modules and build output are never scanned', () => {
  const dir = project({
    'node_modules/pkg/index.js': 'const c = "#3B82F6";',
    'dist/bundle.js': 'const c = "#3B82F6";',
    'src/a.tsx': 'export const x = 1;',
  });
  assert.deepEqual(collect(dir).map((f) => f.path), ['src/a.tsx']);
});

test('findings come back sorted by file and line', () => {
  const found = auditFiles([
    { path: 'src/b.tsx', content: '<img src="x" />' },
    { path: 'src/a.tsx', content: '\n<img src="x" />' },
  ]);
  assert.deepEqual(found.map((f) => f.file), ['src/a.tsx', 'src/b.tsx']);
});

test('every finding carries a rule, a line and a reason', () => {
  // The report is the product. A finding with no explanation gets dismissed.
  const found = audit('src/a.tsx', '<div onClick={go}>x</div>');
  for (const f of found) {
    assert.ok(f.rule && f.file && f.line > 0 && f.why, JSON.stringify(f));
    assert.ok(['error', 'warn'].includes(f.severity));
  }
});

// --- hero: viewport units ---------------------------------------------------

test('100vh is flagged, and only as a warning', () => {
  // Not an error: 100vh is defensible on a desktop app shell or a modal, and a
  // rule that fires on those is one people learn to skip.
  const found = audit('src/Hero.tsx', '<section style={{ minHeight: "100vh" }} />');
  const f = found.find((x) => x.rule === 'viewport-height-unit');
  assert.ok(f, 'expected the 100vh finding');
  assert.equal(f.severity, 'warn');
  assert.match(f.why, /svh/);
});

test('Tailwind h-screen and min-h-screen are the same bug and are caught', () => {
  // This is where it actually appears in this stack — h-screen compiles to
  // height: 100vh, so a rule that only reads raw CSS would miss every case.
  assert.ok(rules('src/Hero.tsx', '<div className="min-h-screen" />')
    .includes('viewport-height-unit'));
  assert.ok(rules('src/Hero.tsx', '<div className="h-screen" />')
    .includes('viewport-height-unit'));
});

test('the already-correct units are never flagged', () => {
  // Firing on the prescribed answer is the failure mode that matters most.
  for (const src of [
    '<div style={{ minHeight: "100svh" }} />',
    '<div style={{ minHeight: "100dvh" }} />',
    '<div className="min-h-svh" />',
    '<div className="min-h-dvh" />',
  ]) {
    assert.deepEqual(
      rules('src/Hero.tsx', src).filter((r) => r === 'viewport-height-unit'), [],
      `should not fire on ${src}`);
  }
});

// --- hero: three in a route bundle ------------------------------------------

test('three imported straight into a Next route file is an error', () => {
  const found = audit('apps/tenant-web/app/page.tsx',
    "import { Canvas } from '@react-three/fiber';\nexport default function P() { return <Canvas />; }");
  const f = found.find((x) => x.rule === 'static-3d-import');
  assert.ok(f, 'expected the static import finding');
  assert.equal(f.severity, 'error');
  assert.match(f.why, /next\/dynamic/);
});

test('the same import in a scene component is correct and is not flagged', () => {
  // This is the file next/dynamic loads. Flagging it would flag the answer.
  assert.deepEqual(
    rules('apps/tenant-web/components/HeroScene.tsx',
      "import { Canvas } from '@react-three/fiber';\nconst reduce = useReducedMotion();")
      .filter((r) => r === 'static-3d-import'), []);
});

test('a route file that loads the scene dynamically passes', () => {
  const src = "import dynamic from 'next/dynamic';\n" +
    "const Scene = dynamic(() => import('./HeroScene'), { ssr: false });";
  assert.deepEqual(
    rules('app/page.tsx', src).filter((r) => r === 'static-3d-import'), []);
});

test('route-file detection covers layouts and pages/ but not pages/api', () => {
  assert.equal(isNextRouteFile('app/page.tsx'), true);
  assert.equal(isNextRouteFile('app/(marketing)/about/page.tsx'), true);
  assert.equal(isNextRouteFile('app/layout.tsx'), true);
  assert.equal(isNextRouteFile('apps/tenant-web/app/blog/layout.jsx'), true);
  assert.equal(isNextRouteFile('pages/index.tsx'), true);
  // An API route ships no client bundle, so the rule has nothing to say there.
  assert.equal(isNextRouteFile('pages/api/hook.ts'), false);
  assert.equal(isNextRouteFile('components/HeroScene.tsx'), false);
  assert.equal(isNextRouteFile('src/app-shell/Widget.tsx'), false);
});

// --- hero: ambient motion and reduced motion --------------------------------

test('an R3F scene with no reduced-motion path is an error', () => {
  const found = audit('src/HeroScene.tsx',
    "import { Canvas, useFrame } from '@react-three/fiber';\nexport const S = () => <Canvas />;");
  const f = found.find((x) => x.rule === 'ambient-motion-no-reduced-motion');
  assert.ok(f, 'expected the reduced-motion finding');
  assert.equal(f.severity, 'error');
  assert.match(f.why, /zero/);
});

test('a hand-rolled 2D particle canvas is caught too, not just WebGL', () => {
  // The recommendation for plain particle fields is a 2D context and no
  // library at all, so a rule that only knew about three would miss the case
  // the skill actually prescribes.
  const src = "const ctx = ref.current.getContext('2d');\n" +
    'const loop = () => { draw(); requestAnimationFrame(loop); };';
  assert.ok(rules('src/Particles.tsx', src)
    .includes('ambient-motion-no-reduced-motion'));
});

test('the prescribed answer satisfies the rule, by either hook or media query', () => {
  const scene = "import { Canvas } from '@react-three/fiber';\n";
  assert.deepEqual(
    rules('src/HeroScene.tsx', scene + 'const reduce = useReducedMotion();')
      .filter((r) => r === 'ambient-motion-no-reduced-motion'), []);
  assert.deepEqual(
    rules('src/HeroScene.tsx',
      scene + "const m = matchMedia('(prefers-reduced-motion: reduce)');")
      .filter((r) => r === 'ambient-motion-no-reduced-motion'), []);
});

test('requestAnimationFrame without a canvas is not an animation', () => {
  // rAF throttles scroll handlers and defers measurement far more often than
  // it drives animation. Firing here would be the classic imprecise rule.
  const src = 'const onScroll = () => requestAnimationFrame(() => measure());';
  assert.deepEqual(
    rules('src/useScroll.ts', src)
      .filter((r) => r === 'ambient-motion-no-reduced-motion'), []);
});

test('a canvas drawn once, with no loop, is not ambient motion', () => {
  const src = "const ctx = c.getContext('2d');\nctx.fillRect(0, 0, 10, 10);";
  assert.deepEqual(
    rules('src/Sparkline.tsx', src)
      .filter((r) => r === 'ambient-motion-no-reduced-motion'), []);
});

test('design-ok suppresses each of the three hero rules', () => {
  const cases = [
    ['src/Hero.tsx', '<div className="min-h-screen" /> {/* design-ok */}', 'viewport-height-unit'],
    ['app/page.tsx', "import { Canvas } from '@react-three/fiber'; // design-ok", 'static-3d-import'],
    ['src/S.tsx', "import { Canvas } from '@react-three/fiber'; // design-ok", 'ambient-motion-no-reduced-motion'],
  ];
  for (const [path, src, rule] of cases) {
    assert.deepEqual(rules(path, src).filter((r) => r === rule), [], rule);
  }
});

// --- Flutter ----------------------------------------------------------------

test('a bare Material colour is the Dart hardcoded colour', () => {
  const found = audit('lib/card.dart', 'color: Colors.blue,');
  const f = found.find((x) => x.rule === 'bare-material-colour');
  assert.ok(f);
  assert.equal(f.severity, 'error');
  assert.match(f.why, /dark mode/);
});

test('Colors.transparent is structural, not a palette choice', () => {
  assert.deepEqual(
    rules('lib/card.dart', 'color: Colors.transparent,')
      .filter((r) => r === 'bare-material-colour'), []);
});

test('the frozen palette and the theme are both the correct answer', () => {
  // These are what the skill prescribes. Flagging either would flag the fix.
  for (const src of [
    'color: AppColors.primary,',
    'color: Theme.of(context).colorScheme.primary,',
  ]) {
    assert.deepEqual(audit('lib/card.dart', src), [], src);
  }
});

test('Color(0x…) is still caught alongside the new rules', () => {
  // The one rule Dart had before must not have been displaced by them.
  assert.ok(rules('lib/card.dart', 'color: Color(0xFF3B82F6),')
    .includes('hardcoded-colour'));
});

test('MediaQuery used as a breakpoint is a warning', () => {
  const found = audit('lib/home.dart',
    'if (MediaQuery.of(context).size.width > 600) return Wide();');
  const f = found.find((x) => x.rule === 'mediaquery-breakpoint');
  assert.ok(f);
  assert.equal(f.severity, 'warn');
  assert.match(f.why, /LayoutBuilder/);
  // The newer sizeOf form is the same mistake.
  assert.ok(rules('lib/home.dart', 'MediaQuery.sizeOf(context).width >= 900')
    .includes('mediaquery-breakpoint'));
});

test('MediaQuery for anything other than a breakpoint is left alone', () => {
  // Padding, insets and text scale are all legitimate reads. Only a
  // comparison against a literal is a breakpoint.
  for (const src of [
    'final pad = MediaQuery.of(context).padding.top;',
    'final w = MediaQuery.of(context).size.width;',
    'final scale = MediaQuery.textScalerOf(context);',
  ]) {
    assert.deepEqual(
      rules('lib/home.dart', src).filter((r) => r === 'mediaquery-breakpoint'), [],
      src);
  }
});

test('an image with no semantics is the Dart missing-alt', () => {
  const found = audit('lib/hero.dart', "Image.asset('assets/hero.png')");
  const f = found.find((x) => x.rule === 'image-missing-semantics');
  assert.ok(f);
  assert.equal(f.severity, 'error');
});

test('semanticLabel and excludeFromSemantics are both accepted', () => {
  // excludeFromSemantics is the deliberate decorative marker — alt="" in Dart.
  for (const src of [
    "Image.asset('a.png', semanticLabel: 'A chart of monthly revenue')",
    "Image.network(url, excludeFromSemantics: true)",
  ]) {
    assert.deepEqual(
      rules('lib/hero.dart', src).filter((r) => r === 'image-missing-semantics'),
      [], src);
  }
});

test('a nested call inside the arguments does not truncate the scan', () => {
  // The reason dartCallArgs tracks paren depth: a naive /\([^)]*\)/ stops at
  // the first inner close paren and reports a labelled image as unlabelled.
  const src = "Image.asset(join('assets', 'hero.png'), semanticLabel: 'Team photo')";
  assert.deepEqual(
    rules('lib/hero.dart', src).filter((r) => r === 'image-missing-semantics'), []);
  assert.equal(dartCallArgs('f(a, g(b), c)', 1), 'a, g(b), c');
});

test('GestureDetector with no Semantics anywhere in the file warns', () => {
  const found = audit('lib/tile.dart', 'GestureDetector(onTap: open, child: Text("Open"))');
  const f = found.find((x) => x.rule === 'gesture-without-semantics');
  assert.ok(f);
  assert.equal(f.severity, 'warn');
});

test('a wrapped GestureDetector, and InkWell, are both correct', () => {
  assert.deepEqual(
    rules('lib/tile.dart',
      'Semantics(button: true, label: "Open", child: GestureDetector(onTap: open))')
      .filter((r) => r === 'gesture-without-semantics'), []);
  // InkWell carries its own semantics, so it was never in scope.
  assert.deepEqual(
    rules('lib/tile.dart', 'InkWell(onTap: open, child: Text("Open"))')
      .filter((r) => r === 'gesture-without-semantics'), []);
});

test('a GestureDetector with no onTap is not a control', () => {
  assert.deepEqual(
    rules('lib/pan.dart', 'GestureDetector(onPanUpdate: move, child: Canvas())')
      .filter((r) => r === 'gesture-without-semantics'), []);
});

test('Dart files are never run through the web rules', () => {
  // `100vh` in a Dart string, or the word Image, must not pull in a rule
  // written for JSX.
  const found = audit('lib/x.dart', 'const s = "100vh"; // <img>');
  assert.deepEqual(found.filter((f) => f.rule === 'viewport-height-unit'), []);
  assert.deepEqual(found.filter((f) => f.rule === 'img-missing-alt'), []);
});

test('design-ok suppresses the Dart rules too', () => {
  assert.deepEqual(
    rules('lib/card.dart', 'color: Colors.blue, // design-ok')
      .filter((r) => r === 'bare-material-colour'), []);
});
