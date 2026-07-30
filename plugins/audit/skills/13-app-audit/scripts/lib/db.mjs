import { spawnSync } from 'node:child_process';

// Direct Postgres inspection for probes 8.1, 8.2, 3.2, 3.4 and 3.8 — the
// difference between what a schema's migrations *intend* (collect-static.mjs
// reads DDL) and what is actually enforced on the running database right
// now. Zero runtime dependencies is a hard constraint for this project, so
// this shells out to `psql` exactly as repo.mjs shells out to `npm audit`,
// `go list` and `govulncheck`, rather than implementing the Postgres wire
// protocol or adding a driver dependency.
//
// SAFETY — this module exists specifically to be safe against a real
// production database, not merely a happy-path evidence collector:
//
//   1. Structurally incapable of writing. Every query below runs through
//      runPsqlQueryReal, which wraps it in `--single-transaction` (psql
//      itself issues BEGIN before the first -c and COMMIT/ROLLBACK after the
//      last) with `SET TRANSACTION READ ONLY` as the FIRST statement inside
//      that transaction. That is not a client-side convention a malformed
//      query could route around — Postgres itself rejects any write inside a
//      READ ONLY transaction at the server, regardless of what the query
//      text says. `-v ON_ERROR_STOP=1` additionally guarantees any failing
//      statement (including SET TRANSACTION READ ONLY itself, if it ever
//      somehow failed) stops the sequence rather than silently continuing to
//      the next -c with psql's default non-interactive error handling.
//   2. Bounded. `SET statement_timeout` bounds a single query against a busy
//      database; the spawnSync `timeout` option and `PGCONNECT_TIMEOUT` both
//      bound connection establishment itself, so a database that never
//      responds at the TCP level cannot hang the collector indefinitely
//      either. A timeout is classified as its own `kind: 'timeout'` (see
//      interpretPsqlResult) — never confused with "psql is not installed".
//   3. `-X` (--no-psqlrc): psql is invoked with start-up file reading
//      disabled outright. Without this, a `~/.psqlrc` (system-wide or the
//      connecting user's) is read AFTER the connection opens but BEFORE any
//      `-c` command runs, and can run arbitrary meta-commands (`\conninfo`,
//      `\o`, `\pset format aligned`, ...) that print to the exact same
//      stdout stream this module parses, or silently undo the -t/--csv
//      formatting options below. A psqlrc containing `\conninfo` prints the
//      host, user and database in one human-readable sentence — this was a
//      real, demonstrated leak path (Critical 1 in review) before -X was
//      added, because the dbname captured from the bootstrap query flowed
//      unchecked into every fact's `source` field.
//   4. The bootstrap query's result is validated, not trusted. Even with -X,
//      "trust psql's exit code and stdout shape" is not itself a safe
//      assumption (Critical 2 in review): an exit-0 run with zero rows, a
//      leaked header row, or output mangled by something other than psqlrc
//      must never be read as "genuinely inspected, found nothing" on a
//      security-gating probe. validateBootstrap() requires the bootstrap
//      query to return EXACTLY one row of one field matching a conservative
//      database-name pattern; anything else fails the whole run (all five
//      probes go to `unavailable`) rather than proceeding with an unverified
//      `dbname` that would otherwise be interpolated into every fact and
//      source. Every other query is subject to the same discipline at
//      smaller scale: parseRows() enforces an exact field count (arity) per
//      row and typed field validators (parseBoolT/parseIntStrict) reject
//      anything that isn't unambiguously the expected shape — a query whose
//      output doesn't parse cleanly becomes `unavailable` for that probe, it
//      never falls through and gets read as "no findings".
//   5. Output is parsed as CSV (`--csv`), not a naive delimiter split. An
//      identifier or a Supabase-dashboard-authored policy name can contain
//      almost any character, including a pipe, a comma, or an embedded
//      newline — plain field-splitting corrupts row/column boundaries on
//      exactly the tables and policies most worth reporting correctly
//      (Important 3 in review). CSV's quoting rules round-trip those
//      characters correctly; parseCsv() below is a small hand-written
//      RFC4180-shaped parser (quoted fields, doubled-quote escaping, and
//      embedded newlines/commas inside a quoted field), sufficient for what
//      psql actually emits without adding a dependency.
//   6. The DSN never reaches an emitted fact, source, reason or target field
//      — see the "no DSN in output" discipline below.
//
// NO-DSN-IN-OUTPUT DISCIPLINE: interpretPsqlResult() never copies psql's own
// stderr text into a returned `reason` — every failure reason below is a
// fixed, hand-authored string keyed off a coarse classification of stderr
// (timeout / connection / auth / other), never an interpolation of stderr
// itself. This is deliberate and stronger than trying to regex-scrub a host
// or password out of arbitrary driver error text after the fact: psql's own
// connection-failure messages routinely embed the host
// ("could not connect to server ... on host \"10.0.0.5\""), and a scrubber
// that missed one shape (an IPv6 literal, an unusual hostname character) is
// a silent leak. A reason string built from zero dynamic content copied out
// of stderr is leak-proof by construction, not by pattern coverage. The same
// discipline extends to malformed-output reasons (safeParseQuery): those
// report field counts and type labels, never the actual (possibly
// attacker- or psqlrc-controlled) field text. The only dynamic content
// permitted in a reason or fact anywhere in this file is `dbname` — and only
// after validateBootstrap() has confirmed it matches a conservative
// identifier pattern, never the raw DSN or raw psql output.
const STATEMENT_TIMEOUT_MS = 5_000;
const SPAWN_TIMEOUT_MS = 15_000;
const DB_MAX_BUFFER = 10 * 1024 * 1024;

const PSQL_INSTALL_HINT = 'install the PostgreSQL client tools so "psql" is on PATH '
  + '(e.g. "apt-get install postgresql-client" on Debian/Ubuntu, '
  + '"brew install libpq && brew link --force libpq" on macOS, '
  + 'or the installer at https://www.postgresql.org/download/ on Windows) — '
  + 'version 12 or later is required for --csv output';

const EXCLUDED_SCHEMAS = "'pg_catalog','information_schema','pg_toast'";

// Every query is read-only and touches only system catalogs / stats views —
// nothing here ever names a target-defined table by anything other than a
// join against pg_class/pg_namespace, so there is no user-controlled SQL
// text anywhere in this module.
const QUERIES = {
  bootstrap: 'SELECT current_database()',

  // 8.1 [G2]: per-table RLS status plus policy count. LEFT JOIN so a table
  // with RLS enabled but zero policies still appears (with policycount 0) —
  // that is itself the finding "denies all access", distinct from RLS being
  // off entirely, and both must be visible from one query.
  rls: `SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, COUNT(p.policyname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE c.relkind IN ('r','p') AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
GROUP BY n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY n.nspname, c.relname`,

  // 8.2: per-policy cmd/permissive/roles, plus the actual qual/with_check
  // expression text (not just presence) — needed to detect a WITH CHECK
  // that is a literal `true` (no real constraint at all). Safe to capture
  // now that output is parsed as CSV: any character an expression contains,
  // including a comma or embedded newline, round-trips correctly.
  policies: `SELECT schemaname, tablename, policyname, cmd, permissive,
       COALESCE(array_to_string(roles, ','), ''),
       COALESCE(qual, ''),
       COALESCE(with_check, '')
FROM pg_policies
ORDER BY schemaname, tablename, policyname`,

  // 3.2: unused-index detection (idx_scan = 0).
  idxUsage: `SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
ORDER BY schemaname, relname, indexrelname`,

  // 3.2: table-level scan counts (sequential vs. index).
  tableScans: `SELECT schemaname, relname, seq_scan, idx_scan
FROM pg_stat_user_tables
ORDER BY schemaname, relname`,

  // 3.2: when stats were last reset — idx_scan accumulates since this
  // moment, so a reader needs it to judge whether a 0 is meaningful.
  statsReset: `SELECT pg_stat_get_db_stat_reset_time(oid) FROM pg_database WHERE datname = current_database()`,

  // 3.4: foreign key / unique / check constraint counts.
  constraintCounts: `SELECT con.contype, COUNT(*)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype IN ('f','u','c') AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
GROUP BY con.contype
ORDER BY con.contype`,

  // 3.4: tables with no foreign key constraint at all.
  noFkTables: `SELECT n.nspname, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p') AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
  AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conrelid = c.oid AND con.contype = 'f')
ORDER BY n.nspname, c.relname`,

  // 3.8: pool ceiling vs. current usage.
  connections: `SELECT
  (SELECT setting FROM pg_settings WHERE name = 'max_connections'),
  (SELECT setting FROM pg_settings WHERE name = 'superuser_reserved_connections'),
  (SELECT COUNT(*) FROM pg_stat_activity)`,
};

// --- DSN resolution ----------------------------------------------------
//
// Preference order: PGURL (an explicit env var this collector reads itself —
// not one libpq knows about) beats --dsn beats "nothing, let psql read its
// own PGHOST/PGDATABASE/PGUSER/PGPASSWORD/... environment variables (or its
// compiled-in defaults) natively". A command-line --dsn value lands in the
// invoking shell's history (and is visible to other users on the same
// machine via the process list for as long as this command runs); the
// environment does neither.

export function resolveDsn({ dsnFlag, env = process.env } = {}) {
  if (env.PGURL) return { dsn: env.PGURL, source: 'PGURL environment variable' };
  if (dsnFlag) return { dsn: dsnFlag, source: '--dsn flag' };
  return {
    dsn: null,
    source: 'PG* environment variables read natively by psql (PGHOST/PGDATABASE/PGUSER/...), or psql\'s own defaults if none are set',
  };
}

// --- psql invocation -----------------------------------------------------

export function buildPsqlArgs({ dsn, sql, timeoutMs }) {
  const args = [
    // -X / --no-psqlrc: do not read any start-up file at all. This is the
    // primary defence for Critical 1 — see the SAFETY comment (point 3) at
    // the top of this file for what a psqlrc could otherwise do.
    '-X',
    // -q: suppress psql's own command-tag echo (BEGIN / SET / COMMIT) so
    // stdout carries only the one SELECT's tuple rows — otherwise those
    // status lines would interleave with the data this module parses.
    '-q',
    // --csv (+ -t to still suppress the header row/footer): see SAFETY
    // point 5 above for why a naive delimiter split is not safe here.
    '--csv',
    '-t',
    '-v', 'ON_ERROR_STOP=1',
    '--single-transaction',
    // SET TRANSACTION READ ONLY is deliberately -c #1, ahead of every
    // payload query, and statement_timeout is #2 — see SAFETY point 1/2.
    // search_path is #3, still ahead of the payload: -X stops a psqlrc from
    // altering behaviour, but ALTER ROLE ... SET search_path, a PGOPTIONS
    // value, or an options= parameter embedded in the DSN are the same
    // attack by another route — any of them could shadow pg_class,
    // pg_policies, pg_stat_user_indexes etc. with a same-named decoy relation
    // in an earlier schema. Every relation this module queries is a system
    // catalog/stats view that lives in pg_catalog, so pinning search_path
    // there is a complete fix, not a partial mitigation.
    '-c', 'SET TRANSACTION READ ONLY',
    '-c', `SET statement_timeout = ${timeoutMs}`,
    '-c', 'SET search_path = pg_catalog',
    '-c', sql,
  ];
  // The connection string, if any, is the final positional argument — kept
  // as one opaque token handed straight through to psql/libpq, never parsed
  // or logged by this module.
  if (dsn) args.push(dsn);
  return args;
}

// Pure classification of a spawnSync-shaped result, split out from the
// spawnSync call itself for the same reason repo.mjs's
// interpretGovulncheckResult is: it lets every failure path be exercised by
// a unit test against a constructed result object, without a live database
// (none exists under this project's zero-mocking-library, zero-dependency
// constraint) and without ever risking a real DSN in a test fixture.
//
// Every branch below returns a reason built entirely from fixed strings and,
// at most, the numeric exit status — never from res.stderr. See the
// NO-DSN-IN-OUTPUT comment at the top of this file for why that is
// deliberate rather than an oversight: psql's own connection-failure text
// routinely names the host, and a reason field is exactly the kind of place
// that gets copied into a findings register a client might paste elsewhere.
export function interpretPsqlResult(res) {
  if (res.error) {
    // spawnSync sets error.code === 'ETIMEDOUT' specifically when the
    // process was killed for exceeding the `timeout` option — categorically
    // different from the binary never existing (ENOENT), and reported as
    // such: a database that doesn't answer within the timeout is itself
    // relevant evidence for 3.8 (connection headroom), not a "go install
    // psql" instruction pointed at the wrong problem (Important 5).
    if (res.error.code === 'ETIMEDOUT') {
      return {
        ok: false,
        kind: 'timeout',
        reason: 'psql did not complete before the configured timeout and was terminated — the database may be unreachable, overloaded, or otherwise not responding at normal speed (itself relevant evidence for probe 3.8, connection headroom)',
      };
    }
    // ENOBUFS: spawnSync sets this when a child's stdout/stderr exceeds the
    // `maxBuffer` option — reachable in practice against a policy- or
    // table-heavy database, and means the query genuinely ran and produced
    // real output, the opposite of "psql is not installed".
    if (res.error.code === 'ENOBUFS') {
      return {
        ok: false,
        kind: 'error',
        reason: 'psql produced more output than this collector allows and was cut off — a real result was truncated (likely a policy- or table-heavy database), not a failed connection or a missing tool',
      };
    }
    // EACCES/EPERM: the psql binary was found but could not be executed
    // (file permissions) — a local environment problem, not evidence the
    // tool is absent.
    if (res.error.code === 'EACCES' || res.error.code === 'EPERM') {
      return {
        ok: false,
        kind: 'error',
        reason: 'psql is present but could not be executed (permission denied) — check the executable\'s file permissions; this is not the same as psql being uninstalled',
      };
    }
    // EMFILE/ENFILE: the OS refused to hand out a new file descriptor/process
    // slot — a resource-exhaustion condition on this machine, unrelated to
    // whether psql exists or the database is reachable.
    if (res.error.code === 'EMFILE' || res.error.code === 'ENFILE') {
      return {
        ok: false,
        kind: 'error',
        reason: 'psql could not be started because this machine has run out of file descriptors or process slots — a local resource-exhaustion problem, not a missing tool or a database issue',
      };
    }
    return {
      ok: false,
      kind: 'unavailable-tool',
      reason: `psql could not be invoked (${res.error.code ?? res.error.message}) — ${PSQL_INSTALL_HINT}`,
    };
  }

  if (res.status !== 0) {
    const stderr = res.stderr ?? '';
    if (/canceling statement due to statement timeout/i.test(stderr)) {
      return {
        ok: false,
        kind: 'timeout',
        reason: 'the query was cancelled after exceeding statement_timeout — the database may be busy, or the query slower than expected against its current data volume',
      };
    }
    if (/timeout expired|timed out|could not connect to server|could not translate host name|connection refused|server closed the connection unexpectedly/i.test(stderr)) {
      return {
        ok: false,
        kind: 'connection',
        reason: 'could not establish a connection to the database within the configured timeout (host unreachable, connection refused, or DNS/TCP-level failure)',
      };
    }
    if (/password authentication failed|no pg_hba\.conf entry|role .* does not exist|permission denied|fe_sendauth/i.test(stderr)) {
      return {
        ok: false,
        kind: 'auth',
        reason: 'authentication or authorisation to the database failed (check the role, password, and pg_hba.conf/pg_ident rules — a read-only role is the expected input here)',
      };
    }
    return {
      ok: false,
      kind: 'error',
      reason: `psql exited with status ${res.status}; the query did not complete (rerun the same connection manually with psql for full diagnostic detail — this collector deliberately does not echo psql's stderr, which can embed the target host)`,
    };
  }

  return { ok: true, stdout: res.stdout ?? '' };
}

function runPsqlQueryReal({ dsn, sql, timeoutMs = STATEMENT_TIMEOUT_MS, spawnTimeoutMs = SPAWN_TIMEOUT_MS }) {
  // psql on every platform this project targets — including psql.exe from
  // the official Windows installer — is a real executable, not a .cmd/.bat
  // shim (unlike npm on Windows; see repo.mjs's runNpmAudit comment). A
  // missing binary therefore surfaces as a plain res.error.code === 'ENOENT'
  // with no shell needed, mirroring govulncheck's reasoning in repo.mjs.
  const args = buildPsqlArgs({ dsn, sql, timeoutMs });
  // PGCONNECT_TIMEOUT bounds libpq's own connection attempt (DNS + TCP
  // handshake), which the spawnSync `timeout` option alone would not reach
  // in time to prevent a multi-minute OS-level TCP stall against a host that
  // never sends so much as a RST. Kept comfortably under spawnTimeoutMs so
  // the SQL-level statement_timeout and this connect timeout cannot race.
  const connectTimeoutSec = Math.max(1, Math.floor(spawnTimeoutMs / 2000));
  const res = spawnSync('psql', args, {
    encoding: 'utf8',
    maxBuffer: DB_MAX_BUFFER,
    timeout: spawnTimeoutMs,
    env: { ...process.env, PGCONNECT_TIMEOUT: String(connectTimeoutSec) },
  });
  return interpretPsqlResult(res);
}

// --- parsing: psql --csv output -------------------------------------------
//
// Unit-tested directly against fixture text in this exact shape (tests/
// db.test.mjs) — no live database required to exercise any of these.

// A small, hand-written RFC4180-shaped CSV parser: fields separated by
// commas; a field may be double-quoted, in which case a comma or a literal
// newline inside it is data, not a delimiter, and a doubled `""` inside a
// quoted field is a literal `"`. This is deliberately NOT a fully strict
// RFC4180 validator — a stray, non-leading quote inside an otherwise
// unquoted field is treated as a literal character rather than raising a
// parse error, so one oddly-shaped row degrades to "probably garbled data"
// rather than crashing the whole parse. The actual safety net for garbled
// data is downstream: parseRows()'s arity check and the typed field
// validators below reject anything that isn't unambiguously the expected
// shape, converting it to an `unavailable` outcome rather than a fabricated
// fact (see SAFETY point 4/5 at the top of this file).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Thrown whenever parsed psql output doesn't unambiguously match the shape
// a query was expected to produce (wrong row/field count, a boolean column
// that isn't exactly 't'/'f', a numeric column that isn't exactly digits).
// Caught by safeParseQuery() and converted to an `unavailable` outcome —
// never left to propagate into a fact. Its .message is always built from
// fixed labels and counts, never from the actual (possibly psqlrc- or
// attacker-controlled) field content — see the NO-DSN-IN-OUTPUT discipline
// at the top of this file, which this error type is equally bound by.
export class MalformedPsqlOutputError extends Error {}

function parseRows(stdout, arity, mapper) {
  return parseCsv(stdout).map((r) => {
    if (r.length !== arity) {
      throw new MalformedPsqlOutputError(`expected ${arity} field(s) per row, got ${r.length}`);
    }
    return mapper(r);
  });
}

function parseBoolT(value, field) {
  if (value === 't') return true;
  if (value === 'f') return false;
  throw new MalformedPsqlOutputError(`expected a 't'/'f' boolean for ${field}`);
}

function parseIntStrict(value, field) {
  if (!/^-?\d+$/.test(value)) {
    throw new MalformedPsqlOutputError(`expected an integer for ${field}`);
  }
  return Number(value);
}

export function parseRlsRows(stdout) {
  return parseRows(stdout, 5, ([schema, table, rowSecurity, forceRowSecurity, policyCount]) => ({
    schema,
    table,
    rowSecurity: parseBoolT(rowSecurity, 'relrowsecurity'),
    forceRowSecurity: parseBoolT(forceRowSecurity, 'relforcerowsecurity'),
    policyCount: parseIntStrict(policyCount, 'policy count'),
  }));
}

// A WITH CHECK (or USING) expression consisting of just the literal boolean
// `true` (optionally parenthesised/spaced) imposes no real constraint at
// all — this is the "genuinely wide open" shape review Important 4 flagged
// as invisible under a presence-only (IS NOT NULL) capture.
const TRIVIALLY_TRUE_RE = /^\(?\s*true\s*\)?$/i;

export function parsePolicyRows(stdout) {
  return parseRows(stdout, 8, ([schema, table, policy, cmd, permissive, roles, qual, withCheck]) => {
    if (permissive !== 'PERMISSIVE' && permissive !== 'RESTRICTIVE') {
      throw new MalformedPsqlOutputError('expected PERMISSIVE or RESTRICTIVE for policy type');
    }
    return {
      schema,
      table,
      policy,
      cmd,
      permissive,
      roles: roles.length > 0 ? roles : '(none — applies to PUBLIC)',
      hasUsing: qual.trim().length > 0,
      hasWithCheck: withCheck.trim().length > 0,
      usingIsTriviallyTrue: TRIVIALLY_TRUE_RE.test(qual.trim()),
      withCheckIsTriviallyTrue: TRIVIALLY_TRUE_RE.test(withCheck.trim()),
    };
  });
}

export function parseIndexUsageRows(stdout) {
  return parseRows(stdout, 4, ([schema, table, index, idxScan]) => ({
    schema, table, index, idxScan: parseIntStrict(idxScan, 'idx_scan'),
  }));
}

export function parseTableScanRows(stdout) {
  return parseRows(stdout, 4, ([schema, table, seqScan, idxScan]) => ({
    schema, table, seqScan: parseIntStrict(seqScan, 'seq_scan'), idxScan: parseIntStrict(idxScan, 'idx_scan'),
  }));
}

export function parseStatsResetRow(stdout) {
  const rows = parseCsv(stdout);
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].length !== 1) {
    throw new MalformedPsqlOutputError(`expected 0 or 1 row of 1 field for stats reset time, got ${rows.length} row(s)`);
  }
  const value = rows[0][0];
  return value ? value : null;
}

export function parseConstraintCountRows(stdout) {
  return parseRows(stdout, 2, ([contype, count]) => ({ contype, count: parseIntStrict(count, 'constraint count') }));
}

export function parseNoFkTableRows(stdout) {
  return parseRows(stdout, 2, ([schema, table]) => ({ schema, table }));
}

export function parseConnectionRow(stdout) {
  const rows = parseCsv(stdout);
  if (rows.length !== 1 || rows[0].length !== 3) {
    throw new MalformedPsqlOutputError(`expected exactly 1 row of 3 fields for the connection summary, got ${rows.length} row(s)`);
  }
  const [maxConnections, superuserReserved, current] = rows[0];
  return {
    maxConnections: parseIntStrict(maxConnections, 'max_connections'),
    superuserReserved: parseIntStrict(superuserReserved, 'superuser_reserved_connections'),
    current: parseIntStrict(current, 'current connections'),
  };
}

// A conservative allowlist for a Postgres database name: starts with a
// letter/digit/underscore, followed by letters/digits/underscore/dot/dollar/
// hyphen, capped at 63 bytes (NAMEDATALEN - 1). This deliberately rejects
// anything shaped like a sentence (spaces, quotes, colons, punctuation) —
// exactly the shape a leaked \conninfo line or any other unexpected text
// would have — while still accepting realistic real-world database names
// (including ones created quoted, e.g. cloud-provider-generated names with
// hyphens). See validateBootstrap() below and SAFETY point 4 at the top of
// this file: this check exists independently of -X, not as a substitute
// for it.
const DBNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.$-]{0,62}$/;

export function validateBootstrap(stdout) {
  const rows = parseCsv(stdout);
  if (rows.length !== 1 || rows[0].length !== 1) {
    return {
      ok: false,
      reason: `bootstrap query (SELECT current_database()) returned ${rows.length} row(s) instead of exactly one — refusing to proceed, since every fact and source this collector emits would otherwise cite an unverified database name`,
    };
  }
  const dbname = rows[0][0];
  if (!DBNAME_PATTERN.test(dbname)) {
    return {
      ok: false,
      reason: 'bootstrap query returned a value that does not match a conservative database-name pattern — refusing to proceed rather than treat unexpected output as a real database name (checked independently of -X, which should already prevent this)',
    };
  }
  return { ok: true, dbname };
}

// Converts a query's already-classified psql result into a parsed value,
// folding a MalformedPsqlOutputError into the exact same shape as a
// connection/auth/timeout failure — the caller in collectDb() below never
// needs to know whether a query failed to run at all or ran and produced
// output that didn't parse; both become "no usable evidence for this query"
// uniformly. See SAFETY point 4 at the top of this file.
function safeParseQuery(result, parseFn) {
  if (!result.ok) return { ok: false, reason: result.reason };
  try {
    return { ok: true, value: parseFn(result.stdout) };
  } catch (err) {
    if (err instanceof MalformedPsqlOutputError) {
      return {
        ok: false,
        reason: `psql returned output in an unexpected shape (${err.message}) — -X disables psqlrc specifically to prevent this, so this points at something else (a corrupted or unusual connection, or an unsupported psql/server version) rather than a genuine empty result`,
      };
    }
    throw err; // an unexpected programming error must not be silently swallowed
  }
}

// --- fact builders ---------------------------------------------------------
//
// Facts only, never scores — the invariant every collector in this skill
// obeys. `source` names the catalog view(s) and the database, e.g.
// "pg_policies @ acme_production" — deliberately never the host, user or
// password (see the NO-DSN-IN-OUTPUT discipline above).

function makeFact(probe, fact, source) {
  return { probe, fact, source, class: 'inspected' };
}

// 8.1 [G2]
export function rlsFacts(rows, dbname) {
  const source = `pg_class/pg_policies @ ${dbname}`;
  if (rows.length === 0) {
    return [makeFact(
      '8.1',
      `no user tables found in ${dbname} (schemas outside pg_catalog/information_schema/pg_toast) to check for row-level security`,
      source,
    )];
  }
  const disabled = rows.filter((r) => !r.rowSecurity);
  const enabledNoPolicies = rows.filter((r) => r.rowSecurity && r.policyCount === 0);
  const covered = rows.length - disabled.length - enabledNoPolicies.length;

  const facts = [makeFact(
    '8.1',
    `${rows.length} table(s) inspected for row-level security in ${dbname}: ${disabled.length} with RLS disabled, `
      + `${enabledNoPolicies.length} with RLS enabled but no policies attached, ${covered} with RLS enabled and at least one policy`,
    source,
  )];
  for (const r of disabled) {
    facts.push(makeFact('8.1', `RLS is disabled on ${r.schema}.${r.table} (relrowsecurity = false)`, source));
  }
  for (const r of enabledNoPolicies) {
    // Deliberately worded as a distinct finding from "RLS disabled": with
    // RLS on and zero policies, Postgres denies ALL access (reads included)
    // by default — the opposite failure mode from an unprotected table, and
    // conflating the two would misdirect remediation.
    facts.push(makeFact(
      '8.1',
      `RLS is enabled on ${r.schema}.${r.table} but it has 0 policies attached — this denies ALL access to the table, including legitimate reads, rather than protecting it selectively (a different finding from RLS being disabled)`,
      source,
    ));
  }
  return facts;
}

// 8.2 — policy inventory: cmd/permissive/roles and whether USING / WITH
// CHECK meaningfully constrain the policy, per PostgreSQL's own documented
// semantics (CREATE POLICY): "If no WITH CHECK expression is defined, then
// the USING expression will be used both to determine which rows are
// visible ... and which new rows will be allowed to be added." So an
// UPDATE/ALL policy with USING present and WITH CHECK absent reuses USING
// as the check — that is the SAFE default, not a gap.
//
// A clause that is ABSENT entirely is a different, and opposite, case from
// that fallback. Verified against PostgreSQL's own rewriter
// (src/backend/rewrite/rowsecurity.c): add_security_quals collects a
// PERMISSIVE policy's qual only `if (policy->qual != NULL)`, and its own
// comment states "we must have permissive quals, always, or no rows are
// visible... we simply return a single 'false' qual" when none contribute
// one; add_with_check_options falls back to `with_check_qual ?? qual`, which
// is likewise absent for a policy that supplies neither. Since permissive
// policies are OR'd together, a policy whose relevant clause is missing
// contributes NOTHING to that OR — it grants no access on its own. If it is
// the only permissive policy applicable to that command on the table, the
// command is denied entirely via RLS, not left wide open. A previous version
// of this function asserted the opposite (review Important 4, then found
// still backwards a second time) — inverted here, and confirmed against a
// live server: a DELETE policy with no USING made its table genuinely
// undeletable, and an INSERT policy with no WITH CHECK made its table
// genuinely uninsertable.
function permissiveHasUsingAnywhere(rows) {
  return rows.some((s) => s.permissive === 'PERMISSIVE' && s.hasUsing);
}

function permissiveHasWriteCheckAnywhere(rows) {
  return rows.some((s) => {
    if (s.permissive !== 'PERMISSIVE') return false;
    if (s.hasWithCheck) return true;
    // UPDATE/ALL reuse USING as the check when WITH CHECK is absent — see
    // the fallback rule above. INSERT-only rows never reach this branch
    // (hasUsing is structurally always false for them).
    return (s.cmd === 'UPDATE' || s.cmd === 'ALL') && s.hasUsing;
  });
}

// `siblings` is every policy row on the same table (this row included) —
// used only to soften "denied entirely" to "another policy may still cover
// it" when a sibling PERMISSIVE policy provides real coverage. This is
// deliberately table-wide rather than an exact per-command match against an
// ALL row's three sub-accesses (SELECT/UPDATE-target/DELETE-target can each
// have different sibling coverage) — that finer lattice is left for the
// auditor to read directly off the full per-policy inventory below, not
// asserted here.
function assessPolicyRisk(r, siblings) {
  const cmd = (r.cmd || '').toUpperCase();
  const notes = [];

  // A WITH CHECK (or USING) that is just the literal `true` passes every
  // row — wherever it's applicable, it imposes no real constraint despite
  // appearing to have one. This is the opposite defect from "clause absent"
  // below: a clause is present, but vacuous.
  if (r.hasWithCheck && r.withCheckIsTriviallyTrue) {
    notes.push('WITH CHECK (true) imposes no real constraint on writes under this policy — effectively unconstrained despite appearing to have a check');
  }
  if (r.hasUsing && r.usingIsTriviallyTrue) {
    notes.push('USING (true) imposes no restriction on which rows are visible or targeted under this policy — every row qualifies, despite appearing to have a clause');
  }

  if (r.permissive === 'PERMISSIVE') {
    if (cmd === 'INSERT' && !r.hasWithCheck) {
      const coveredElsewhere = permissiveHasWriteCheckAnywhere(siblings);
      notes.push(coveredElsewhere
        ? 'this policy grants no INSERT access on its own (no WITH CHECK, and INSERT has no USING to fall back on) — another permissive policy on this table may still permit it'
        : 'this policy grants no INSERT access (no WITH CHECK, and INSERT has no USING to fall back on), and no other permissive policy on this table provides one — INSERT is denied entirely via RLS');
    }

    if ((cmd === 'UPDATE' || cmd === 'ALL') && !r.hasWithCheck && !r.hasUsing) {
      const coveredElsewhere = permissiveHasWriteCheckAnywhere(siblings);
      notes.push(coveredElsewhere
        ? `this policy grants no ${cmd} write access on its own (no USING, no WITH CHECK) — another permissive policy on this table may still permit it`
        : `this policy grants no ${cmd} write access (no USING, no WITH CHECK), and no other permissive policy on this table provides one — ${cmd} is denied entirely via RLS`);
    }

    if ((cmd === 'DELETE' || cmd === 'ALL') && !r.hasUsing) {
      const coveredElsewhere = permissiveHasUsingAnywhere(siblings);
      const label = cmd === 'DELETE' ? 'DELETE' : 'targeting';
      notes.push(coveredElsewhere
        ? `this policy grants no ${label} access on its own (no USING) — another permissive policy on this table may still permit it`
        : `this policy grants no ${label} access (no USING), and no other permissive policy on this table provides one — ${cmd === 'DELETE' ? 'DELETE is' : 'this command is'} denied entirely via RLS`);
    }
  }

  return notes;
}

export function policyFacts(rows, dbname) {
  const source = `pg_policies @ ${dbname}`;
  if (rows.length === 0) {
    return [makeFact('8.2', `no policies found in pg_policies for ${dbname}`, source)];
  }
  return rows.map((r) => {
    const siblings = rows.filter((s) => s.schema === r.schema && s.table === r.table);
    const notes = assessPolicyRisk(r, siblings);
    const base = `policy "${r.policy}" on ${r.schema}.${r.table}: cmd=${r.cmd}, type=${r.permissive}, roles=${r.roles}, `
      + `USING=${r.hasUsing ? 'present' : 'absent'}, WITH CHECK=${r.hasWithCheck ? 'present' : 'absent'}`;
    const warning = notes.length > 0 ? ` — ${notes.join('; ')}` : '';
    return makeFact('8.2', base + warning, source);
  });
}

// 3.2
export function indexUsageFacts(idxRows, tableRows, statsReset, dbname) {
  const source = `pg_stat_user_indexes/pg_stat_user_tables @ ${dbname}`;
  const resetText = statsReset
    ? `stats last reset at ${statsReset}`
    : 'stats reset time unknown (pg_stat_get_db_stat_reset_time returned no value)';
  // idx_scan accumulates only since the last stats reset — called out on
  // every fact below, not just once, since each fact is meant to stand on
  // its own if read in isolation (e.g. copied into a findings register).
  const caveat = 'idx_scan accumulates since the last stats reset, so a low count on a recently-reset database is not itself conclusive evidence of an unused index';

  const facts = [];
  if (idxRows.length === 0) {
    facts.push(makeFact('3.2', `no indexes with recorded usage statistics found in ${dbname} (pg_stat_user_indexes)`, source));
  } else {
    const unused = idxRows.filter((r) => r.idxScan === 0);
    if (unused.length === 0) {
      facts.push(makeFact(
        '3.2',
        `no unused indexes found (idx_scan = 0) among ${idxRows.length} index(es) in ${dbname} (${resetText}); ${caveat}`,
        source,
      ));
    } else {
      facts.push(makeFact(
        '3.2',
        `${unused.length} of ${idxRows.length} index(es) in ${dbname} have idx_scan = 0 (unused) (${resetText}); ${caveat}`,
        source,
      ));
      for (const r of unused) {
        facts.push(makeFact('3.2', `index ${r.schema}.${r.index} on ${r.schema}.${r.table} has idx_scan = 0 (${resetText})`, source));
      }
    }
  }

  if (tableRows.length === 0) {
    facts.push(makeFact('3.2', `no user tables with recorded scan statistics found in ${dbname} (pg_stat_user_tables)`, source));
  } else {
    for (const r of tableRows) {
      facts.push(makeFact(
        '3.2',
        `table ${r.schema}.${r.table}: ${r.seqScan} sequential scan(s), ${r.idxScan} index scan(s) (${resetText})`,
        source,
      ));
    }
  }
  return facts;
}

// 3.4
//
// `tableCount` (total user tables, or null if unknown) exists specifically
// to guard the "every table has a foreign key" claim: that sentence is
// vacuously true on a database with zero user tables, and reads as a
// positive assurance it is not entitled to make. Callers pass the row count
// from the 8.1 rls query (which selects from exactly the same table
// population) when available, rather than this function issuing its own
// redundant query.
export function constraintFacts(countRows, noFkRows, tableCount, dbname) {
  const source = `pg_constraint @ ${dbname}`;
  const counts = { f: 0, u: 0, c: 0 };
  for (const r of countRows) {
    if (Object.prototype.hasOwnProperty.call(counts, r.contype)) counts[r.contype] = r.count;
  }
  const facts = [makeFact(
    '3.4',
    `constraint counts in ${dbname}: ${counts.f} foreign key(s), ${counts.u} unique constraint(s), ${counts.c} check constraint(s)`,
    source,
  )];
  if (tableCount === 0) {
    facts.push(makeFact('3.4', `no user tables found in ${dbname} to check for foreign key coverage`, source));
  } else if (noFkRows.length === 0) {
    facts.push(makeFact(
      '3.4',
      tableCount != null
        ? `every user table (${tableCount}) in ${dbname} has at least one foreign key constraint`
        : `no tables lacking a foreign key constraint were found in ${dbname} among those inspected (total table count unavailable — see probe 8.1)`,
      source,
    ));
  } else {
    facts.push(makeFact(
      '3.4',
      `${noFkRows.length} table(s) in ${dbname} carry no foreign key constraint at all: ${noFkRows.map((r) => `${r.schema}.${r.table}`).join(', ')}`,
      source,
    ));
  }
  return facts;
}

// 3.8
export function connectionFacts(row, dbname) {
  const source = `pg_settings/pg_stat_activity @ ${dbname}`;
  const pct = row.maxConnections ? `${((row.current / row.maxConnections) * 100).toFixed(1)}%` : 'unknown';
  return [makeFact(
    '3.8',
    `max_connections=${row.maxConnections}, superuser_reserved_connections=${row.superuserReserved}, `
      + `current connections (pg_stat_activity)=${row.current} in ${dbname} (${pct} of max_connections)`,
    source,
  )];
}

// --- composition ------------------------------------------------------

const PROBES = ['8.1', '8.2', '3.2', '3.4', '3.8'];

// deps.runQuery is injectable so the reconciliation logic below (which probe
// lands in facts vs. unavailable when some queries succeed and others don't)
// can be unit-tested against canned results, the same way collectLive's
// deps.guard is — no live database exists to exercise this against under
// this project's zero-mocking-library constraint. tests/db.test.mjs also
// drives the REAL spawn path (no injected deps) through a fake `psql`
// executable on PATH, for the scenarios that specifically matter at that
// level (unexpected-but-exit-0 output, ETIMEDOUT classification).
export function collectDb(opts = {}, deps = {}) {
  const runQueryImpl = deps.runQuery ?? runPsqlQueryReal;
  const dsn = opts.dsn || null;
  const timeoutMs = opts.timeoutMs ?? STATEMENT_TIMEOUT_MS;
  const spawnTimeoutMs = opts.spawnTimeoutMs ?? SPAWN_TIMEOUT_MS;
  const collectedAt = new Date().toISOString();
  const facts = [];
  const unavailable = [];

  const run = (key) => runQueryImpl({ key, sql: QUERIES[key], dsn, timeoutMs, spawnTimeoutMs });

  // Bootstrap: a cheap SELECT that both confirms connectivity and supplies
  // the dbname every other fact's `source` cites. A failure here (psql
  // absent, cannot connect, auth rejected, timed out, or output that fails
  // validateBootstrap()'s shape/pattern check) means none of the five
  // probes below have any evidence at all — each gets its own unavailable
  // entry sharing this one classified reason, mirroring how ciFacts in
  // repo.mjs pushes the same reason across 7.1/7.3/7.4 when there is no
  // .github/workflows directory at all.
  const bootstrap = run('bootstrap');
  if (!bootstrap.ok) {
    for (const probe of PROBES) unavailable.push({ probe, reason: bootstrap.reason });
    return { tier: 'db', collectedAt, target: { dbname: null }, facts, unavailable };
  }
  const validated = validateBootstrap(bootstrap.stdout);
  if (!validated.ok) {
    for (const probe of PROBES) unavailable.push({ probe, reason: validated.reason });
    return { tier: 'db', collectedAt, target: { dbname: null }, facts, unavailable };
  }
  const dbname = validated.dbname;

  facts.push({
    probe: 'meta.connection',
    fact: `connected to ${dbname} for direct database inspection (read-only transaction, statement_timeout=${timeoutMs}ms)`,
    source: `psql @ ${dbname}`,
    class: 'inspected',
  });

  // 8.1
  const rls = safeParseQuery(run('rls'), parseRlsRows);
  if (rls.ok) facts.push(...rlsFacts(rls.value, dbname));
  else unavailable.push({ probe: '8.1', reason: rls.reason });

  // 8.2
  const policies = safeParseQuery(run('policies'), parsePolicyRows);
  if (policies.ok) facts.push(...policyFacts(policies.value, dbname));
  else unavailable.push({ probe: '8.2', reason: policies.reason });

  // 3.2 — three queries feed one probe. Reconciled the same way repo.mjs's
  // dependencyFacts reconciles 8.4 across multiple roots: real evidence from
  // any of the three wins the probe for facts[], with any other query's
  // failure folded in as an additional fact noting partial coverage: never
  // a contradictory unavailable[] entry for a probe that otherwise has data.
  // Only when NEITHER of the two row-producing queries succeeded does 3.2
  // become a genuine gap (statsReset alone succeeding, with no rows to
  // annotate, would not be a fact worth having).
  const idxUsage = safeParseQuery(run('idxUsage'), parseIndexUsageRows);
  const tableScans = safeParseQuery(run('tableScans'), parseTableScanRows);
  const statsResetRes = run('statsReset');
  let statsReset = null;
  if (statsResetRes.ok) {
    try { statsReset = parseStatsResetRow(statsResetRes.stdout); } catch { statsReset = null; }
  }
  if (idxUsage.ok || tableScans.ok) {
    const idxRows = idxUsage.ok ? idxUsage.value : [];
    const tableRows = tableScans.ok ? tableScans.value : [];
    facts.push(...indexUsageFacts(idxRows, tableRows, statsReset, dbname));
    if (!idxUsage.ok) {
      facts.push(makeFact(
        '3.2',
        `index usage statistics could not be inspected in ${dbname}: ${idxUsage.reason} (other 3.2 facts above cover table scan counts)`,
        `pg_stat_user_indexes @ ${dbname}`,
      ));
    }
    if (!tableScans.ok) {
      facts.push(makeFact(
        '3.2',
        `table scan statistics could not be inspected in ${dbname}: ${tableScans.reason} (other 3.2 facts above cover index usage)`,
        `pg_stat_user_tables @ ${dbname}`,
      ));
    }
  } else {
    unavailable.push({ probe: '3.2', reason: idxUsage.reason });
  }

  // 3.4 — same two-query reconciliation as 3.2 above. tableCount reuses the
  // 8.1 rls query's row count (same table population, same predicate) rather
  // than issuing a redundant query of its own; null when 8.1 itself failed.
  const constraintCounts = safeParseQuery(run('constraintCounts'), parseConstraintCountRows);
  const noFkTables = safeParseQuery(run('noFkTables'), parseNoFkTableRows);
  const tableCount = rls.ok ? rls.value.length : null;
  if (constraintCounts.ok || noFkTables.ok) {
    const countRows = constraintCounts.ok ? constraintCounts.value : [];
    const noFkRows = noFkTables.ok ? noFkTables.value : [];
    facts.push(...constraintFacts(countRows, noFkRows, tableCount, dbname));
    if (!constraintCounts.ok) {
      facts.push(makeFact(
        '3.4',
        `constraint counts could not be inspected in ${dbname}: ${constraintCounts.reason} (other 3.4 facts above cover tables missing a foreign key)`,
        `pg_constraint @ ${dbname}`,
      ));
    }
    if (!noFkTables.ok) {
      facts.push(makeFact(
        '3.4',
        `tables missing a foreign key could not be inspected in ${dbname}: ${noFkTables.reason} (other 3.4 facts above cover constraint counts)`,
        `pg_constraint @ ${dbname}`,
      ));
    }
  } else {
    unavailable.push({ probe: '3.4', reason: constraintCounts.reason });
  }

  // 3.8
  const connections = safeParseQuery(run('connections'), parseConnectionRow);
  if (connections.ok) facts.push(...connectionFacts(connections.value, dbname));
  else unavailable.push({ probe: '3.8', reason: connections.reason });

  return { tier: 'db', collectedAt, target: { dbname }, facts, unavailable };
}
