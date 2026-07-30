import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VIEWPORTS, TAP_MIN, IOS_ZOOM_FLOOR,
  resolvePlaywright, playwrightCandidates, targetUrl,
  summarise, darkModeFinding, safeJoin, serveDir, MIME,
} from '../scripts/responsive-check.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'responsive-check.mjs');

// Playwright is not a dependency of this repository, so the browser-backed
// tests skip rather than fail where it is absent — the same posture the script
// itself takes.
const HAS_PW = resolvePlaywright('.') !== null;

function run(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}
function fixture(html) {
  const dir = mkdtempSync(join(tmpdir(), 'resp-'));
  const p = join(dir, 'page.html');
  writeFileSync(p, html);
  return { dir, path: p };
}

// --- constants --------------------------------------------------------------

test('the three default widths include tablet', () => {
  // 768 is the width the gate calls out as most often skipped, so its presence
  // in the default set is load-bearing rather than incidental.
  assert.deepEqual(VIEWPORTS.map((v) => v.width), [320, 768, 1280]);
  assert.equal(VIEWPORTS.find((v) => v.width === 768).name, 'tablet');
  assert.equal(TAP_MIN, 44);
  assert.equal(IOS_ZOOM_FLOOR, 16);
});

// --- resolution -------------------------------------------------------------

test('playwright is looked for in the project before anywhere global', () => {
  // A project pinning its own version must win over whatever is installed
  // globally, or the check runs against a different browser than the tests do.
  const c = playwrightCandidates('/some/project');
  assert.match(c[0], /^\/some\/project\/node_modules\/playwright\//);
  assert.ok(c.length >= 2);
});

test('resolvePlaywright returns null for a directory with none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nopw-'));
  const found = playwrightCandidates(dir).filter((p) => p.startsWith(dir));
  assert.equal(found.some(existsSync), false);
});

test('targetUrl accepts a URL, a real file, and rejects a missing path', () => {
  assert.equal(targetUrl('https://example.com/x'), 'https://example.com/x');
  const { path } = fixture('<p>hi</p>');
  assert.match(targetUrl(path), /^file:\/\//);
  assert.equal(targetUrl('/definitely/not/here.html'), null);
});

// --- dedupe -----------------------------------------------------------------

test('a finding present in both schemes is reported once', () => {
  // Layout rarely changes with the colour scheme, so reporting every overflow
  // twice doubles the report for no added information.
  const f = { rule: 'page-overflow', severity: 'error', text: 'scrolls to 900px', why: 'x' };
  const s = summarise([
    { viewport: 'mobile', scheme: 'light', findings: [f] },
    { viewport: 'mobile', scheme: 'dark', findings: [f] },
  ]);
  assert.equal(s.findings.length, 1);
  assert.equal(s.findings[0].scheme, 'light');
  assert.equal(s.errors, 1);
});

test('a finding that appears only in dark is kept and labelled', () => {
  // This is the case the dark pass exists for — dropping it would make the
  // second pass pure cost.
  const s = summarise([
    { viewport: 'mobile', scheme: 'light', findings: [] },
    { viewport: 'mobile', scheme: 'dark', findings: [
      { rule: 'tap-target', severity: 'error', text: 'button is 20×20', why: 'too small' }] },
  ]);
  assert.equal(s.findings.length, 1);
  assert.equal(s.findings[0].scheme, 'dark');
  assert.match(s.findings[0].why, /only in dark mode/);
});

test('the same rule at a different viewport is not deduped away', () => {
  const f = { rule: 'page-overflow', severity: 'error', text: 'scrolls', why: 'x' };
  const s = summarise([
    { viewport: 'mobile', scheme: 'light', findings: [f] },
    { viewport: 'tablet', scheme: 'light', findings: [f] },
  ]);
  assert.equal(s.findings.length, 2);
});

test('warnings are counted separately from errors', () => {
  const s = summarise([{ viewport: 'mobile', scheme: 'light', findings: [
    { rule: 'a', severity: 'error', text: 't', why: 'w' },
    { rule: 'b', severity: 'warn', text: 't', why: 'w' },
  ] }]);
  assert.equal(s.errors, 1);
  assert.equal(s.warns, 1);
});

// --- dark mode --------------------------------------------------------------

test('identical body rendering under both schemes is a dark-mode failure', () => {
  // "A .dark block exists in the CSS" and "dark mode is wired up" are
  // different claims, and only the second one matters to a user.
  const same = { bodyBackground: 'rgb(255, 255, 255)', bodyColor: 'rgb(0, 0, 0)' };
  const f = darkModeFinding(same, { ...same });
  assert.equal(f.rule, 'dark-mode-missing');
  assert.equal(f.severity, 'error');
});

test('a different background under dark is not flagged', () => {
  const f = darkModeFinding(
    { bodyBackground: 'rgb(255, 255, 255)', bodyColor: 'rgb(0, 0, 0)' },
    { bodyBackground: 'rgb(8, 20, 27)', bodyColor: 'rgb(234, 242, 246)' });
  assert.equal(f, null);
});

test('a change in text colour alone still counts as dark mode', () => {
  const f = darkModeFinding(
    { bodyBackground: 'rgb(255, 255, 255)', bodyColor: 'rgb(0, 0, 0)' },
    { bodyBackground: 'rgb(255, 255, 255)', bodyColor: 'rgb(200, 200, 200)' });
  assert.equal(f, null);
});

// --- cli argument handling --------------------------------------------------

test('no target exits 2 with usage', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test('a missing file exits 2', () => {
  const r = run(['/definitely/not/here.html']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no such file/);
});

test('a nonsense width exits 2 rather than launching a browser', () => {
  const { path } = fixture('<p>hi</p>');
  const r = run([path, '--widths', 'wide,tiny', '--no-shots']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /comma-separated pixel numbers/);
});

// --- the static server ------------------------------------------------------

test('safeJoin refuses anything that escapes the root', () => {
  // `..` in a URL is the oldest static-server bug there is, and this server is
  // pointed at a build directory on someone's own machine.
  assert.equal(safeJoin('/tmp/root', '/../etc/passwd'), null);
  assert.equal(safeJoin('/tmp/root', '/..%2F..%2Fetc/passwd'), null);
  assert.equal(safeJoin('/tmp/root', '/a/../../b'), null);
  assert.equal(safeJoin('/tmp/root', '/assets/app.css'), '/tmp/root/assets/app.css');
  assert.equal(safeJoin('/tmp/root', '/'), '/tmp/root');
});

test('safeJoin is not fooled by a sibling directory sharing the prefix', () => {
  // /tmp/root-evil starts with /tmp/root as a string but is not inside it.
  assert.equal(safeJoin('/tmp/root', '/../root-evil/x'), null);
});

test('query strings are stripped before resolving a path', () => {
  assert.equal(safeJoin('/tmp/root', '/app.css?v=2'), '/tmp/root/app.css');
});

test('the server serves files, falls back to index.html, and stops', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<p>home</p>');
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{}');

  const server = await serveDir(dir);
  try {
    assert.equal(await (await fetch(`${server.url}/`)).text(), '<p>home</p>');

    const css = await fetch(`${server.url}/assets/app.css`);
    assert.equal(css.headers.get('content-type'), MIME['.css']);
    assert.equal(await css.text(), 'body{}');

    // A client-side router owns deep links, so a miss serves index.html —
    // the same rule the generated nginx config uses. Without it, every route
    // but the root would 404 and the check would report a blank page.
    assert.equal(await (await fetch(`${server.url}/students/42`)).text(), '<p>home</p>');
  } finally {
    await server.close();
  }
});

test('two servers can run at once without colliding', async () => {
  // Port 0 lets the OS choose, so a second run in another terminal does not
  // fail on an address already in use.
  const dir = mkdtempSync(join(tmpdir(), 'serve2-'));
  writeFileSync(join(dir, 'index.html'), '<p>x</p>');
  const [a, b] = [await serveDir(dir), await serveDir(dir)];
  try {
    assert.notEqual(a.url, b.url);
  } finally {
    await a.close();
    await b.close();
  }
});

test('--serve pointed at a source directory is refused', () => {
  // Serving src/ would render nothing and report zero findings, which is the
  // most convincing possible false pass.
  const dir = mkdtempSync(join(tmpdir(), 'nosrc-'));
  writeFileSync(join(dir, 'App.tsx'), 'export default 1;');
  const r = run(['--serve', dir, '--no-shots']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no index\.html/);
  assert.match(r.stderr, /static build/);
});

test('--serve pointed at .next says what to do instead', () => {
  // .next IS build output, so the generic "point at the build output" message
  // reads as advice already taken. It is a server's working directory rather
  // than a servable tree, and the fix is a different command entirely.
  const dir = mkdtempSync(join(tmpdir(), 'nextish-'));
  mkdirSync(join(dir, '.next'), { recursive: true });
  const r = run(['--serve', join(dir, '.next'), '--no-shots']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not statically servable/);
  assert.match(r.stderr, /npm run start/);
});

test('--serve on a missing directory is refused', () => {
  const r = run(['--serve', '/definitely/not/here', '--no-shots']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a directory/);
});

// --- browser-backed ---------------------------------------------------------

const BAD = `<style>
  body { margin:0; background:#fff; color:#111; }
  .wide { width: 900px; }
  .scroller { overflow-x: auto; }
  .scroller table { width: 900px; }
  button.tiny { width:20px; height:20px; }
  input { font-size: 13px; }
</style>
<div class="wide">forces overflow</div>
<div class="scroller"><table><tr><td>wide but contained</td></tr></table></div>
<button class="tiny">x</button>
<label for="e">Email</label><input id="e" type="email">
<p>Read the <a href="#x">documentation</a> for more detail, which is inline body copy here.</p>`;

const GOOD = `<style>
  :root { --bg:#fff; --fg:#10202B; }
  @media (prefers-color-scheme: dark) { :root { --bg:#08141B; --fg:#EAF2F6; } }
  body { margin:0; background:var(--bg); color:var(--fg); font-size:16px; }
  .wrap { max-width:100%; padding:16px; }
  .scroller { overflow-x:auto; }
  .scroller table { width:900px; }
  button { min-width:44px; min-height:44px; font-size:16px; }
  input { font-size:16px; min-height:44px; }
</style>
<div class="wrap">
  <div class="scroller"><table><tr><td>wide but contained</td></tr></table></div>
  <button>Go</button>
  <label for="e">Email</label><input id="e" type="email">
  <p>Read the <a href="#x">docs</a> for detail; this is inline body copy of reasonable length.</p>
</div>`;

test('a page with real responsive failures is caught', { skip: !HAS_PW && 'playwright not installed' }, () => {
  const { path } = fixture(BAD);
  const r = run([path, '--widths', '320', '--no-shots', '--json']);
  assert.equal(r.status, 1);
  const rules = JSON.parse(r.stdout).findings.map((f) => f.rule);
  assert.ok(rules.includes('page-overflow'), rules.join(','));
  assert.ok(rules.includes('overflow-culprit'), rules.join(','));
  assert.ok(rules.includes('tap-target'), rules.join(','));
  assert.ok(rules.includes('ios-zoom-font'), rules.join(','));
  assert.ok(rules.includes('dark-mode-missing'), rules.join(','));
});

test('content inside an overflow-x container is not blamed', { skip: !HAS_PW && 'playwright not installed' }, () => {
  // Wrapping wide content in an overflow-x:auto container is the fix the docs
  // prescribe. Reporting it would mean the report punishes the correct answer.
  const { path } = fixture(GOOD);
  const r = run([path, '--widths', '320', '--no-shots', '--json']);
  const findings = JSON.parse(r.stdout).findings;
  assert.deepEqual(findings.filter((f) => f.rule === 'overflow-culprit'), []);
  assert.deepEqual(findings.filter((f) => f.rule === 'page-overflow'), []);
});

test('an inline link in body copy is not a tap-target failure', { skip: !HAS_PW && 'playwright not installed' }, () => {
  // WCAG 2.5.8 exempts targets inside a sentence. Without this, every page
  // with prose reports dozens of failures and the check becomes unusable.
  const { path } = fixture(GOOD);
  const r = run([path, '--widths', '320', '--no-shots', '--json']);
  const tap = JSON.parse(r.stdout).findings.filter((f) => f.rule === 'tap-target');
  assert.deepEqual(tap, [], JSON.stringify(tap));
});

test('a compliant page passes at every width in both schemes', { skip: !HAS_PW && 'playwright not installed' }, () => {
  const { path } = fixture(GOOD);
  const r = run([path, '--no-shots']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Nothing to fix/);
  assert.match(r.stdout, /3 width\(s\) × 2 schemes/);
});

test('--serve checks a built directory end to end', { skip: !HAS_PW && 'playwright not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'built-'));
  writeFileSync(join(dir, 'index.html'), GOOD);
  const r = run(['--serve', dir, '--no-shots']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Nothing to fix/);
});

test('screenshots are written per width and scheme', { skip: !HAS_PW && 'playwright not installed' }, () => {
  const { dir, path } = fixture(GOOD);
  const out = join(dir, 'shots');
  const r = run([path, '--widths', '320,768', '--out', out]);
  assert.equal(r.status, 0);
  const files = readdirSync(out).sort();
  // Two widths in two schemes — the dark shots are the artefact that makes a
  // dark-mode review possible at all.
  assert.deepEqual(files, ['320px-dark.png', '320px-light.png', '768px-dark.png', '768px-light.png']);
});
