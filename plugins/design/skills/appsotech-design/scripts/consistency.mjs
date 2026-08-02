#!/usr/bin/env node
// Verifies the one token that identifies a product: the accent.
//
//   consistency.mjs [root] [--json]
//
// The token architecture says the accent is the only per-product value — the
// accent alone tells two products apart. Nothing verified it, and the field
// audit found one product carrying four accents across its four surfaces, two
// of them byte-identical to a SIBLING product's, so two separate products
// rendered the same. Divergence within a product and sharing across products
// are both invisible to every other check, because each file is internally
// fine.
//
// Exit codes: 0 consistent, 1 findings, 2 bad input, 3 nothing to compare —
// the gate maps 3 to N/A, since a single-surface project has no siblings for
// its accent to disagree with.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import { extractBlocks, parseColor } from './contrast.mjs';
import { isDarkSelector } from './tokens-dart.mjs';
import { flutterTokenFiles } from './gate.mjs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', '.next', '.dart_tool', 'ios',
  'android', 'Pods', 'vendor', '.svelte-kit', 'coverage',
]);

function walk(root, depth, visit) {
  const rec = (dir, left) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    visit(dir);
    if (left <= 0) return;
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      rec(join(dir, e.name), left - 1);
    }
  };
  rec(root, depth);
}

// A product is a directory holding design/tokens.css — the master. One repo
// can hold one product or many; the convention is the same one the rest of
// the skill uses.
export function discoverProducts(root = '.', depth = 4) {
  const out = [];
  walk(root, depth, (dir) => {
    if (existsSync(join(dir, 'design', 'tokens.css'))) {
      out.push({ name: relative(root, dir) || basename(resolve(root)), root: dir });
    }
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The light-block --accent from a token stylesheet, raw and normalised.
export function cssAccent(cssPath) {
  const blocks = extractBlocks(readFileSync(cssPath, 'utf8'));
  for (const b of blocks) {
    if (isDarkSelector(b.selector)) continue;
    if (b.tokens.accent) {
      const raw = b.tokens.accent;
      const rgb = parseColor(raw);
      return { raw, rgb: rgb ? rgb.join(',') : null };
    }
  }
  return null;
}

// The generated Dart copy's accent. Only the generator's own shape is
// recognised — a hand-written palette that renamed the field is exactly the
// drift the gate's tokens.dart step reports, not this one.
export function dartAccent(dartPath) {
  const m = readFileSync(dartPath, 'utf8')
    .match(/static const accent = Color\(0x(?:FF)?([0-9A-Fa-f]{6})\);/);
  if (!m) return null;
  const rgb = parseColor(`#${m[1]}`);
  return { raw: `#${m[1]}`, rgb: rgb ? rgb.join(',') : null };
}

// Every accent carrier under one product root.
export function accentCarriers(product) {
  const carriers = [];
  const master = cssAccent(join(product.root, 'design', 'tokens.css'));
  if (master) carriers.push({ file: join('design', 'tokens.css'), ...master });
  for (const f of flutterTokenFiles(product.root)) {
    const a = dartAccent(f);
    if (a) carriers.push({ file: relative(product.root, f), ...a });
  }
  return carriers;
}

function tailwindConfigs(root, depth = 3) {
  const out = [];
  walk(root, depth, (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (/^tailwind\.config\.[cm]?[jt]s$/.test(e)) out.push(join(dir, e));
    }
  });
  return out;
}

const HSL_TRIPLE = /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/;

export function checkConsistency(products) {
  const findings = [];
  const masters = [];

  for (const p of products) {
    const carriers = accentCarriers(p);
    const master = carriers.find((c) => c.file.endsWith('tokens.css'));
    if (master) masters.push({ product: p.name, ...master });

    // 1. One product whose surfaces disagree on the accent.
    const values = new Map();
    for (const c of carriers) {
      if (!c.rgb) continue;
      if (!values.has(c.rgb)) values.set(c.rgb, []);
      values.get(c.rgb).push(c);
    }
    if (values.size > 1) {
      findings.push({
        kind: 'accent-divergence', product: p.name,
        carriers: carriers.map((c) => `${c.file}: ${c.raw}`),
        why: 'one product, more than one accent — its surfaces render as different products',
      });
    }

    // 3. A hex accent where the Tailwind config expects an HSL triple.
    // hsl(var(--accent) / <alpha>) around a hex value silently breaks every
    // opacity modifier — hsl(#B05213 / 0.5) is not a colour.
    if (master && tailwindConfigs(p.root).some((f) =>
      readFileSync(f, 'utf8').includes('hsl(var(--accent'))) {
      if (!HSL_TRIPLE.test(master.raw.trim())) {
        findings.push({
          kind: 'accent-not-hsl', product: p.name, value: master.raw,
          why: 'the Tailwind config wraps --accent in hsl(var(…)), so the token must be a bare HSL triple — a hex here breaks every opacity modifier silently',
        });
      }
    }
  }

  // 2. Two products sharing an accent — the accent is the identity.
  const byValue = new Map();
  for (const m of masters) {
    if (!m.rgb) continue;
    if (!byValue.has(m.rgb)) byValue.set(m.rgb, []);
    byValue.get(m.rgb).push(m.product);
  }
  for (const [rgb, names] of byValue) {
    if (names.length > 1) {
      findings.push({
        kind: 'accent-shared', products: names, value: `rgb(${rgb})`,
        why: 'the accent is the only per-product value, so two products sharing one render as the same product',
      });
    }
  }

  return findings;
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const root = args.find((a) => !a.startsWith('--')) ?? '.';

  if (!existsSync(root)) {
    console.error(`no such directory: ${root}`);
    process.exit(2);
  }

  const products = discoverProducts(root);
  const comparable = products.length > 1 ||
    products.some((p) => accentCarriers(p).length > 1 || tailwindConfigs(p.root).length > 0);
  if (products.length === 0 || !comparable) {
    console.error(
      products.length === 0
        ? `no design/tokens.css found under ${root} — nothing to compare`
        : 'one product, one accent carrier — nothing for the accent to disagree with');
    process.exit(3);
  }

  const findings = checkConsistency(products);

  if (asJson) {
    console.log(JSON.stringify({ root, products: products.map((p) => p.name), findings }, null, 2));
  } else {
    for (const f of findings) {
      console.log(`\n${f.kind}: ${f.product ?? f.products.join(' + ')}`);
      if (f.carriers) for (const c of f.carriers) console.log(`    ${c}`);
      if (f.value) console.log(`    ${f.value}`);
      console.log(`    ${f.why}`);
    }
    console.log(
      `\n${products.length} product(s) checked — ${findings.length} finding(s).`);
  }
  process.exit(findings.length > 0 ? 1 : 0);
}
