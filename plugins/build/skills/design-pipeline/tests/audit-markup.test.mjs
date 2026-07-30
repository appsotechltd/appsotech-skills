import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { auditFile, auditFiles, extractTags, collect } from '../scripts/audit-markup.mjs';

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
