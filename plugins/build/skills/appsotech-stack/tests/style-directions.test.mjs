import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, TEXT_MIN, UI_MIN } from '../scripts/contrast.mjs';

// style-directions.md states that every palette in it is contrast-verified.
// Until this file existed that was an assertion, not a guarantee: the original
// verification ran in a throwaway script, so editing one hex in the document
// would have broken the claim with nothing to catch it. These tests parse the
// document itself, so the claim is checked against what actually ships.

const DOC = readFileSync(
  join(import.meta.dirname, '..', 'references', 'style-directions.md'), 'utf8');

// Each direction is `## <n>. <Name>` followed by a table whose rows are
// `| token | \`#LIGHT\` | \`#DARK\` |`.
function parseDirections(md) {
  const directions = [];
  const sections = md.split(/^## /m).slice(1);
  for (const section of sections) {
    const name = section.split('\n')[0].trim();
    if (!/^\d+\.\s/.test(name)) continue; // skip "How to use", "Choosing"
    const light = {};
    const dark = {};
    for (const row of section.matchAll(
      /^\|\s*([a-z-]+)\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|/gm,
    )) {
      light[row[1]] = row[2];
      dark[row[1]] = row[3];
    }
    const fonts = section.match(/\*\*Type\*\*\s+([^·]+)·/);
    directions.push({
      name,
      light,
      dark,
      fonts: fonts ? fonts[1].trim() : null,
      hasSignature: /\*\*Signature\*\*/.test(section),
    });
  }
  return directions;
}

const DIRECTIONS = parseDirections(DOC);

const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['primary-foreground', 'primary'],
  ['muted-foreground', 'muted'],
  ['accent-foreground', 'accent'],
];

// The document states --ring takes the same value as --primary in every
// direction, so the ring is checked as primary-on-background.
const RING_PAIR = ['primary', 'background'];

const REQUIRED_TOKENS = [
  'background', 'foreground', 'primary', 'primary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground', 'border',
];

test('the document parses into exactly twelve directions', () => {
  // The count is load-bearing: SKILL.md, README and design-phase.md all
  // promise "twelve", and a dropped section would make those wrong.
  assert.equal(DIRECTIONS.length, 12, DIRECTIONS.map((d) => d.name).join(', '));
});

test('every direction defines both modes for every required token', () => {
  for (const d of DIRECTIONS) {
    for (const token of REQUIRED_TOKENS) {
      assert.ok(d.light[token], `${d.name}: light --${token} missing`);
      assert.ok(d.dark[token], `${d.name}: dark --${token} missing`);
    }
  }
});

test('every text pair meets 4.5:1 in both light and dark', () => {
  const failures = [];
  for (const d of DIRECTIONS) {
    for (const mode of ['light', 'dark']) {
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrastRatio(d[mode][fg], d[mode][bg]);
        assert.notEqual(ratio, null, `${d.name}/${mode}: unparseable ${fg}/${bg}`);
        if (ratio < TEXT_MIN) {
          failures.push(`${d.name}/${mode} ${fg} ${d[mode][fg]} on ${bg} ${d[mode][bg]} = ${ratio}`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `text pairs below ${TEXT_MIN}:1`);
});

test('every focus ring meets 3:1 against its background', () => {
  const failures = [];
  for (const d of DIRECTIONS) {
    for (const mode of ['light', 'dark']) {
      const [fg, bg] = RING_PAIR;
      const ratio = contrastRatio(d[mode][fg], d[mode][bg]);
      if (ratio < UI_MIN) {
        failures.push(`${d.name}/${mode} ring ${d[mode][fg]} on ${d[mode][bg]} = ${ratio}`);
      }
    }
  }
  assert.deepEqual(failures, [], `rings below ${UI_MIN}:1`);
});

test('light and dark are genuinely different palettes', () => {
  // A direction whose dark block repeats its light block is a direction with
  // no dark mode, and dark mode is a hard requirement on every surface.
  for (const d of DIRECTIONS) {
    assert.notEqual(
      d.light.background, d.dark.background,
      `${d.name}: dark background is identical to light`,
    );
  }
});

test('dark backgrounds are actually dark, and light ones light', () => {
  // Catches a light/dark column transposed during an edit — which would still
  // pass every contrast check, because the ratios are symmetric.
  for (const d of DIRECTIONS) {
    const lightBg = contrastRatio(d.light.background, '#000000');
    const darkBg = contrastRatio(d.dark.background, '#000000');
    assert.ok(lightBg > darkBg, `${d.name}: light and dark columns look transposed`);
  }
});

test('no direction proposes a banned display face', () => {
  // elite's blacklist is a veto over style choices, so the fallback file must
  // not be the thing that violates it.
  for (const d of DIRECTIONS) {
    assert.ok(d.fonts, `${d.name}: no font pairing given`);
    for (const banned of ['Inter', 'Roboto', 'Arial']) {
      assert.ok(
        !new RegExp(`\\b${banned}\\b`).test(d.fonts),
        `${d.name}: font pairing "${d.fonts}" uses ${banned}`,
      );
    }
  }
});

test('every direction names a signature move', () => {
  // The checklist asks the builder to name one memorable element. A direction
  // that does not supply one cannot satisfy that from this file.
  for (const d of DIRECTIONS) {
    assert.ok(d.hasSignature, `${d.name}: no signature move`);
  }
});

test('the parser would notice a broken palette rather than skipping it', () => {
  // Guards the guard: if the row regex stopped matching, every test above
  // would pass vacuously on an empty set.
  const broken = parseDirections(`
## 1. Broken
| Token | Light | Dark |
|---|---|---|
| background | \`#FFFFFF\` | \`#000000\` |
| foreground | \`#EEEEEE\` | \`#111111\` |

**Type** Space Grotesk / Work Sans · **Signature** none.
`);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].light.foreground, '#EEEEEE');
  assert.ok(contrastRatio(broken[0].light.foreground, broken[0].light.background) < TEXT_MIN);
});
