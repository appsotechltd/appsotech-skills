import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanText } from './scan.mjs';

// --- shared helpers ---------------------------------------------------

function makeFact(probe, fact, source) {
  return { probe, fact, source, class: 'inspected' };
}

// Never throws on a missing/unreadable directory: callers rely on an empty
// array meaning "nothing here", which surfaces as an explicit unavailable[]
// entry rather than a silent gap.
function safeReaddir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// --- project-root discovery ----------------------------------------------
//
// containerFacts, dependencyFacts and bundleFacts historically inspected
// only the exact directory handed to them. Against a real monorepo shape
// (a top-level target with independent backend/, frontend/, etc.
// subprojects, each carrying its own manifest/Dockerfile/build output) that
// meant those three probes silently found almost nothing, because the
// actual evidence sits one or more levels below the target root.
//
// discoverRoots walks bounded-depth from the target and marks any directory
// that directly contains a dependency manifest (package.json, go.mod), a
// Dockerfile, or a build-output directory (dist/build/.next/out) as a
// project root. It never descends *into* node_modules, .git, vendor, or any
// of the build-output directory names while searching for more roots —
// those are either vendored/enormous or already a leaf worth reporting —
// but a build-output directory found this way is still handed to
// bundleFacts for real content scanning; only the discovery walk itself
// skips over it.
const BUNDLE_DIR_NAMES = ['dist', 'build', '.next', 'out'];
const DEPENDENCY_MARKER_FILES = ['package.json', 'go.mod'];
// The reviewer's exclusion list names node_modules/.git/vendor/dist
// explicitly; build/.next/out are the same category of thing as dist (build
// output, never a place to find more source-level project roots), so they
// are excluded too rather than leaving three-quarters of a coherent rule
// unapplied.
const DISCOVERY_EXCLUDED_DIRS = new Set(['node_modules', '.git', 'vendor', ...BUNDLE_DIR_NAMES]);
const DISCOVERY_MAX_DEPTH = 4;

function hasProjectMarkers(entries) {
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (DEPENDENCY_MARKER_FILES.some((f) => fileNames.includes(f))) return true;
  if (fileNames.some((n) => /^dockerfile/i.test(n))) return true;
  if (BUNDLE_DIR_NAMES.some((n) => dirNames.includes(n))) return true;
  return false;
}

export function discoverRoots(dir, { maxDepth = DISCOVERY_MAX_DEPTH } = {}) {
  const start = resolve(dir);
  if (!isDir(start)) return [];

  const roots = new Set();
  const queue = [{ path: start, depth: 0 }];
  while (queue.length > 0) {
    const { path: current, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    if (hasProjectMarkers(entries)) roots.add(current);
    if (depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || DISCOVERY_EXCLUDED_DIRS.has(entry.name)) continue;
      queue.push({ path: join(current, entry.name), depth: depth + 1 });
    }
  }
  return [...roots].sort();
}

// --- 3.3: migrations ----------------------------------------------------

const MIGRATION_DIR_CANDIDATES = ['migrations', join('backend', 'migrations')];
const MIGRATION_FILE_RE = /^(\d+)_.*\.(up|down)\.sql$/i;

function findMigrationDir(dir) {
  for (const candidate of MIGRATION_DIR_CANDIDATES) {
    const full = join(dir, candidate);
    if (isDir(full)) return full;
  }
  return null;
}

export function migrationFacts(dir) {
  const target = resolve(dir);
  const migDir = findMigrationDir(target);
  if (!migDir) {
    return {
      facts: [],
      unavailable: [{ probe: '3.3', reason: 'no migrations directory found (checked migrations/, backend/migrations/)' }],
    };
  }

  const groups = new Map();
  for (const name of safeReaddir(migDir)) {
    const m = MIGRATION_FILE_RE.exec(name);
    if (!m) continue;
    const [, prefix, kind] = m;
    if (!groups.has(prefix)) groups.set(prefix, {});
    groups.get(prefix)[kind.toLowerCase()] = name;
  }

  const facts = [];
  let upCount = 0;
  for (const prefix of [...groups.keys()].sort()) {
    const pair = groups.get(prefix);
    if (!pair.up) continue;
    upCount += 1;
    if (!pair.down) {
      facts.push(makeFact(
        '3.3',
        `migration ${pair.up} has no matching down migration (irreversible)`,
        relative(target, join(migDir, pair.up)),
      ));
    }
  }

  facts.push(makeFact(
    '3.3',
    `${upCount} migration(s) found in ${relative(target, migDir)}`,
    relative(target, migDir),
  ));

  return { facts, unavailable: [] };
}

// --- 7.1 / 7.3 / 7.4: CI workflows ---------------------------------------

const SCANNER_KEYWORDS = ['npm audit', 'snyk', 'trivy', 'gitleaks', 'trufflehog', 'dependabot', 'codeql'];

function parseJobNames(text) {
  const lines = text.split(/\r?\n/);
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIdx === -1) return [];
  const jobNameRe = /^ {2}([A-Za-z0-9_.-]+):\s*$/;
  const names = [];
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0 && !/^\s/.test(line)) break; // dedented past the jobs: block
    const m = jobNameRe.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function extractRunCommands(text) {
  const commands = [];
  const re = /run:\s*(.+)/g;
  let m;
  while ((m = re.exec(text)) !== null) commands.push(m[1].trim());
  return commands;
}

export function ciFacts(dir) {
  const target = resolve(dir);
  const workflowsDir = join(target, '.github', 'workflows');
  const files = safeReaddir(workflowsDir).filter((f) => /\.ya?ml$/i.test(f));
  if (files.length === 0) {
    const reason = 'no .github/workflows directory found';
    return { facts: [], unavailable: [{ probe: '7.1', reason }, { probe: '7.3', reason }, { probe: '7.4', reason }] };
  }

  const relFiles = files.map((f) => relative(target, join(workflowsDir, f)));
  const source = relFiles.join(', ');

  const allJobs = [];
  const allCommands = [];
  let combinedText = '';
  for (const f of files) {
    const text = readFileSync(join(workflowsDir, f), 'utf8');
    combinedText += `\n${text}`;
    allJobs.push(...parseJobNames(text));
    allCommands.push(...extractRunCommands(text));
  }

  const jobList = allJobs.length ? allJobs.join(', ') : 'none';
  const facts = [];

  // List every matching command, not just the first — a multi-job pipeline
  // (e.g. "go test", "npm test", "npm run test:e2e" across three jobs) has
  // more than one test/lint step, and only reporting the first one hides
  // the other jobs' behaviour from the evidence document.
  const testCmds = [...new Set(allCommands.filter((c) => /\btests?\b/i.test(c)))];
  facts.push(makeFact(
    '7.1',
    testCmds.length
      ? `CI jobs found: ${jobList}. Test command(s) found: ${testCmds.map((c) => `"${c}"`).join(', ')}.`
      : `CI jobs found: ${jobList}. No test command detected among run steps.`,
    source,
  ));

  const lintCmds = [...new Set(allCommands.filter((c) => /\blint\b/i.test(c)))];
  facts.push(makeFact(
    '7.3',
    lintCmds.length
      ? `Lint command(s) found: ${lintCmds.map((c) => `"${c}"`).join(', ')} (jobs: ${jobList}).`
      : `No lint step detected among run steps (jobs: ${jobList}).`,
    source,
  ));

  // Probe 7.4 must always produce a fact — a missing scanner is itself the
  // finding, so this never takes the "nothing to inspect" path once CI
  // configuration exists at all.
  const lowerText = combinedText.toLowerCase();
  const foundScanner = SCANNER_KEYWORDS.find((kw) => lowerText.includes(kw));
  facts.push(makeFact(
    '7.4',
    foundScanner
      ? `dependency/secret scanning step found in CI: references "${foundScanner}"`
      : `no dependency scan and no secret scan step found in CI workflows (checked for: ${SCANNER_KEYWORDS.join(', ')})`,
    source,
  ));

  return { facts, unavailable: [] };
}

// --- 7.5 / 5.5: containers ------------------------------------------------

const FROM_RE = /^FROM\s+(\S+)/i;
const ENV_ARG_RE = /^\s*(ENV|ARG)\s+/i;

function findDockerfiles(dir) {
  return safeReaddir(dir)
    .filter((name) => /^dockerfile/i.test(name))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    });
}

// `roots`, when supplied, is a precomputed discoverRoots(target) result —
// collectStatic computes it once and threads it into every collector that
// needs it, instead of each of the three walking the filesystem again for
// the same answer. Omit it (as every direct caller in the test suite does)
// to fall back to discovering it locally, so this function's standalone
// behaviour is unchanged.
export function containerFacts(dir, roots) {
  const target = resolve(dir);
  const projectRoots = roots ?? discoverRoots(target);
  const facts = [];
  let dockerfilesFound = 0;

  for (const root of projectRoots) {
    for (const name of findDockerfiles(root)) {
      dockerfilesFound += 1;
      const fullPath = join(root, name);
      const relPath = relative(target, fullPath);
      const content = readFileSync(fullPath, 'utf8');
      const lines = content.split(/\r?\n/);

      // 7.5: every Dockerfile must contribute a fact, even one with no FROM
      // instruction at all — a silent "no facts produced" for that file is
      // indistinguishable from "not inspected", which is exactly the class
      // of bug this restructure exists to close.
      const fromMatches = lines.map((l) => FROM_RE.exec(l)).filter(Boolean);
      if (fromMatches.length === 0) {
        facts.push(makeFact('7.5', `${relPath} has no FROM instruction to check for digest pinning`, relPath));
      } else {
        for (const m of fromMatches) {
          const image = m[1];
          const pinned = image.includes('@sha256:');
          facts.push(makeFact(
            '7.5',
            pinned
              ? `FROM ${image} is pinned by digest`
              : `FROM ${image} is not pinned by digest (expected an @sha256:<digest> reference)`,
            relPath,
          ));
        }
      }

      // 5.5: does any ENV/ARG line bake in a value matching a known secret
      // pattern? Delegate detection entirely to scanText (Task 5's hardened
      // scanner) rather than re-implementing pattern iteration here.
      let findings = [];
      try {
        findings = scanText(content, relPath);
      } catch {
        findings = [];
      }
      const envArgHits = findings.filter((f) => ENV_ARG_RE.test(lines[f.line - 1] ?? ''));
      if (envArgHits.length > 0) {
        for (const hit of envArgHits) {
          facts.push(makeFact('5.5', hit.description, `${relPath}:${hit.line}:${hit.column}`));
        }
      } else {
        facts.push(makeFact(
          '5.5',
          `no ENV/ARG instruction in ${relPath} assigns a value matching a known secret pattern`,
          relPath,
        ));
      }
    }
  }

  if (dockerfilesFound === 0) {
    const reason = 'no Dockerfile found (checked target root and nested project directories)';
    return { facts: [], unavailable: [{ probe: '7.5', reason }, { probe: '5.5', reason }] };
  }

  return { facts, unavailable: [] };
}

// --- 1.7 / 8.4: dependencies ----------------------------------------------

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'];
const AUDIT_MAX_BUFFER = 50 * 1024 * 1024;
const AUDIT_TIMEOUT_MS = 30_000;

function runNpmAudit(dir) {
  // On Windows, npm is a .cmd shim. Since Node's CVE-2024-27980 fix,
  // spawning a .cmd/.bat file directly (no shell) throws EINVAL rather than
  // running it — confirmed by reproducing the throw in isolation. Node's own
  // guidance for this exact case is `shell: true`. That does trigger a
  // DEP0190 warning ("arguments are not escaped, only concatenated") because
  // shell:true plus an args array skips argv-style escaping — but the args
  // here are a fixed two-element literal (['audit', '--json']) with no
  // interpolated or user-controlled content, so the injection risk the
  // warning describes does not apply at this call site. `cwd` (which does
  // carry the untrusted target path, and is where a space in the path would
  // matter) is a separate spawn option, not text placed in the shell
  // command line, and is unaffected by the escaping behaviour shell:true
  // changes — verified directly against a path containing a space.
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const prevNoDeprecation = process.noDeprecation;
  if (process.platform === 'win32') process.noDeprecation = true;
  let res;
  try {
    res = spawnSync(cmd, ['audit', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: AUDIT_MAX_BUFFER,
      timeout: AUDIT_TIMEOUT_MS,
      shell: process.platform === 'win32',
    });
  } finally {
    process.noDeprecation = prevNoDeprecation;
  }

  // npm audit exits non-zero when it finds vulnerabilities — that's data,
  // not a failure, so stdout is read unconditionally regardless of status.
  // A spawn error (res.error) is a different thing entirely: the tool never
  // ran, so this must be reported as "could not run", never conflated with
  // "ran and found nothing".
  if (res.error) {
    return { ok: false, reason: `npm audit could not be invoked (${res.error.code ?? res.error.message})` };
  }
  if (!res.stdout) {
    return { ok: false, reason: 'npm audit produced no output to parse' };
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return { ok: false, reason: 'npm audit output could not be parsed as JSON' };
  }
  const counts = parsed?.metadata?.vulnerabilities ?? parsed?.vulnerabilities ?? null;
  if (!counts) {
    return { ok: false, reason: 'npm audit ran but its output had no recognizable vulnerability-count field' };
  }
  const parts = Object.entries(counts)
    .filter(([k]) => k !== 'total')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return { ok: true, summary: `npm audit vulnerability counts — ${parts}` };
}

function runGoList(dir) {
  const res = spawnSync('go', ['list', '-m', '-json', 'all'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: AUDIT_MAX_BUFFER,
    timeout: AUDIT_TIMEOUT_MS,
  });
  if (res.error) {
    return { ok: false, reason: `go list could not be invoked (${res.error.code ?? res.error.message})` };
  }
  if (!res.stdout) {
    return { ok: false, reason: 'go list produced no output to parse' };
  }
  const count = (res.stdout.match(/"Path":/g) ?? []).length;
  if (count === 0) {
    return { ok: false, reason: 'go list ran but reported no modules (unexpected for a go.mod-bearing root)' };
  }
  return { ok: true, summary: `go module graph inspected via go list — ${count} module(s) found` };
}

// go list enumerates the module graph but says nothing about known
// vulnerabilities in it — on a real audit of a Go+React stack this left
// probe 8.4 with an npm-side severity count and a Go-side module count that
// looked like coverage but answered a different question entirely, so Go
// CVE exposure was simply unknown. govulncheck closes that gap.
const GOVULNCHECK_INSTALL_CMD = 'go install golang.org/x/vuln/cmd/govulncheck@latest';

// Pure parsing/summarising logic, deliberately kept separate from the
// spawnSync wrapper below so it can be unit-tested against a synthetic
// newline-delimited JSON fixture that matches govulncheck's documented
// output schema (see the Message/Finding/Frame types under
// https://pkg.go.dev/golang.org/x/vuln/internal/govulncheck) without
// needing the real binary — there is no mocking library under this
// project's zero-runtime-dependency constraint, and govulncheck is very
// likely absent on any given contributor's machine (it was absent on the
// machine this was written on), so the real tool cannot be relied on to
// exercise the reachable/uncalled distinction end to end.
//
// Returns null if stdout contained no parseable JSON line at all (treated
// by the caller as a failed run, not a clean scan of zero findings).
export function summarizeGovulncheckOutput(stdout) {
  const messages = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // One malformed/truncated line must not abort the parse of every
      // other line — govulncheck's own contract only promises each *value*
      // is valid JSON, not that stray blank lines never appear.
    }
  }
  if (messages.length === 0) return null;

  // A single OSV can appear across several finding messages at different
  // scan levels — module-level, package-level, and (only if the call graph
  // actually reaches it) one or more symbol-level findings — so results are
  // grouped by finding.osv and the most specific evidence per group is kept,
  // rather than reporting the same CVE twice at two different confidence
  // levels. Message.osv entries (separate from Message.finding entries)
  // carry the human-readable summary for an OSV ID.
  const osvSummaries = new Map();
  const byOsv = new Map();

  for (const msg of messages) {
    if (msg?.osv?.id) {
      osvSummaries.set(msg.osv.id, msg.osv.summary || msg.osv.details || msg.osv.id);
    }
    if (msg?.finding?.osv) {
      const id = msg.finding.osv;
      const entry = byOsv.get(id) ?? { called: false, moduleVersion: null, fixedVersion: null };
      const trace = Array.isArray(msg.finding.trace) ? msg.finding.trace : [];
      // govulncheck's own doc comment: "For module level source findings,
      // the trace will contain a single-frame with no symbol... For package
      // level source findings, the trace will contain a single-frame with
      // no symbol[.]" A symbol-level (reachable/called) finding is the only
      // kind whose trace carries an actual function name, so the presence
      // of any frame with a `function` field is the signal that the
      // vulnerable code is actually called, not merely imported.
      if (trace.some((f) => typeof f?.function === 'string' && f.function.length > 0)) {
        entry.called = true;
      }
      if (!entry.moduleVersion && trace[0]?.module) {
        entry.moduleVersion = trace[0].version ? `${trace[0].module}@${trace[0].version}` : trace[0].module;
      }
      if (!entry.fixedVersion && msg.finding.fixed_version) {
        entry.fixedVersion = msg.finding.fixed_version;
      }
      byOsv.set(id, entry);
    }
  }

  const findingLines = [];
  let calledCount = 0;
  for (const [id, entry] of byOsv) {
    if (entry.called) calledCount += 1;
    const summary = osvSummaries.get(id) ?? id;
    const where = entry.moduleVersion ? ` (${entry.moduleVersion})` : '';
    const fix = entry.fixedVersion ? `, fixed in ${entry.fixedVersion}` : ', no fixed version published yet';
    // "Vulnerable and reachable" (a real call-stack trace exists) and
    // "vulnerable dependency present but uncalled" are materially different
    // evidence — the fact text must never blur the two together.
    findingLines.push(
      entry.called
        ? `${id} is vulnerable and reachable (called)${where}: ${summary}${fix}`
        : `${id}: vulnerable dependency present but not called (uncalled)${where}: ${summary}${fix}`,
    );
  }

  const uncalledCount = byOsv.size - calledCount;
  const summary = byOsv.size === 0
    ? 'govulncheck found no known vulnerabilities in the module graph'
    : `govulncheck found ${byOsv.size} known vulnerabilit${byOsv.size === 1 ? 'y' : 'ies'} in the module graph — ${calledCount} reachable (called), ${uncalledCount} imported but not called`;

  return { summary, findingLines };
}

function runGovulncheck(dir) {
  // Unlike npm's Windows shim (a .cmd file that CreateProcess cannot launch
  // directly, per Node's CVE-2024-27980 fix — hence shell: true on the npm
  // path above), `go install .../govulncheck@latest` builds a real native
  // executable (govulncheck.exe on Windows), not a script wrapper. Verified
  // directly against this machine: spawnSync('govulncheck', [...]) against
  // the absent binary reports a plain res.error.code === 'ENOENT', not the
  // EINVAL a shim throws — so no shell is needed here, and adding
  // shell: true would only reintroduce that option's escaping caveats for
  // no benefit.
  const res = spawnSync('govulncheck', ['-json', './...'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: AUDIT_MAX_BUFFER,
    timeout: AUDIT_TIMEOUT_MS,
  });

  // A spawn failure (tool not on PATH, most commonly — govulncheck is an
  // opt-in install, not part of the Go toolchain) is categorically
  // different from a clean scan that found nothing, and must never be
  // reported in a way that could be read as "no vulnerabilities found".
  if (res.error) {
    return {
      ok: false,
      reason: `govulncheck could not be invoked (${res.error.code ?? res.error.message}) — install with "${GOVULNCHECK_INSTALL_CMD}" and ensure it is on PATH`,
    };
  }

  // govulncheck exits non-zero (status 3) when it finds vulnerabilities —
  // that is data, not a failed run, exactly like npm audit above — so
  // stdout is read unconditionally regardless of res.status.
  if (!res.stdout) {
    return { ok: false, reason: 'govulncheck produced no output to parse' };
  }

  const parsed = summarizeGovulncheckOutput(res.stdout);
  if (!parsed) {
    return { ok: false, reason: 'govulncheck output could not be parsed as newline-delimited JSON' };
  }
  return { ok: true, ...parsed };
}

export function dependencyFacts(dir, roots) {
  const target = resolve(dir);
  const projectRoots = roots ?? discoverRoots(target);
  const facts = [];
  const unavailable = [];
  // 8.4 outcomes are collected per-root here first, then reconciled once at
  // the end — see the comment below the loop for why: a probe must never
  // appear in both facts and unavailable at once, but a multi-root target
  // (the normal case once discovery spans a monorepo) can easily have one
  // root's audit succeed while another's fails.
  const pendingAuditFailures = []; // { reason, source }
  let anyManifest = false;

  for (const root of projectRoots) {
    const relRoot = relative(target, root) || '.';
    const hasPackageJson = existsSync(join(root, 'package.json'));
    const foundLock = LOCKFILES.find((f) => existsSync(join(root, f)));
    const hasGoMod = existsSync(join(root, 'go.mod'));

    if (hasPackageJson) {
      anyManifest = true;
      const pkg = readJsonSafe(join(root, 'package.json'));
      const depCount = pkg
        ? Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length
        : 0;
      const plural = depCount === 1 ? 'entry' : 'entries';
      const pkgSource = join(relRoot, 'package.json');
      facts.push(makeFact(
        '1.7',
        foundLock
          ? `${pkgSource} declares ${depCount} dependency ${plural}; resolved versions pinned via ${foundLock}`
          : `${pkgSource} declares ${depCount} dependency ${plural}; no lockfile found (checked ${LOCKFILES.join(', ')}) so resolved versions are not pinned`,
        pkgSource,
      ));

      if (foundLock) {
        const audit = runNpmAudit(root);
        if (audit.ok) {
          facts.push(makeFact('8.4', audit.summary, join(relRoot, foundLock)));
        } else {
          pendingAuditFailures.push({
            reason: `npm audit in ${relRoot}: ${audit.reason}`,
            source: join(relRoot, foundLock),
          });
        }
      } else {
        facts.push(makeFact(
          '8.4',
          `no vulnerability scan run for ${relRoot}: no lockfile found for npm audit`,
          pkgSource,
        ));
      }
    }

    if (hasGoMod) {
      anyManifest = true;
      const hasGoSum = existsSync(join(root, 'go.sum'));
      const goModSource = join(relRoot, 'go.mod');
      facts.push(makeFact(
        '1.7',
        hasGoSum
          ? `${goModSource} present; resolved versions pinned via go.sum`
          : `${goModSource} present; no go.sum found so resolved versions are not pinned`,
        goModSource,
      ));

      const goResult = runGoList(root);
      if (goResult.ok) {
        facts.push(makeFact('8.4', goResult.summary, goModSource));
      } else {
        pendingAuditFailures.push({
          reason: `go list in ${relRoot}: ${goResult.reason}`,
          source: goModSource,
        });
      }

      // go list above only enumerates the module graph; govulncheck is what
      // actually answers the 8.4 vulnerability question for Go, mirroring
      // npm audit's role on the npm side. Run independently of go list's
      // outcome — a go.mod-bearing root deserves an attempted vuln scan
      // even if, say, go list's own output happened to be unparsable.
      const vulnResult = runGovulncheck(root);
      if (vulnResult.ok) {
        facts.push(makeFact('8.4', vulnResult.summary, goModSource));
        for (const line of vulnResult.findingLines) {
          facts.push(makeFact('8.4', line, goModSource));
        }
      } else {
        pendingAuditFailures.push({
          reason: `govulncheck in ${relRoot}: ${vulnResult.reason}`,
          source: goModSource,
        });
      }
    }
  }

  // Reconcile 8.4 at the probe level so it lands in exactly one place, never
  // both: if at least one root produced real 8.4 evidence, every failed
  // root becomes an additional fact naming which root could not be
  // inspected (partial coverage is itself evidence, not a gap in a probe
  // that otherwise has data). Only when nothing succeeded anywhere does a
  // failure become a genuine unavailable[] gap for 8.4.
  const hasSuccessfulAudit = facts.some((f) => f.probe === '8.4');
  for (const failure of pendingAuditFailures) {
    if (hasSuccessfulAudit) {
      facts.push(makeFact(
        '8.4',
        `${failure.reason} (this root could not be inspected; other 8.4 facts above cover roots that were)`,
        failure.source,
      ));
    } else {
      unavailable.push({ probe: '8.4', reason: failure.reason });
    }
  }

  if (!anyManifest) {
    const reason = 'no package.json or go.mod found (checked target root and nested project directories)';
    unavailable.push({ probe: '1.7', reason }, { probe: '8.4', reason });
  }

  return { facts, unavailable };
}

// --- 1.4 / 8.3: client bundles --------------------------------------------

// A single corrupt/adversarial vendored bundle can produce an unbounded
// number of regex matches (a reviewer measured 262,144 findings from one
// 8 MB file against Task 5's scanner). Findings are capped per file so one
// bad file cannot blow up the size of the evidence document; the cap is
// recorded as an explicit fact rather than silently dropping the overflow.
const MAX_FINDINGS_PER_FILE = 200;
const BUNDLE_EXTENSIONS = new Set(['.js', '.css', '.map', '.html']);

function walkBundleFiles(root) {
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && BUNDLE_EXTENSIONS.has(extname(entry.name))) {
        results.push(full);
      }
    }
  }
  return results;
}

export function bundleFacts(dir, roots) {
  const target = resolve(dir);
  const projectRoots = roots ?? discoverRoots(target);
  const primaryFacts = []; // 1.4 always wins tie-break lookups on the same finding — 8.3 is appended after
  const serviceKeyFacts = [];
  let anyBundleDirFound = false;

  for (const root of projectRoots) {
    for (const bundleDirName of BUNDLE_DIR_NAMES) {
      const bundleDir = join(root, bundleDirName);
      if (!isDir(bundleDir)) continue;
      anyBundleDirFound = true;

      const files = walkBundleFiles(bundleDir);
      const relBundleDir = relative(target, bundleDir) || bundleDirName;
      let totalFindingsInDir = 0;

      for (const filePath of files) {
        let content;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        const relPath = relative(target, filePath);
        let findings;
        try {
          findings = scanText(content, relPath);
        } catch {
          continue; // one unparsable/pathological file must not abort collection
        }

        totalFindingsInDir += findings.length;
        const capped = findings.slice(0, MAX_FINDINGS_PER_FILE);

        for (const finding of capped) {
          const source = `${relPath}:${finding.line}:${finding.column}`;
          primaryFacts.push(makeFact('1.4', finding.description, source));
          // "Service/admin key reaches the client" (8.3) is a stricter claim
          // than "a secret-shaped string is in the bundle" (1.4): a bare
          // env-var *name* exposed by its public prefix names a risk but is
          // not itself a captured credential value, so it is excluded here.
          // Every other kind — JWTs included — is a concrete matched
          // credential value and counts as a service/admin key finding too.
          if (finding.kind !== 'public-prefixed secret name') {
            serviceKeyFacts.push(makeFact('8.3', finding.description, source));
          }
        }

        if (findings.length > MAX_FINDINGS_PER_FILE) {
          primaryFacts.push(makeFact(
            '1.4',
            `finding cap reached for ${relPath}: showing ${MAX_FINDINGS_PER_FILE} of ${findings.length} matches (per-file cap applied to bound report size)`,
            relPath,
          ));
        }
      }

      // A directory that was found, walked and scanned but yielded nothing
      // is a positive result — "scanned, clean" — not the same as "never
      // looked". Reporting nothing here would be indistinguishable from an
      // untouched probe, which is exactly the silent-absence bug this
      // restructure exists to close.
      if (totalFindingsInDir === 0) {
        primaryFacts.push(makeFact(
          '1.4',
          `${files.length} file(s) scanned in ${relBundleDir}; no secret-shaped findings`,
          relBundleDir,
        ));
        serviceKeyFacts.push(makeFact(
          '8.3',
          `${files.length} file(s) scanned in ${relBundleDir}; no service/admin key values found`,
          relBundleDir,
        ));
      }
    }
  }

  if (!anyBundleDirFound) {
    const reason = 'no build output found (checked dist/, build/, .next/, out/ under target root and nested project directories)';
    return { facts: [], unavailable: [{ probe: '1.4', reason }, { probe: '8.3', reason }] };
  }

  return { facts: [...primaryFacts, ...serviceKeyFacts], unavailable: [] };
}

// --- composition ------------------------------------------------------

function getGitRef(dir) {
  const res = spawnSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  if (res.error || res.status !== 0 || !res.stdout) return null;
  return res.stdout.trim();
}

const COLLECTORS = [migrationFacts, ciFacts, containerFacts, dependencyFacts, bundleFacts];

export function collectStatic(dir) {
  // Important 5: resolve once, up front, and thread the absolute path
  // through every collector (each of which also resolves defensively on its
  // own entry). A relative CLI argument previously flowed straight into
  // target.path and every source field with no record of the invoking cwd
  // needed to make sense of it.
  const target = resolve(dir);
  const collectedAt = new Date().toISOString();
  const facts = [];
  const unavailable = [];

  // Critical 1: an auditor needs to know what was actually covered. This is
  // recorded as an explicit fact (not just implied by which other facts
  // happen to exist) under a coverage-metadata pseudo-probe rather than a
  // scored rubric probe, since "which directories were walked" isn't itself
  // one of the 13-layer probes — it's evidence *about* the evidence.
  //
  // Computed once here and threaded into every collector below that needs
  // it (containerFacts, dependencyFacts, bundleFacts) instead of each of
  // them re-walking the filesystem for the same answer — a full run
  // previously called discoverRoots() four times over. migrationFacts and
  // ciFacts don't take a roots argument at all; passing it along is
  // harmless, they simply ignore it.
  const roots = discoverRoots(target);
  const relRoots = roots.map((r) => relative(target, r) || '.');
  facts.push(makeFact(
    'meta.roots',
    `${relRoots.length} project root(s) discovered for static analysis: ${relRoots.length ? relRoots.join(', ') : '(none)'}`,
    relative(target, target) || '.',
  ));

  for (const collector of COLLECTORS) {
    const { facts: collectedFacts, unavailable: collectedGaps } = collector(target, roots);
    facts.push(...collectedFacts);
    unavailable.push(...collectedGaps);
  }

  return {
    tier: 'static',
    collectedAt,
    target: { path: target, ref: getGitRef(target) },
    facts,
    unavailable,
  };
}
