#!/usr/bin/env node
// Generates the Flutter token file from the CSS master.
//
//   tokens-dart.mjs design/tokens.css -o apps/mobile/lib/design/tokens.dart
//   tokens-dart.mjs design/tokens.css -o <path> --check
//
// The skill says tokens.dart is "generated from tokens.css, never hand-
// maintained beside it". Until this existed, nothing generated it — the rule
// was stated in prose and violated in the same breath, and the failure is
// silent: the Flutter app drifts from the website one token at a time and
// nobody notices until the two are side by side.
//
// --check regenerates in memory and compares. That is the mode the gate runs,
// because a generator nobody re-runs is the same as no generator.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { extractBlocks, parseColor } from './contrast.mjs';

// The Dart file must live inside the Flutter package, because Dart resolves
// library code relative to lib/ — `design/tokens.dart` at the repository root
// is not importable from apps/mobile. A `design/` segment anywhere in the path
// also keeps audit-markup.mjs's hardcoded-colour rule off it, which is correct:
// this file is the one place raw colour belongs on the Flutter side.
export const DEFAULT_OUT = 'apps/mobile/lib/design/tokens.dart';

export function isDarkSelector(selector) {
  return /(^|[\s,.[])dark\b|prefers-color-scheme:\s*dark|data-theme\s*=\s*["']?dark/i
    .test(selector);
}

// Splits the stylesheet into the two palettes.
//
// `.dark` normally lists only what it OVERRIDES — that is how the cascade is
// meant to be used, and a generator that emitted dark's own keys alone would
// produce a palette with holes where the CSS has none. Light is the base and
// dark is layered onto it.
export function tokenSets(css) {
  const blocks = extractBlocks(css);
  const light = {};
  const dark = {};
  for (const b of blocks) {
    Object.assign(isDarkSelector(b.selector) ? dark : light, b.tokens);
  }
  return { light, dark: { ...light, ...dark }, darkOverrides: dark };
}

export function dartName(token) {
  return token.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function toDartColor(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const hex = rgb.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `Color(0xFF${hex})`;
}

// `0.5rem` and `8px` both become a Dart double. rem is resolved at 16px, the
// root font size elite's scale assumes.
export function toDartDouble(value) {
  const m = String(value).trim().match(/^(-?[\d.]+)(rem|px)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return (m[2] === 'rem' ? n * 16 : n).toFixed(1);
}

const HEADER = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by tokens-dart.mjs from design/tokens.css, which is the master.
// Edit the CSS and regenerate; editing this file makes the two palettes drift
// and the app slowly stops looking like its own website.

import 'package:flutter/material.dart';
`;

export function generateDart(css) {
  const { light, dark } = tokenSets(css);
  const names = Object.keys(light);
  if (names.length === 0) return { dart: null, colours: 0, skipped: [] };

  const skipped = [];
  const colourLines = [];
  const radiusLines = [];

  const emit = (token, suffix, value) => {
    const colour = toDartColor(value);
    if (colour) {
      colourLines.push(`  static const ${dartName(token)}${suffix} = ${colour};`);
      return true;
    }
    return false;
  };

  for (const token of names) {
    if (!emit(token, '', light[token])) {
      const d = toDartDouble(light[token]);
      if (d !== null) radiusLines.push(`  static const ${dartName(token)} = ${d};`);
      else skipped.push(`${token}: ${light[token]}`);
    }
  }
  const lightCount = colourLines.length;
  for (const token of names) {
    if (toDartColor(light[token])) emit(token, 'Dark', dark[token]);
  }

  const parts = [HEADER, '\nclass AppColors {\n  // Light\n'];
  parts.push(colourLines.slice(0, lightCount).join('\n'));
  parts.push('\n\n  // Dark\n');
  parts.push(colourLines.slice(lightCount).join('\n'));
  parts.push('\n}\n');
  if (radiusLines.length > 0) {
    parts.push('\nclass AppMetrics {\n');
    parts.push(radiusLines.join('\n'));
    parts.push('\n}\n');
  }
  return { dart: parts.join(''), colours: lightCount, skipped };
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const oIdx = args.findIndex((a) => a === '-o' || a === '--out');
  const out = oIdx !== -1 ? args[oIdx + 1] : DEFAULT_OUT;
  const file = args.find((a, i) => !a.startsWith('-') && i !== oIdx + 1);

  if (!file) {
    console.error('usage: tokens-dart.mjs <tokens.css> [-o <tokens.dart>] [--check]');
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.error(`no such file: ${file}`);
    process.exit(2);
  }

  const { dart, colours, skipped } = generateDart(readFileSync(file, 'utf8'));
  if (!dart) {
    console.error(
      `no custom properties found in ${file} — expected a :root block of ` +
        'design tokens. Generating an empty theme would look like success.');
    process.exit(2);
  }
  for (const s of skipped) console.error(`  note: not a colour or a length, skipped — ${s}`);

  if (check) {
    if (!existsSync(out)) {
      console.error(`${out} does not exist — run without --check to generate it.`);
      process.exit(1);
    }
    const onDisk = readFileSync(out, 'utf8');
    if (onDisk.trimEnd() !== dart.trimEnd()) {
      console.error(
        `${out} has drifted from ${file}.\n` +
          'Regenerate it. Whichever was edited by hand, the CSS is the master ' +
          'and the Dart is the copy.');
      process.exit(1);
    }
    console.log(`${out} matches ${file} — ${colours} colour token(s).`);
    process.exit(0);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, dart);
  console.log(`${out} written — ${colours} colour token(s), light and dark.`);
}
