import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contrastRatio, hexToRgb, hslToRgb, parseColor,
  extractBlocks, checkCss, TEXT_MIN, UI_MIN,
} from '../scripts/contrast.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'contrast.mjs');

function run(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}
function runFailing(args) {
  try {
    execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  }
  throw new Error('expected non-zero exit');
}
function tmpCss(css) {
  const dir = mkdtempSync(join(tmpdir(), 'contrast-'));
  const p = join(dir, 'tokens.css');
  writeFileSync(p, css);
  return p;
}

test('known WCAG ratios are computed correctly', () => {
  // Black on white is the definitional maximum.
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
});

test('it reproduces the pro-max failure that motivated the gate', () => {
  // pro-max ships this as an On-Accent/Accent pair, i.e. as text.
  assert.equal(contrastRatio('#FFFFFF', '#3B82F6'), 3.68);
  assert.ok(contrastRatio('#FFFFFF', '#3B82F6') < TEXT_MIN);
  // It passes the UI threshold, which is exactly why it looks acceptable.
  assert.ok(contrastRatio('#FFFFFF', '#3B82F6') >= UI_MIN);
});

test('ratio is symmetric', () => {
  assert.equal(contrastRatio('#123456', '#FEDCBA'), contrastRatio('#FEDCBA', '#123456'));
});

test('hex parsing handles 3-digit, 6-digit and a missing hash', () => {
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#FFFFFF'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('000000'), [0, 0, 0]);
  assert.equal(hexToRgb('#12345'), null);
  assert.equal(hexToRgb('nonsense'), null);
});

test('hsl parsing handles the bare triplet elite actually uses', () => {
  // `--background: 0 0% 100%;` — no hsl() wrapper, no commas.
  assert.deepEqual(hslToRgb('0 0% 100%'), [255, 255, 255]);
  assert.deepEqual(hslToRgb('0 0% 0%'), [0, 0, 0]);
  assert.deepEqual(hslToRgb('hsl(0 0% 100%)'), [255, 255, 255]);
  assert.deepEqual(hslToRgb('0, 0%, 100%'), [255, 255, 255]);
  assert.deepEqual(hslToRgb('0 100% 50%'), [255, 0, 0]);
  assert.deepEqual(hslToRgb('120 100% 50%'), [0, 255, 0]);
  assert.deepEqual(hslToRgb('240 100% 50%'), [0, 0, 255]);
});

test('an hsl hue outside 0-360 wraps rather than parsing as garbage', () => {
  assert.deepEqual(hslToRgb('480 100% 50%'), hslToRgb('120 100% 50%'));
  assert.deepEqual(hslToRgb('-120 100% 50%'), hslToRgb('240 100% 50%'));
});

test('parseColor does not mistake a bare hex for an hsl triplet', () => {
  assert.deepEqual(parseColor('#0F172A'), [15, 23, 42]);
  assert.deepEqual(parseColor('222 47% 11%'), hslToRgb('222 47% 11%'));
});

test('light and dark blocks are extracted separately', () => {
  // Flattening them hides a failing dark palette entirely: the later
  // declaration simply wins and the earlier one is never tested.
  const blocks = extractBlocks(`
    :root { --background: 0 0% 100%; --foreground: 222 47% 11%; }
    .dark { --background: 222 47% 4%; --foreground: 210 40% 98%; }
  `);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].selector, ':root');
  assert.equal(blocks[1].selector, '.dark');
  assert.notEqual(blocks[0].tokens.background, blocks[1].tokens.background);
});

test('a failing dark block is caught even when light passes', () => {
  const results = checkCss(`
    :root { --background: #FFFFFF; --foreground: #0A0A0A; }
    .dark { --background: #3B82F6; --foreground: #FFFFFF; }
  `);
  const light = results.find((r) => r.selector === ':root' && r.fg === 'foreground');
  const dark = results.find((r) => r.selector === '.dark' && r.fg === 'foreground');
  assert.equal(light.pass, true);
  assert.equal(dark.pass, false);
});

test('a low-contrast border is advisory, not a failure', () => {
  // WCAG 1.4.11 covers borders that IDENTIFY a control, not decorative
  // separators. shadcn, Material and Tailwind all ship borders near 1.3:1;
  // failing them would fail every good design system on the first run.
  const results = checkCss(`
    :root {
      --background: #FFFFFF; --foreground: #0A0A0A;
      --border: #E4E4E7; --ring: #0A0A0A;
    }
  `);
  const border = results.find((r) => r.fg === 'border');
  assert.equal(border.advisory, true);
  assert.equal(border.meets, false);
  assert.equal(border.pass, true, 'an advisory pair must never fail the run');
});

test('a focus ring that blends into the background does fail', () => {
  // A ring below 3:1 is the same as having no visible focus state.
  const results = checkCss(`
    :root { --background: #FFFFFF; --foreground: #0A0A0A; --ring: #F2F2F2; }
  `);
  const ring = results.find((r) => r.fg === 'ring');
  assert.equal(ring.advisory, false);
  assert.equal(ring.pass, false);
});

test('a comment above a rule does not become part of its selector', () => {
  const blocks = extractBlocks(`
    /* Direction 11 — Clinical trust. */
    :root { --background: #FFF; --foreground: #000; }
  `);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].selector, ':root');
});

test('absent tokens are skipped rather than reported as failures', () => {
  const results = checkCss(':root { --background: #FFF; --foreground: #000; }');
  assert.equal(results.length, 1);
  assert.equal(results[0].fg, 'foreground');
});

test('the CLI exits 0 on a clean token file and 1 on a failing one', () => {
  const good = tmpCss(`
    :root {
      --background: 0 0% 100%; --foreground: 240 6% 4%;
      --primary: 240 6% 4%; --primary-foreground: 0 0% 100%;
      --ring: 240 6% 4%;
    }
  `);
  const out = run([good]);
  assert.match(out, /no failures/);

  const bad = tmpCss(`
    :root {
      --background: #FFFFFF; --foreground: #CCCCCC;
      --ring: #0A0A0A;
    }
  `);
  const { status, stderr } = runFailing([bad]);
  assert.equal(status, 1);
  assert.match(stderr, /below the floor/);
});

test('a token file with no recognised pairs exits 2 rather than passing', () => {
  // Silence would read as success. No checkable pairs means the file was not
  // written to elite's naming scheme.
  const odd = tmpCss(':root { --brand-blue: #3B82F6; --brand-ink: #0A0A0A; }');
  const { status, stderr } = runFailing([odd]);
  assert.equal(status, 2);
  assert.match(stderr, /no checkable token pairs/);
});

test('a missing file exits 2 rather than reporting a clean run', () => {
  const { status, stderr } = runFailing(['/nonexistent/tokens.css']);
  assert.equal(status, 2);
  assert.match(stderr, /no such file/);
});

test('--pair reports both thresholds and exits on the text one', () => {
  const out = run(['--pair', '#FFFFFF', '#0F172A']);
  assert.match(out, /17\.85:1/);
  const { status, stdout } = runFailing(['--pair', '#FFFFFF', '#3B82F6']);
  assert.equal(status, 1);
  assert.match(stdout, /text FAIL/);
  assert.match(stdout, /ui PASS/);
});

test('--json emits parseable output', () => {
  const good = tmpCss(':root { --background: #FFF; --foreground: #000; }');
  const parsed = JSON.parse(run([good, '--json']));
  assert.equal(parsed.results[0].ratio, 21);
});
