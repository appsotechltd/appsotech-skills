#!/usr/bin/env node
// Contrast gate for a frozen token file.
//
//   contrast.mjs design/tokens.css [--json]
//   contrast.mjs --pair "#FFFFFF" "#3B82F6"
//
// This exists because pro-max palettes are NOT contrast-safe by construction.
// It ships On-X/X pairs that read as authoritative and sometimes fail 4.5:1 —
// its own CRM palette pairs #FFFFFF on #3B82F6 at 3.68:1. That clears the 3:1
// UI threshold and fails body text, so a button using it is non-compliant the
// moment it is used as intended.
//
// Run at freeze time, not just at the gate. At freeze it is one token to fix;
// at the gate it is an audit of every component that consumed it.

import { readFileSync, existsSync } from 'node:fs';

// WCAG 2.1 AA. Text needs 4.5:1; UI components, icons and focus indicators
// need 3:1. Large text (18pt+, or 14pt bold) may use 3:1, but a token file
// cannot know which pairs end up large — so every text pair is held to 4.5
// and the exceptions are argued in review, not assumed here.
export const TEXT_MIN = 4.5;
export const UI_MIN = 3;

// Pairs implied by elite's token names. Each foreground token exists to be
// rendered on its matching background, so the pairing is not a guess.
export const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'muted'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
];

// Focus indicators are required to be perceivable — WCAG 2.4.11 and 1.4.11
// name them explicitly. A ring that blends into the background is the same as
// no visible focus state, so this fails the run.
export const UI_PAIRS = [
  ['ring', 'background'],
];

// Advisory only, and deliberately NOT a failure.
//
// WCAG 1.4.11 requires 3:1 for visual information needed to IDENTIFY a control
// or its state. A decorative separator between a card and the page is not
// that, and essentially every mainstream token set — shadcn, Material,
// Tailwind's defaults — puts borders around 1.2-1.4:1 because a 3:1 hairline
// on white is a harsh black line.
//
// It does matter in one case: when the border is the only thing marking where
// a control begins, typically a text input outline. A token file cannot tell
// which use it is getting, so this reports and moves on. Failing it here would
// fail every well-built design system on the first run, and a gate that cries
// wolf is a gate people learn to skip.
export const ADVISORY_PAIRS = [
  ['border', 'background'],
];

// --- colour parsing ---------------------------------------------------------

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// Accepts the space-separated triplet shadcn and elite use — `222 47% 11%` —
// with or without an hsl() wrapper, and with commas or not. The bare triplet
// is the common case because that is what goes inside hsl(var(--token)).
export function hslToRgb(value) {
  const m = String(value)
    .trim()
    .replace(/^hsla?\(/, '')
    .replace(/\)$/, '')
    .match(/^(-?[\d.]+)(?:deg)?[\s,]+(-?[\d.]+)%[\s,]+(-?[\d.]+)%/);
  if (!m) return null;

  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  if (![s, l].every((n) => n >= 0 && n <= 1)) return null;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const table = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  return table.map((v) => Math.round((v + m0) * 255));
}

export function parseColor(value) {
  const v = String(value).trim();
  return v.startsWith('#') || /^[0-9a-fA-F]{3,6}$/.test(v)
    ? hexToRgb(v) ?? hslToRgb(v)
    : hslToRgb(v) ?? hexToRgb(v);
}

// --- ratio ------------------------------------------------------------------

export function relativeLuminance([r, g, b]) {
  const [R, G, B] = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(a, b) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// --- token extraction -------------------------------------------------------

// Splits a stylesheet into blocks so light and dark are checked separately.
// A dark-mode palette that fails is invisible if both blocks are flattened
// into one map — the later declaration simply wins and the earlier one is
// never tested.
export function extractBlocks(css) {
  // Comments are stripped first, or a comment sitting above a rule is captured
  // as part of that rule's selector and the report labels the block with it.
  const text = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  // Matches `:root {`, `.dark {`, `[data-theme='dark'] {`, and media blocks'
  // inner selectors. Nested braces inside a block would break this, but a
  // token block contains only declarations.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2];
    const tokens = {};
    for (const d of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      tokens[d[1].toLowerCase()] = d[2].trim();
    }
    if (Object.keys(tokens).length > 0) blocks.push({ selector, tokens });
  }
  return blocks;
}

export function checkBlock({ selector, tokens }) {
  const results = [];
  const run = (pairs, min, kind, advisory) => {
    for (const [fg, bg] of pairs) {
      if (!(fg in tokens) || !(bg in tokens)) continue;
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      if (ratio === null) {
        results.push({
          selector, fg, bg, kind, min, ratio: null, advisory,
          pass: advisory, note: `could not parse ${tokens[fg]} / ${tokens[bg]}`,
        });
        continue;
      }
      // An advisory pair never sets pass=false, so it cannot fail the run —
      // it is surfaced in the report and judged by a human.
      results.push({
        selector, fg, bg, kind, min, ratio, advisory,
        pass: advisory ? true : ratio >= min,
        meets: ratio >= min,
      });
    }
  };
  run(TEXT_PAIRS, TEXT_MIN, 'text', false);
  run(UI_PAIRS, UI_MIN, 'focus', false);
  run(ADVISORY_PAIRS, UI_MIN, 'advisory', true);
  return results;
}

export function checkCss(css) {
  return extractBlocks(css).flatMap(checkBlock);
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  const pairIdx = args.indexOf('--pair');
  if (pairIdx !== -1) {
    const [a, b] = [args[pairIdx + 1], args[pairIdx + 2]];
    const ratio = contrastRatio(a, b);
    if (ratio === null) {
      console.error(`could not parse one of: ${a} / ${b}`);
      process.exit(2);
    }
    console.log(
      asJson
        ? JSON.stringify({ a, b, ratio, text: ratio >= TEXT_MIN, ui: ratio >= UI_MIN })
        : `${a} on ${b}: ${ratio}:1  text ${ratio >= TEXT_MIN ? 'PASS' : 'FAIL'}  ui ${ratio >= UI_MIN ? 'PASS' : 'FAIL'}`,
    );
    process.exit(ratio >= TEXT_MIN ? 0 : 1);
  }

  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: contrast.mjs <tokens.css> [--json]');
    console.error('       contrast.mjs --pair <fg> <bg>');
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.error(`no such file: ${file}`);
    process.exit(2);
  }

  const results = checkCss(readFileSync(file, 'utf8'));

  if (results.length === 0) {
    // Silence here would read as success. A token file with no checkable
    // pairs is a token file that was not written to elite's naming scheme.
    console.error(
      `no checkable token pairs found in ${file} — expected elite names ` +
        '(--foreground/--background, --primary-foreground/--primary, …)',
    );
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify({ file, results }, null, 2));
  } else {
    let lastSelector = null;
    for (const r of results) {
      if (r.selector !== lastSelector) {
        console.log(`\n${r.selector}`);
        lastSelector = r.selector;
      }
      const ratio = r.ratio === null ? '  ?  ' : `${String(r.ratio).padStart(5)}:1`;
      const verdict = r.advisory
        ? r.meets ? 'ok' : `note <${r.min}, see below`
        : r.pass ? 'PASS' : `FAIL <${r.min}`;
      console.log(`  --${r.fg} on --${r.bg}: ${ratio}  ${verdict}${r.note ? ` (${r.note})` : ''}`);
    }
  }

  // In --json mode stdout carries the JSON document and nothing else, so it
  // can be piped straight into a parser. Everything human-readable goes to
  // stderr, where it is still visible in a terminal.
  const say = asJson ? console.error : console.log;

  const advisories = results.filter((r) => r.advisory && !r.meets);
  if (advisories.length > 0) {
    say(
      `\n${advisories.length} low-contrast border(s). Not a failure: WCAG 1.4.11 ` +
        'covers borders that IDENTIFY a control, not decorative separators.\n' +
        'Check by hand that no text input relies on this border alone to show ' +
        'where the field is.',
    );
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} pair(s) below the floor. Fix the token and re-run — ` +
        'a style choice never wins against the accessibility floor.',
    );
    process.exit(1);
  }
  say(`\n${results.length} pair(s) checked, no failures.`);
}
