import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverProducts, accentCarriers, cssAccent, dartAccent, checkConsistency,
} from '../scripts/consistency.mjs';

const CLI = join(import.meta.dirname, '..', 'scripts', 'consistency.mjs');

const css = (accent) => `:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --accent: ${accent};
}
.dark { --background: 222 47% 4%; --accent: 20 90% 60%; }`;

const dart = (hex) => `// generated\nclass AppColors {\n  static const accent = Color(0xFF${hex});\n}\n`;

function repo(products) {
  // products: { name: { accent, dartHex?, tailwindWrap? } }
  const root = mkdtempSync(join(tmpdir(), 'consist-'));
  for (const [name, cfg] of Object.entries(products)) {
    const p = join(root, name);
    mkdirSync(join(p, 'design'), { recursive: true });
    writeFileSync(join(p, 'design', 'tokens.css'), css(cfg.accent));
    if (cfg.dartHex) {
      mkdirSync(join(p, 'mobile', 'lib', 'design'), { recursive: true });
      writeFileSync(join(p, 'mobile', 'lib', 'design', 'tokens.dart'), dart(cfg.dartHex));
    }
    if (cfg.tailwindWrap) {
      writeFileSync(join(p, 'tailwind.config.js'),
        `export default { theme: { colors: { accent: 'hsl(var(--accent) / <alpha-value>)' } } };`);
    }
  }
  return root;
}
function run(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// --- parsing ----------------------------------------------------------------

test('the light-block accent is read; the dark block is not mistaken for it', () => {
  const root = repo({ alpha: { accent: '49 88% 25%' } });
  const a = cssAccent(join(root, 'alpha', 'design', 'tokens.css'));
  assert.equal(a.raw, '49 88% 25%');
  assert.ok(a.rgb, 'normalises to comparable RGB');
});

test('the generated Dart accent is read; a renamed field is not guessed at', () => {
  const root = repo({ alpha: { accent: '49 88% 25%', dartHex: 'B05213' } });
  const a = dartAccent(join(root, 'alpha', 'mobile', 'lib', 'design', 'tokens.dart'));
  assert.equal(a.raw, '#B05213');
  const p = join(root, 'alpha');
  writeFileSync(join(p, 'mobile', 'lib', 'design', 'tokens.dart'),
    'class AppColors { static const brandAccent = Color(0xFFB05213); }');
  assert.equal(dartAccent(join(p, 'mobile', 'lib', 'design', 'tokens.dart')), null,
    'a hand-renamed palette is the tokens.dart drift check\'s finding, not a guess here');
});

test('products are discovered by their design/tokens.css', () => {
  const root = repo({ alpha: { accent: '10 80% 40%' }, beta: { accent: '200 80% 40%' } });
  assert.deepEqual(discoverProducts(root).map((p) => p.name), ['alpha', 'beta']);
});

// --- the three findings -----------------------------------------------------

test('surfaces of one product disagreeing on the accent is a divergence', () => {
  // 49 88% 25% is not #B05213 — the field case, a web master and a
  // hand-drifted mobile palette.
  const root = repo({ alpha: { accent: '49 88% 25%', dartHex: '3B82F6' } });
  const f = checkConsistency(discoverProducts(root));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'accent-divergence');
  assert.equal(f[0].product, 'alpha');
  assert.equal(f[0].carriers.length, 2);
});

test('a Dart copy that matches the master is not a divergence', () => {
  // 49 88% 25% in HSL is #786308 — generated correctly, no finding.
  const root = repo({ alpha: { accent: '49 88% 25%', dartHex: '786308' } });
  assert.deepEqual(checkConsistency(discoverProducts(root)), []);
});

test('two products sharing an accent render as the same product', () => {
  const root = repo({
    alpha: { accent: '20 78% 38%' },
    beta: { accent: '20 78% 38%' },
    gamma: { accent: '200 80% 40%' },
  });
  const f = checkConsistency(discoverProducts(root));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'accent-shared');
  assert.deepEqual(f[0].products.sort(), ['alpha', 'beta']);
});

test('a hex accent under an hsl(var(--accent)) wrapper is a silent breakage', () => {
  // hsl(#B05213 / 0.5) is not a colour, so every opacity modifier dies.
  const root = repo({ alpha: { accent: '#B05213', tailwindWrap: true } });
  const f = checkConsistency(discoverProducts(root));
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'accent-not-hsl');
});

test('an HSL triple under the same wrapper is the correct form and passes', () => {
  const root = repo({ alpha: { accent: '49 88% 25%', tailwindWrap: true } });
  assert.deepEqual(checkConsistency(discoverProducts(root)), []);
});

test('the field case reports three distinct failure kinds, not one blur', () => {
  // The acceptance case: divergent surfaces in one product, a sibling sharing
  // its accent, and a hex where the wrapper needs a triple.
  const root = repo({
    alpha: { accent: '20 78% 38%', dartHex: 'B05213' },      // diverged
    beta: { accent: '20 78% 38%' },                          // shares alpha's
    gamma: { accent: '#3B82F6', tailwindWrap: true },        // hex under hsl()
  });
  const kinds = checkConsistency(discoverProducts(root)).map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['accent-divergence', 'accent-not-hsl', 'accent-shared']);
});

// --- cli --------------------------------------------------------------------

test('findings exit 1 and name the kind; a clean suite exits 0', () => {
  const bad = repo({ a: { accent: '10 80% 40%' }, b: { accent: '10 80% 40%' } });
  const res = run([bad]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /accent-shared/);

  const good = repo({ a: { accent: '10 80% 40%' }, b: { accent: '200 80% 40%' } });
  const ok = run([good]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /0 finding\(s\)/);
});

test('a single product with a single carrier exits 3 — nothing to compare', () => {
  // The gate maps 3 to N/A: an absence, not a gap.
  const root = repo({ solo: { accent: '10 80% 40%' } });
  const res = run([root]);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /nothing for the accent to disagree with/);
});

test('no products at all exits 3 with its own message', () => {
  const root = mkdtempSync(join(tmpdir(), 'empty-'));
  const res = run([root]);
  assert.equal(res.status, 3);
  assert.match(res.stderr, /no design\/tokens\.css found/);
});

test('--json emits machine-readable findings', () => {
  const root = repo({ a: { accent: '10 80% 40%' }, b: { accent: '10 80% 40%' } });
  const res = run([root, '--json']);
  const doc = JSON.parse(res.stdout);
  assert.deepEqual(doc.products, ['a', 'b']);
  assert.equal(doc.findings[0].kind, 'accent-shared');
});
