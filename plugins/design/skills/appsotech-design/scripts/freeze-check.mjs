#!/usr/bin/env node
// Holds design-system.md and tokens.css to each other.
//
//   freeze-check.mjs design/tokens.css design/design-system.md
//   freeze-check.mjs design/tokens.css design/design-system.md --record
//
// The frozen design rule is the load-bearing part of the whole pipeline: a
// cloud session starts fresh, reads design-system.md and inherits the palette
// rather than generating a new one every Tuesday. Nothing enforced it.
//
// This records a fingerprint of the palette INSIDE design-system.md. The check
// then answers one question: does tokens.css still hold the palette this
// document claims to describe? A silent token edit leaves the rationale
// describing colours that are no longer there, and the next session inherits
// an explanation for a design it cannot see.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractBlocks } from './contrast.mjs';

export const MARKER = 'palette-fingerprint';
const MARKER_RE = new RegExp(`<!--\\s*${MARKER}:\\s*([0-9a-f]{6,64})\\s*-->`);

// Canonical form: every block, every token, sorted. Reordering declarations or
// reformatting the file must not read as a restyle — only a changed VALUE is a
// changed palette.
export function canonicalPalette(css) {
  return extractBlocks(css)
    .map((b) => {
      const tokens = Object.entries(b.tokens)
        .map(([k, v]) => `${k}:${v.replace(/\s+/g, ' ').trim()}`)
        .sort();
      return `${b.selector.replace(/\s+/g, ' ')}{${tokens.join(';')}}`;
    })
    .sort()
    .join('\n');
}

export function fingerprint(css) {
  const canon = canonicalPalette(css);
  if (canon === '') return null;
  return createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

export function readFingerprint(markdown) {
  const m = String(markdown).match(MARKER_RE);
  return m ? m[1] : null;
}

export function writeFingerprint(markdown, fp) {
  const line = `<!-- ${MARKER}: ${fp} -->`;
  if (MARKER_RE.test(markdown)) return markdown.replace(MARKER_RE, line);
  const body = markdown.replace(/\s*$/, '');
  return `${body}\n\n${line}\n`;
}

export function verdict({ css, markdown }) {
  const actual = fingerprint(css);
  if (actual === null) {
    return { ok: false, code: 'no-tokens', why: 'the token file has no custom properties in it' };
  }
  const recorded = readFingerprint(markdown);
  if (recorded === null) {
    return { ok: false, code: 'unrecorded', actual, why: 'design-system.md carries no palette fingerprint yet' };
  }
  if (recorded !== actual) {
    return { ok: false, code: 'drifted', actual, recorded, why: 'tokens.css no longer holds the palette design-system.md describes' };
  }
  return { ok: true, code: 'match', actual };
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const record = args.includes('--record');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [cssPath, mdPath] = [
    positional[0] ?? 'design/tokens.css',
    positional[1] ?? 'design/design-system.md',
  ];

  for (const p of [cssPath, mdPath]) {
    if (!existsSync(p)) {
      console.error(`no such file: ${p}`);
      process.exit(2);
    }
  }

  const css = readFileSync(cssPath, 'utf8');
  const markdown = readFileSync(mdPath, 'utf8');

  if (record) {
    const fp = fingerprint(css);
    if (fp === null) {
      console.error(`${cssPath} has no custom properties — nothing to fingerprint.`);
      process.exit(2);
    }
    writeFileSync(mdPath, writeFingerprint(markdown, fp));
    console.log(`${mdPath} now records palette ${fp}.`);
    process.exit(0);
  }

  const v = verdict({ css, markdown });
  if (v.ok) {
    console.log(`${mdPath} matches ${cssPath} — palette ${v.actual}.`);
    process.exit(0);
  }

  if (v.code === 'no-tokens') {
    console.error(`${cssPath}: ${v.why}`);
    process.exit(2);
  }
  if (v.code === 'unrecorded') {
    console.error(
      `${mdPath} carries no palette fingerprint.\n` +
        `Record it once the palette is frozen:\n` +
        `  node freeze-check.mjs ${cssPath} ${mdPath} --record`);
    process.exit(1);
  }
  console.error(
    `${v.why}.\n` +
      `  recorded ${v.recorded}\n  actual   ${v.actual}\n\n` +
      'Either the palette was changed without the master being updated — in ' +
      'which case put it back, because re-selection happens only when the user ' +
      'asks in so many words — or this was a deliberate restyle, in which case ' +
      'update design-system.md to explain the new palette and re-record.');
  process.exit(1);
}
