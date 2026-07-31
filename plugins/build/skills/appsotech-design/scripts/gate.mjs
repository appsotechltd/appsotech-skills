#!/usr/bin/env node
// Runs the whole design gate and reports once.
//
//   gate.mjs                          # conventions: design/, apps/*/src
//   gate.mjs --serve apps/webapp/dist # …and the rendered checks too
//   gate.mjs --url http://localhost:3200
//
// The gate used to be a nine-row table of separate commands, and a gate that
// takes nine steps is a gate that gets run in part. The paths are decided by
// the skill's own conventions, so nothing here needs to be passed by hand
// except a running server, which cannot be guessed.
//
// A step that did not run is reported as SKIP and says why. It is never
// folded into the pass count — the whole reason this file exists is that a
// partial run must not read as a clean one.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const script = (name) => join(HERE, name);

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const SKIP = 'SKIP';

// responsive-check exits 3 when Playwright is absent — a step that could not
// run, not a step that failed. Every other non-zero exit is a real failure,
// including 2: bad input means the gate was pointed at the wrong thing, and
// silently passing that is how a directory nobody scanned reads as clean.
export function classify(status, { skipStatus } = {}) {
  if (status === 0) return PASS;
  if (skipStatus !== undefined && status === skipStatus) return SKIP;
  return FAIL;
}

export function surfaceDirs(root = '.') {
  const apps = join(root, 'apps');
  if (!existsSync(apps)) return [];
  const out = [];
  for (const entry of readdirSync(apps).sort()) {
    for (const sub of ['src', 'app', 'lib']) {
      const dir = join(apps, entry, sub);
      try {
        if (statSync(dir).isDirectory()) { out.push(dir); break; }
      } catch { /* not this one */ }
    }
  }
  return out;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', '.next', '.dart_tool', 'ios',
  'android', 'Pods', 'vendor', '.svelte-kit', 'coverage',
]);

// Finds every generated Flutter token file, wherever the package sits.
//
// A hardcoded apps/mobile/… default was worse than useless on a project laid
// out any other way: it reported "no Flutter surface" for a project that HAS
// one, so the drift check silently skipped a file that existed while asserting
// something false. Discovery makes the message true in all three cases.
export function flutterTokenFiles(root = '.', depth = 4) {
  const out = [];
  const walk = (dir, left) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const sub = join(dir, e.name);
      const candidate = join(sub, 'lib', 'design', 'tokens.dart');
      if (existsSync(candidate)) out.push(candidate);
      if (left > 0) walk(sub, left - 1);
    }
  };
  const here = join(root, 'lib', 'design', 'tokens.dart');
  if (existsSync(here)) out.push(here);
  walk(root, depth);
  return [...new Set(out)].sort();
}

// A Flutter package is here even when nobody generated its tokens — that is a
// finding rather than an absence, and the two must not read the same.
export function hasFlutterPackage(root = '.', depth = 4) {
  const walk = (dir, left) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    if (existsSync(join(dir, 'pubspec.yaml'))) return true;
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      if (left > 0 && walk(join(dir, e.name), left - 1)) return true;
    }
    return false;
  };
  return walk(root, depth);
}

function run(name, args, opts = {}) {
  const res = spawnSync(process.execPath, [script(name), ...args], {
    encoding: 'utf8', timeout: opts.timeout ?? 180_000,
  });
  const status = res.status ?? 1;
  return {
    status: classify(status, opts),
    code: status,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
  };
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : fallback;
  };
  const verbose = args.includes('--verbose');

  const tokens = flag('--tokens', join('design', 'tokens.css'));
  const system = flag('--system', join('design', 'design-system.md'));
  const dart = flag('--dart', null);
  // Opt-in, and deliberately not defaulted. A domain file is a stack concept —
  // entities, actors, the tenant boundary — and a design-only project has none
  // and never will. Defaulting it would make every solo run report a permanent
  // SKIP for a file that was never meant to exist, which is how a real warning
  // gets trained into background noise.
  const domain = flag('--domain', null);
  const serveDir = flag('--serve');
  const url = flag('--url');
  const srcArg = flag('--src');

  const steps = [];
  const add = (name, target, result) => steps.push({ name, target, ...result });
  const skip = (name, target, why) => steps.push({ name, target, status: SKIP, output: why });

  // 0. Was the domain ever written down? Only when asked for.
  //
  // A skipped step is said plainly rather than omitted — and until this, a
  // project whose domain lived only in a chat transcript passed in silence.
  // It asserts a file exists and nothing more: whether the contents are any
  // good, and whether a spec's acceptance criteria honestly became tests, are
  // judgement calls that stay human.
  if (domain) {
    if (existsSync(domain)) {
      add('domain', domain, { status: PASS, code: 0, output: 'recorded' });
    } else {
      skip('domain', domain,
        'the domain was never written down, so the next session inherits ' +
        'nothing — a chat transcript does not survive');
    }
  }

  // 1. The tokens themselves.
  if (existsSync(tokens)) {
    add('contrast', tokens, run('contrast.mjs', [tokens]));
  } else {
    skip('contrast', tokens, 'no token file — selection and freeze never ran');
  }

  // 2. The tokens still describe what the master says they do.
  if (existsSync(tokens) && existsSync(system)) {
    add('freeze', system, run('freeze-check.mjs', [tokens, system]));
  } else {
    skip('freeze', system, existsSync(system) ? 'no token file' : 'no design-system.md');
  }

  // 3. The Flutter copy has not drifted. Discovered, not assumed — see
  // flutterTokenFiles for why a fixed path was actively misleading.
  const dartFiles = dart ? [dart] : flutterTokenFiles('.');
  if (dartFiles.length > 0) {
    for (const f of dartFiles) {
      add('tokens.dart', f, run('tokens-dart.mjs', [tokens, '-o', f, '--check']));
    }
  } else if (hasFlutterPackage('.')) {
    skip('tokens.dart', 'lib/design/tokens.dart',
      'a Flutter package is here but its tokens were never generated — run ' +
      'tokens-dart.mjs, or the app and the website drift apart');
  } else {
    skip('tokens.dart', '—', 'no Flutter package found');
  }

  // 4. The code actually consumes the tokens.
  const srcDirs = srcArg ? [srcArg] : surfaceDirs('.');
  if (srcDirs.length === 0) {
    skip('markup', 'apps/*/src', 'no surface source directories found');
  } else {
    for (const dir of srcDirs) add('markup', dir, run('audit-markup.mjs', [dir]));
  }

  // 5. The rendered page. Cannot be guessed — a build directory or a running
  // server has to be named.
  if (serveDir || url) {
    const target = serveDir ?? url;
    add('responsive', target, run(
      'responsive-check.mjs',
      serveDir ? ['--serve', serveDir, '--no-shots'] : [url, '--no-shots'],
      { skipStatus: 3, timeout: 300_000 }));
  } else {
    skip('responsive', '—', 'pass --serve <build-dir> or --url <running server>');
  }

  const width = Math.max(...steps.map((s) => s.name.length));
  console.log('');
  for (const s of steps) {
    const first = (s.output ?? '').split('\n').filter(Boolean).pop() ?? '';
    console.log(`  ${s.status}  ${s.name.padEnd(width)}  ${s.target}`);
    if (s.status !== PASS || verbose) console.log(`        ${first}`);
  }

  const failed = steps.filter((s) => s.status === FAIL);
  const skipped = steps.filter((s) => s.status === SKIP);

  for (const s of failed) {
    console.log(`\n--- ${s.name}: ${s.target} ---\n${s.output}`);
  }

  console.log(
    `\n${steps.length} step(s): ${steps.filter((s) => s.status === PASS).length} passed, ` +
    `${failed.length} failed, ${skipped.length} skipped.`);

  if (skipped.length > 0) {
    // Said every time, because the failure mode this file exists to prevent is
    // a partial run reported as a clean one.
    console.log(
      `\n${skipped.length} step(s) did not run. They are not passes — check ` +
      'them by hand, or supply what they need and re-run.');
  }
  if (failed.length > 0) {
    console.log('\nThe gate failed. Fix the findings above and re-run.');
    process.exit(1);
  }
  process.exit(0);
}
