import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  interpretPsqlResult,
  resolveDsn,
  buildPsqlArgs,
  parseCsv,
  MalformedPsqlOutputError,
  parseRlsRows,
  parsePolicyRows,
  parseIndexUsageRows,
  parseTableScanRows,
  parseStatsResetRow,
  parseConstraintCountRows,
  parseNoFkTableRows,
  parseConnectionRow,
  validateBootstrap,
  rlsFacts,
  policyFacts,
  indexUsageFacts,
  constraintFacts,
  connectionFacts,
  collectDb,
} from '../scripts/lib/db.mjs';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'collect-db.mjs');

// A realistic-shaped DSN carrying a distinguishable host, user and password,
// reused across every leak-check test below. Synthetic — not a real
// credential, not copied from any environment or credential store. The
// password is deliberately NOT entropy-shaped (a plain, obviously-fake
// label) so it cannot itself trip a secret scanner on this public repo.
const FAKE_DSN = 'postgres://auditor:NOT-A-REAL-PASSWORD@10.0.0.99:5432/mydb';
const FAKE_HOST = '10.0.0.99';
const FAKE_USER = 'auditor';
const FAKE_PASSWORD = 'NOT-A-REAL-PASSWORD';

// --- interpretPsqlResult: classification, and no stderr content in reason --

test('interpretPsqlResult: spawn error (psql absent) names the tool and an install hint, never a false clean-scan reading', () => {
  const res = { error: { code: 'ENOENT', message: 'spawnSync psql ENOENT' }, status: null, stdout: null, stderr: null };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'unavailable-tool');
  assert.match(result.reason, /psql/i);
  assert.match(result.reason, /install/i);
});

test('interpretPsqlResult: a successful run passes stdout through unchanged', () => {
  const res = { error: null, status: 0, stdout: 'a,b,c\n', stderr: '' };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'a,b,c\n');
});

test('interpretPsqlResult: ETIMEDOUT (spawnSync killed the process for exceeding the timeout) is classified as "timeout", never "tool absent"', () => {
  const res = { error: { code: 'ETIMEDOUT', message: 'spawnSync psql ETIMEDOUT' }, status: null, stdout: null, stderr: null };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'timeout');
  assert.doesNotMatch(result.reason, /install/i, 'a hang must never be misdiagnosed as "go install psql"');
  assert.match(result.reason, /timeout|terminated/i);
});

test('interpretPsqlResult: ENOBUFS (maxBuffer exceeded — a real, oversized result) is never misdiagnosed as "psql is not installed"', () => {
  const res = { error: { code: 'ENOBUFS', message: 'spawnSync psql ENOBUFS' }, status: null, stdout: null, stderr: null };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.reason, /install/i);
  assert.match(result.reason, /more output than this collector allows/i);
});

test('interpretPsqlResult: EACCES/EPERM (psql present but not executable) is distinguished from ENOENT (psql absent)', () => {
  for (const code of ['EACCES', 'EPERM']) {
    const result = interpretPsqlResult({ error: { code }, status: null, stdout: null, stderr: null });
    assert.equal(result.ok, false);
    assert.match(result.reason, /is present but could not be executed/i);
    assert.doesNotMatch(result.reason, /apt-get install|brew install/i, 'must not tell the operator to install a tool that is already present');
  }
});

test('interpretPsqlResult: EMFILE/ENFILE (local resource exhaustion) is never misdiagnosed as a missing tool or a database problem', () => {
  for (const code of ['EMFILE', 'ENFILE']) {
    const result = interpretPsqlResult({ error: { code }, status: null, stdout: null, stderr: null });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.reason, /install/i);
    assert.match(result.reason, /file descriptors or process slots/i);
  }
});

test('interpretPsqlResult: classifies a statement_timeout cancellation distinctly', () => {
  const res = {
    error: null,
    status: 1,
    stdout: '',
    stderr: `ERROR:  canceling statement due to statement timeout\n`,
  };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'timeout');
});

test('interpretPsqlResult: classifies a connection failure distinctly from a timeout', () => {
  const res = {
    error: null,
    status: 2,
    stdout: '',
    stderr: `psql: error: connection to server at "${FAKE_HOST}", port 5432 failed: Connection refused\n`,
  };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'connection');
});

test('interpretPsqlResult: classifies an auth failure distinctly from a connection failure', () => {
  const res = {
    error: null,
    status: 1,
    stdout: '',
    stderr: `psql: error: connection to server at "${FAKE_HOST}", port 5432 failed: FATAL:  password authentication failed for user "${FAKE_USER}"\n`,
  };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'auth');
});

test('interpretPsqlResult: the five failure kinds produce five distinct, non-confusable reasons', () => {
  const toolAbsent = interpretPsqlResult({ error: { code: 'ENOENT' }, status: null, stdout: null, stderr: null });
  const timedOut = interpretPsqlResult({ error: { code: 'ETIMEDOUT' }, status: null, stdout: null, stderr: null });
  const timeout = interpretPsqlResult({ error: null, status: 1, stdout: '', stderr: 'canceling statement due to statement timeout' });
  const connection = interpretPsqlResult({ error: null, status: 2, stdout: '', stderr: 'could not connect to server: Connection refused' });
  const auth = interpretPsqlResult({ error: null, status: 1, stdout: '', stderr: 'password authentication failed for user "x"' });
  const reasons = [toolAbsent.reason, timedOut.reason, timeout.reason, connection.reason, auth.reason];
  assert.equal(new Set(reasons).size, 5, 'all five reasons must be textually distinct');
  for (const r of reasons) {
    assert.doesNotMatch(r, /found no|no .* found|nothing found/i, 'a failure reason must never read like "inspected and found nothing"');
  }
});

test('interpretPsqlResult: never copies psql\'s own stderr text into the returned reason, even when stderr names the real host/user/password', () => {
  const res = {
    error: null,
    status: 1,
    stdout: '',
    stderr: `psql: error: connection to server at "${FAKE_HOST}" failed: FATAL: password authentication failed for user "${FAKE_USER}" (password was "${FAKE_PASSWORD}")\n`,
  };
  const result = interpretPsqlResult(res);
  assert.ok(!result.reason.includes(FAKE_HOST));
  assert.ok(!result.reason.includes(FAKE_USER));
  assert.ok(!result.reason.includes(FAKE_PASSWORD));
});

test('interpretPsqlResult: an unclassified non-zero exit reports the status number but not stderr content', () => {
  const res = { error: null, status: 3, stdout: '', stderr: `some driver detail mentioning ${FAKE_HOST} and ${FAKE_PASSWORD}\n` };
  const result = interpretPsqlResult(res);
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'error');
  assert.match(result.reason, /status 3/);
  assert.ok(!result.reason.includes(FAKE_HOST));
  assert.ok(!result.reason.includes(FAKE_PASSWORD));
});

// --- resolveDsn --------------------------------------------------------

test('resolveDsn: PGURL environment variable takes precedence over --dsn', () => {
  const { dsn, source } = resolveDsn({ dsnFlag: 'postgres://from-flag/db', env: { PGURL: 'postgres://from-env/db' } });
  assert.equal(dsn, 'postgres://from-env/db');
  assert.match(source, /PGURL/);
});

test('resolveDsn: --dsn is used when PGURL is absent', () => {
  const { dsn, source } = resolveDsn({ dsnFlag: 'postgres://from-flag/db', env: {} });
  assert.equal(dsn, 'postgres://from-flag/db');
  assert.match(source, /--dsn/);
});

test('resolveDsn: with neither PGURL nor --dsn, dsn is null so psql falls back to its own PG* environment variables', () => {
  const { dsn, source } = resolveDsn({ dsnFlag: null, env: {} });
  assert.equal(dsn, null);
  assert.match(source, /PGHOST|PG\*/);
});

// --- buildPsqlArgs: -X present, --csv output, read-only chain intact -------

test('buildPsqlArgs: -X (--no-psqlrc) is present, defeating a psqlrc regardless of what it contains', () => {
  const args = buildPsqlArgs({ dsn: null, sql: 'SELECT 1', timeoutMs: 5000 });
  assert.ok(args.includes('-X'), 'psql must be invoked with -X so no start-up file is ever read');
});

test('buildPsqlArgs: --csv output is requested, not a naive single-character delimiter', () => {
  const args = buildPsqlArgs({ dsn: null, sql: 'SELECT 1', timeoutMs: 5000 });
  assert.ok(args.includes('--csv'));
  assert.ok(!args.includes('-F'), 'must not also pass a raw field-separator flag that a naive splitter would rely on');
});

test('buildPsqlArgs: SET TRANSACTION READ ONLY is -c #1, statement_timeout is -c #2, search_path=pg_catalog is -c #3, the payload query is -c #4, ahead of the DSN', () => {
  const args = buildPsqlArgs({ dsn: 'postgres://x/y', sql: 'SELECT foo', timeoutMs: 4242 });
  const cIndexes = args.reduce((acc, a, i) => (a === '-c' ? [...acc, i] : acc), []);
  assert.equal(cIndexes.length, 4, 'exactly four -c commands');
  assert.equal(args[cIndexes[0] + 1], 'SET TRANSACTION READ ONLY');
  assert.equal(args[cIndexes[1] + 1], 'SET statement_timeout = 4242');
  assert.equal(args[cIndexes[2] + 1], 'SET search_path = pg_catalog');
  assert.equal(args[cIndexes[3] + 1], 'SELECT foo');
  assert.equal(args[args.length - 1], 'postgres://x/y', 'the DSN must be the trailing positional argument, after every option');
});

test('buildPsqlArgs: search_path is pinned to pg_catalog so ALTER ROLE ... SET search_path / PGOPTIONS / a DSN options= parameter cannot shadow a catalog relation', () => {
  const args = buildPsqlArgs({ dsn: null, sql: 'SELECT 1', timeoutMs: 1000 });
  assert.ok(args.includes('SET search_path = pg_catalog'));
});

test('buildPsqlArgs: omits the DSN argument entirely when none is given (psql falls back to its own PG* env vars)', () => {
  const args = buildPsqlArgs({ dsn: null, sql: 'SELECT 1', timeoutMs: 1000 });
  assert.equal(args[args.length - 1], 'SELECT 1', 'no DSN token appended when dsn is null');
});

// --- parseCsv: the hand-written CSV parser ----------------------------------

test('parseCsv: plain unquoted rows', () => {
  assert.deepEqual(parseCsv('a,b,c\nd,e,f\n'), [['a', 'b', 'c'], ['d', 'e', 'f']]);
});

test('parseCsv: a quoted field may contain a literal comma', () => {
  assert.deepEqual(parseCsv('public,"ac,counts",t\n'), [['public', 'ac,counts', 't']]);
});

test('parseCsv: a quoted field may contain a literal embedded newline', () => {
  assert.deepEqual(parseCsv('public,"line1\nline2",t\n'), [['public', 'line1\nline2', 't']]);
});

test('parseCsv: a doubled quote inside a quoted field is a literal quote character', () => {
  assert.deepEqual(parseCsv('public,"say ""hi""",t\n'), [['public', 'say "hi"', 't']]);
});

test('parseCsv: empty input produces zero rows', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('parseCsv: a trailing newline does not produce a phantom empty row', () => {
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
});

// --- parseRows arity enforcement (Important 3) ------------------------------

test('parseRlsRows: throws MalformedPsqlOutputError on a row with the wrong field count, rather than silently misreading it', () => {
  assert.throws(() => parseRlsRows('schemaname,relname,indexrelname,idx_scan\n'), MalformedPsqlOutputError);
});

test('parseRlsRows: throws on a non-t/f value in a boolean column', () => {
  assert.throws(() => parseRlsRows('public,accounts,maybe,f,0\n'), MalformedPsqlOutputError);
});

test('parseIndexUsageRows: throws on a non-numeric idx_scan rather than silently coercing to 0', () => {
  assert.throws(() => parseIndexUsageRows('public,accounts,accounts_pkey,\n'), MalformedPsqlOutputError);
  assert.throws(() => parseIndexUsageRows('public,accounts,accounts_pkey,not-a-number\n'), MalformedPsqlOutputError);
});

test('parseConnectionRow: throws when the row is not exactly 1 row of 3 fields', () => {
  assert.throws(() => parseConnectionRow(''), MalformedPsqlOutputError);
  assert.throws(() => parseConnectionRow('100,3\n'), MalformedPsqlOutputError);
  assert.throws(() => parseConnectionRow('100,3,10\n200,3,11\n'), MalformedPsqlOutputError);
});

// --- over-wide rows: the arity check itself, not a type validator, must be
// what fires. Every extra field below is deliberately well-typed (a plain
// digit, a valid 't'/'f') so that if the arity assertion in parseRows() were
// ever removed, JS array destructuring would silently take only the first N
// fields and succeed with no error at all — mutation-testing this file by
// deleting that assertion previously failed zero tests, because every
// existing "wrong shape" test happened to also trip a type validator
// (parseBoolT/parseIntStrict) on an UNDER-wide row, which fires regardless
// of whether arity is checked. These are the tests that specifically fail
// without the arity check.

test('parseRlsRows: an over-wide row (6 well-typed fields, 5 expected) throws — arity, not a type validator, catches it', () => {
  assert.throws(() => parseRlsRows('public,accounts,t,f,2,t\n'), MalformedPsqlOutputError);
});

test('parsePolicyRows: an over-wide row (9 well-typed fields, 8 expected) throws — arity, not a type validator, catches it', () => {
  assert.throws(() => parsePolicyRows('public,accounts,p,SELECT,PERMISSIVE,authenticated,,,extra\n'), MalformedPsqlOutputError);
});

test('parseIndexUsageRows: an over-wide row (5 well-typed fields, 4 expected) throws', () => {
  assert.throws(() => parseIndexUsageRows('public,accounts,accounts_pkey,10,5\n'), MalformedPsqlOutputError);
});

test('parseTableScanRows: an over-wide row (5 well-typed fields, 4 expected) throws', () => {
  assert.throws(() => parseTableScanRows('public,accounts,10,9000,1\n'), MalformedPsqlOutputError);
});

test('parseConstraintCountRows: an over-wide row (3 well-typed fields, 2 expected) throws', () => {
  assert.throws(() => parseConstraintCountRows('f,5,2\n'), MalformedPsqlOutputError);
});

test('parseNoFkTableRows: an over-wide row (3 fields, 2 expected) throws — no type validator exists for this parser at all, so arity is its sole protection', () => {
  assert.throws(() => parseNoFkTableRows('public,settings,EXTRA\n'), MalformedPsqlOutputError);
});

test('parseConnectionRow: an over-wide single row (4 well-typed fields, 3 expected) throws', () => {
  assert.throws(() => parseConnectionRow('100,3,10,extra\n'), MalformedPsqlOutputError);
});

test('parseStatsResetRow: an over-wide single row (2 fields, 1 expected) throws', () => {
  assert.throws(() => parseStatsResetRow('2026-01-01 00:00:00+00,extra\n'), MalformedPsqlOutputError);
});

// --- parsing: psql --csv fixture rows ------------------------------------

test('parseRlsRows parses schema/table/relrowsecurity/relforcerowsecurity/policycount', () => {
  const stdout = [
    'public,accounts,t,f,2',
    'public,internal_audit_log,t,f,0',
    'public,legacy_import,f,f,0',
  ].join('\n') + '\n';
  const rows = parseRlsRows(stdout);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { schema: 'public', table: 'accounts', rowSecurity: true, forceRowSecurity: false, policyCount: 2 });
  assert.equal(rows[1].policyCount, 0);
  assert.equal(rows[2].rowSecurity, false);
});

test('parseRlsRows: a table name containing a comma survives CSV quoting intact (no truncation)', () => {
  const rows = parseRlsRows('public,"ac,counts",t,f,1\n');
  assert.equal(rows[0].table, 'ac,counts');
});

test('parsePolicyRows parses cmd/permissive/roles/qual/with_check, and defaults empty roles to PUBLIC', () => {
  const stdout = [
    'public,accounts,owner_select,SELECT,PERMISSIVE,authenticated,(auth.uid() = user_id),',
    'public,accounts,owner_write,ALL,PERMISSIVE,,(auth.uid() = user_id),(auth.uid() = user_id)',
  ].join('\n') + '\n';
  const rows = parsePolicyRows(stdout);
  assert.equal(rows[0].roles, 'authenticated');
  assert.equal(rows[0].permissive, 'PERMISSIVE');
  assert.equal(rows[0].hasUsing, true);
  assert.equal(rows[0].hasWithCheck, false);
  assert.match(rows[1].roles, /PUBLIC/);
});

test('parsePolicyRows: a policy name containing a comma survives CSV quoting intact', () => {
  const rows = parsePolicyRows('public,accounts,"Users read own, admin bypass",SELECT,PERMISSIVE,authenticated,(true),\n');
  assert.equal(rows[0].policy, 'Users read own, admin bypass');
});

test('parsePolicyRows: detects a WITH CHECK that is the literal boolean true', () => {
  const rows = parsePolicyRows('public,accounts,wide_open,INSERT,PERMISSIVE,authenticated,,(true)\n');
  assert.equal(rows[0].withCheckIsTriviallyTrue, true);
  const notTrivial = parsePolicyRows('public,accounts,real_check,INSERT,PERMISSIVE,authenticated,,(user_id = auth.uid())\n');
  assert.equal(notTrivial[0].withCheckIsTriviallyTrue, false);
});

test('parsePolicyRows: throws on a permissive/restrictive value that is neither', () => {
  assert.throws(() => parsePolicyRows('public,accounts,p,SELECT,MAYBE,authenticated,,\n'), MalformedPsqlOutputError);
});

test('parseIndexUsageRows and parseTableScanRows parse numeric counters', () => {
  const idx = parseIndexUsageRows('public,accounts,accounts_pkey,0\npublic,accounts,accounts_email_idx,412\n');
  assert.equal(idx[0].idxScan, 0);
  assert.equal(idx[1].idxScan, 412);

  const tables = parseTableScanRows('public,accounts,10,9000\n');
  assert.deepEqual(tables[0], { schema: 'public', table: 'accounts', seqScan: 10, idxScan: 9000 });
});

test('parseStatsResetRow returns the timestamp, or null when the value is empty (NULL in Postgres)', () => {
  assert.equal(parseStatsResetRow('2026-01-15 03:00:00.123456+00\n'), '2026-01-15 03:00:00.123456+00');
  assert.equal(parseStatsResetRow(''), null);
  assert.equal(parseStatsResetRow('\n'), null);
});

test('parseConstraintCountRows and parseNoFkTableRows', () => {
  const counts = parseConstraintCountRows('c,3\nf,5\nu,2\n');
  assert.deepEqual(counts, [{ contype: 'c', count: 3 }, { contype: 'f', count: 5 }, { contype: 'u', count: 2 }]);

  const noFk = parseNoFkTableRows('public,settings\npublic,audit_log\n');
  assert.deepEqual(noFk, [{ schema: 'public', table: 'settings' }, { schema: 'public', table: 'audit_log' }]);
});

test('parseConnectionRow parses the single summary row', () => {
  const row = parseConnectionRow('100,3,42\n');
  assert.deepEqual(row, { maxConnections: 100, superuserReserved: 3, current: 42 });
});

// --- validateBootstrap (Critical 1 / Critical 2 core fix) -------------------

test('validateBootstrap: a single plain database name passes', () => {
  const result = validateBootstrap('mydb\n');
  assert.equal(result.ok, true);
  assert.equal(result.dbname, 'mydb');
});

test('validateBootstrap: zero rows (e.g. empty stdout) fails, never defaults to "(unknown database)"', () => {
  const result = validateBootstrap('');
  assert.equal(result.ok, false);
  assert.match(result.reason, /exactly one/);
});

test('validateBootstrap: more than one row fails', () => {
  const result = validateBootstrap('mydb\nsecond\n');
  assert.equal(result.ok, false);
});

test('validateBootstrap: a \\conninfo-shaped sentence (spaces, quotes, punctuation) fails the identifier pattern', () => {
  const result = validateBootstrap('You are connected to database "appdb" as user "reviewuser" on host "10.1.2.3" at port "5432".\n');
  assert.equal(result.ok, false);
  assert.match(result.reason, /pattern/);
});

test('validateBootstrap: a realistic hyphenated cloud-provider database name still passes (not overly strict)', () => {
  const result = validateBootstrap('my-app-db-prod\n');
  assert.equal(result.ok, true);
});

// --- fact builders -------------------------------------------------------

test('rlsFacts: reports zero tables as an explicit fact, not silence', () => {
  const facts = rlsFacts([], 'mydb');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].probe, '8.1');
  assert.match(facts[0].fact, /no user tables found/);
  assert.equal(facts[0].class, 'inspected');
});

test('rlsFacts: RLS-disabled and RLS-enabled-with-no-policies are two distinct findings on the same probe', () => {
  const rows = [
    { schema: 'public', table: 'disabled_tbl', rowSecurity: false, forceRowSecurity: false, policyCount: 0 },
    { schema: 'public', table: 'locked_out_tbl', rowSecurity: true, forceRowSecurity: false, policyCount: 0 },
    { schema: 'public', table: 'covered_tbl', rowSecurity: true, forceRowSecurity: false, policyCount: 2 },
  ];
  const facts = rlsFacts(rows, 'mydb');
  assert.ok(facts.every((f) => f.probe === '8.1'));

  const disabledFact = facts.find((f) => /disabled_tbl/.test(f.fact));
  assert.match(disabledFact.fact, /RLS is disabled/);

  const lockedFact = facts.find((f) => /locked_out_tbl/.test(f.fact));
  assert.match(lockedFact.fact, /enabled/i);
  assert.match(lockedFact.fact, /0 policies/i);
  assert.match(lockedFact.fact, /denies ALL access/i);
  assert.notEqual(disabledFact.fact, lockedFact.fact);

  assert.ok(!facts.some((f) => /covered_tbl/.test(f.fact)));
  const summary = facts.find((f) => /table\(s\) inspected/.test(f.fact));
  assert.match(summary.fact, /3 table\(s\) inspected/);
});

test('policyFacts: zero policies is an explicit fact', () => {
  const facts = policyFacts([], 'mydb');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].probe, '8.2');
  assert.match(facts[0].fact, /no policies found/);
});

// --- Important 4: corrected RLS write-policy semantics ----------------------

function policyRow(overrides) {
  return {
    schema: 'public', table: 'accounts', policy: 'p', cmd: 'SELECT', permissive: 'PERMISSIVE',
    roles: 'authenticated', hasUsing: false, hasWithCheck: false,
    usingIsTriviallyTrue: false, withCheckIsTriviallyTrue: false,
    ...overrides,
  };
}

test('policyFacts: an UPDATE/ALL policy with USING present and WITH CHECK absent is the SAFE default (USING is reused as the check) — must NOT be flagged', () => {
  const rows = [
    policyRow({ cmd: 'UPDATE', hasUsing: true, hasWithCheck: false }),
    policyRow({ cmd: 'ALL', hasUsing: true, hasWithCheck: false }),
  ];
  const facts = policyFacts(rows, 'mydb');
  for (const f of facts) {
    assert.doesNotMatch(f.fact, /not constrained/i, 'USING-present/WITH-CHECK-absent on UPDATE/ALL is the documented safe default, not a finding');
  }
});

// A clause-less PERMISSIVE policy GRANTS NOTHING (PostgreSQL's rewriter,
// src/backend/rewrite/rowsecurity.c: add_security_quals only collects a
// permissive policy's qual when non-NULL, falling back to a bare `false`
// when none contribute one) — the opposite of "unconstrained". If it is the
// sole permissive policy applicable to that command on the table, the
// command is denied entirely via RLS. Confirmed against a live server: a
// DELETE policy with no USING made its table genuinely undeletable, an
// INSERT policy with no WITH CHECK made its table genuinely uninsertable.

test('policyFacts: an UPDATE/ALL policy with BOTH USING and WITH CHECK absent, and no sibling policy, denies the command entirely — not "unconstrained"', () => {
  const rows = [policyRow({ cmd: 'UPDATE', hasUsing: false, hasWithCheck: false })];
  const facts = policyFacts(rows, 'mydb');
  assert.match(facts[0].fact, /grants no UPDATE write access/);
  assert.match(facts[0].fact, /UPDATE is denied entirely via RLS/);
  assert.doesNotMatch(facts[0].fact, /not constrained/i, 'must never read as "unconstrained" — a clause-less policy grants nothing');
});

test('policyFacts: an INSERT policy with WITH CHECK absent, and no sibling policy, denies INSERT entirely — not "unconstrained"', () => {
  const rows = [policyRow({ cmd: 'INSERT', hasUsing: false, hasWithCheck: false })];
  const facts = policyFacts(rows, 'mydb');
  assert.match(facts[0].fact, /grants no INSERT access/);
  assert.match(facts[0].fact, /INSERT is denied entirely via RLS/);
  assert.doesNotMatch(facts[0].fact, /not constrained/i);
});

test('policyFacts: an INSERT policy WITH a real WITH CHECK is not flagged', () => {
  const rows = [policyRow({ cmd: 'INSERT', hasUsing: false, hasWithCheck: true, withCheckIsTriviallyTrue: false })];
  const facts = policyFacts(rows, 'mydb');
  assert.doesNotMatch(facts[0].fact, /grants no/);
});

test('policyFacts: a DELETE (or ALL) policy with no USING, and no sibling policy, denies the command entirely — not "unconstrained"', () => {
  const del = policyFacts([policyRow({ cmd: 'DELETE', hasUsing: false })], 'mydb');
  assert.match(del[0].fact, /grants no DELETE access/);
  assert.match(del[0].fact, /DELETE is denied entirely via RLS/);

  const all = policyFacts([policyRow({ cmd: 'ALL', hasUsing: false, hasWithCheck: true, withCheckIsTriviallyTrue: false })], 'mydb');
  assert.match(all[0].fact, /grants no targeting access/);
  assert.match(all[0].fact, /this command is denied entirely via RLS/);
});

test('policyFacts: a clause-less policy is softened to "another policy may still permit it" when a sibling permissive policy on the same table provides real coverage', () => {
  const rows = [
    policyRow({ policy: 'no_using', cmd: 'DELETE', hasUsing: false }),
    policyRow({ policy: 'real_using', cmd: 'DELETE', hasUsing: true }),
  ];
  const facts = policyFacts(rows, 'mydb');
  const noUsingFact = facts.find((f) => /"no_using"/.test(f.fact));
  assert.match(noUsingFact.fact, /grants no DELETE access on its own/);
  assert.match(noUsingFact.fact, /another permissive policy on this table may still permit it/);
  assert.doesNotMatch(noUsingFact.fact, /denied entirely/, 'must not claim total denial when a sibling policy actually covers it');
});

test('policyFacts: a RESTRICTIVE policy is never assessed for "grants nothing" (that reasoning applies only to PERMISSIVE policies)', () => {
  const rows = [policyRow({ cmd: 'DELETE', permissive: 'RESTRICTIVE', hasUsing: false })];
  const facts = policyFacts(rows, 'mydb');
  assert.doesNotMatch(facts[0].fact, /grants no/);
  assert.doesNotMatch(facts[0].fact, /denied entirely/);
});

test('policyFacts: WITH CHECK (true) is flagged as effectively unconstrained regardless of command, even though "present"', () => {
  const rows = [policyRow({ cmd: 'INSERT', hasWithCheck: true, withCheckIsTriviallyTrue: true })];
  const facts = policyFacts(rows, 'mydb');
  assert.match(facts[0].fact, /WITH CHECK \(true\) imposes no real constraint/);
  assert.match(facts[0].fact, /WITH CHECK=present/, 'must still report WITH CHECK as present — it is the triviality that is the finding, not its absence');
});

// usingIsTriviallyTrue (parsed in parsePolicyRows) must actually be wired
// into a finding — CREATE POLICY p ON t FOR ALL USING (true) is the exact
// mirror of the WITH CHECK (true) case above, and without this the table
// would count as "RLS enabled with at least one real policy" while granting
// unrestricted access to every row.
test('policyFacts: USING (true) is flagged as imposing no restriction, mirroring the WITH CHECK (true) case', () => {
  for (const cmd of ['ALL', 'SELECT', 'UPDATE', 'DELETE']) {
    const rows = [policyRow({ cmd, hasUsing: true, usingIsTriviallyTrue: true })];
    const facts = policyFacts(rows, 'mydb');
    assert.match(facts[0].fact, /USING \(true\) imposes no restriction/, `must flag USING (true) for cmd=${cmd}`);
    assert.match(facts[0].fact, /USING=present/, 'must still report USING as present — it is the triviality that is the finding');
  }
});

test('policyFacts: a real (non-trivial) USING clause is not flagged', () => {
  const rows = [policyRow({ cmd: 'SELECT', hasUsing: true, usingIsTriviallyTrue: false })];
  const facts = policyFacts(rows, 'mydb');
  assert.doesNotMatch(facts[0].fact, /imposes no restriction/);
});

test('policyFacts: a SELECT policy is never held to a WITH-CHECK standard (WITH CHECK is not applicable to SELECT)', () => {
  const rows = [policyRow({ cmd: 'SELECT', hasUsing: true, hasWithCheck: false })];
  const facts = policyFacts(rows, 'mydb');
  assert.doesNotMatch(facts[0].fact, /grants no/);
});

test('policyFacts: reports the permissive/restrictive policy type', () => {
  const facts = policyFacts([policyRow({ permissive: 'RESTRICTIVE' })], 'mydb');
  assert.match(facts[0].fact, /type=RESTRICTIVE/);
});

test('indexUsageFacts: lists unused indexes and states the stats-reset caveat', () => {
  const idxRows = [
    { schema: 'public', table: 'accounts', index: 'accounts_pkey', idxScan: 500 },
    { schema: 'public', table: 'accounts', index: 'accounts_dead_idx', idxScan: 0 },
  ];
  const facts = indexUsageFacts(idxRows, [], '2026-01-01 00:00:00+00', 'mydb');
  const unusedFact = facts.find((f) => /accounts_dead_idx/.test(f.fact));
  assert.ok(unusedFact, 'must name the specific unused index');
  const summary = facts.find((f) => /1 of 2 index\(es\)/.test(f.fact));
  assert.ok(summary);
  assert.match(summary.fact, /accumulates since the last stats reset/);
  assert.match(summary.fact, /2026-01-01/);
});

test('indexUsageFacts: no unused indexes still produces a positive fact carrying the same caveat', () => {
  const idxRows = [{ schema: 'public', table: 'accounts', index: 'accounts_pkey', idxScan: 500 }];
  const facts = indexUsageFacts(idxRows, [], null, 'mydb');
  const summary = facts.find((f) => /no unused indexes found/.test(f.fact));
  assert.ok(summary);
  assert.match(summary.fact, /stats reset time unknown/);
});

test('indexUsageFacts: reports table scan counts per table', () => {
  const facts = indexUsageFacts([], [{ schema: 'public', table: 'accounts', seqScan: 10, idxScan: 9000 }], null, 'mydb');
  const tableFact = facts.find((f) => /accounts: 10 sequential scan/.test(f.fact));
  assert.ok(tableFact);
});

test('constraintFacts: reports FK/unique/check counts and tables missing any foreign key', () => {
  const countRows = [{ contype: 'f', count: 4 }, { contype: 'u', count: 1 }, { contype: 'c', count: 2 }];
  const noFkRows = [{ schema: 'public', table: 'orphan_tbl' }];
  const facts = constraintFacts(countRows, noFkRows, 5, 'mydb');
  const summary = facts.find((f) => /constraint counts/.test(f.fact));
  assert.match(summary.fact, /4 foreign key\(s\)/);
  assert.match(summary.fact, /1 unique constraint\(s\)/);
  assert.match(summary.fact, /2 check constraint\(s\)/);
  const noFkFact = facts.find((f) => /orphan_tbl/.test(f.fact));
  assert.ok(noFkFact);
});

test('constraintFacts: every table having a foreign key is reported as a positive fact, naming the table count', () => {
  const facts = constraintFacts([{ contype: 'f', count: 4 }], [], 3, 'mydb');
  assert.ok(facts.some((f) => /every user table \(3\).*foreign key/.test(f.fact)));
});

// tableCount guards the vacuous-truth case the review flagged: "every user
// table has at least one FK" is trivially true on a database with zero
// tables and must never be asserted as if it were a real positive finding.

test('constraintFacts: zero tables in the database is reported as an explicit fact, never as "every table has a foreign key"', () => {
  const facts = constraintFacts([], [], 0, 'mydb');
  assert.ok(!facts.some((f) => /every user table/.test(f.fact)), 'must not claim universal FK coverage on an empty database');
  assert.ok(facts.some((f) => /no user tables found/.test(f.fact)));
});

test('constraintFacts: when the table count is unknown (8.1 failed), the "no orphan tables found" claim is hedged rather than asserted as universal', () => {
  const facts = constraintFacts([{ contype: 'f', count: 4 }], [], null, 'mydb');
  assert.ok(!facts.some((f) => /every user table/.test(f.fact)), 'must not assert "every table" without a known count');
  assert.ok(facts.some((f) => /table count unavailable/.test(f.fact)));
});

test('connectionFacts: computes percentage of max_connections in use', () => {
  const facts = connectionFacts({ maxConnections: 100, superuserReserved: 3, current: 25 }, 'mydb');
  assert.equal(facts.length, 1);
  assert.equal(facts[0].probe, '3.8');
  assert.match(facts[0].fact, /25\.0% of max_connections/);
});

// --- collectDb orchestration (injected deps.runQuery — no live database) --

function fakeOk(stdout) {
  return { ok: true, stdout };
}
function fakeFail(kind, reason) {
  return { ok: false, kind, reason };
}

const SUCCESS_STDOUT = {
  bootstrap: 'mydb\n',
  rls: 'public,accounts,t,f,1\n',
  policies: 'public,accounts,p1,SELECT,PERMISSIVE,authenticated,(true),\n',
  idxUsage: 'public,accounts,accounts_pkey,10\n',
  tableScans: 'public,accounts,1,10\n',
  statsReset: '2026-01-01 00:00:00+00\n',
  constraintCounts: 'f,1\n',
  noFkTables: '',
  connections: '100,3,10\n',
};

function successRunQuery({ key }) {
  return fakeOk(SUCCESS_STDOUT[key]);
}

test('collectDb: a fully successful run produces facts for every probe, no gaps, and a meta.connection fact', () => {
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery: successRunQuery });
  assert.equal(doc.tier, 'db');
  assert.equal(doc.target.dbname, 'mydb');
  assert.equal(doc.unavailable.length, 0);
  for (const probe of ['8.1', '8.2', '3.2', '3.4', '3.8']) {
    assert.ok(doc.facts.some((f) => f.probe === probe), `expected at least one fact for probe ${probe}`);
  }
  assert.ok(doc.facts.some((f) => f.probe === 'meta.connection'));
  assert.ok(doc.facts.every((f) => f.class === 'inspected'));
});

test('collectDb: bootstrap failure (psql absent) lands every probe in unavailable, none in facts, and never confused with "found nothing"', () => {
  const runQuery = () => fakeFail('unavailable-tool', 'psql could not be invoked (ENOENT) — install the PostgreSQL client tools');
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  assert.equal(doc.facts.length, 0);
  assert.equal(doc.unavailable.length, 5);
  assert.deepEqual(doc.unavailable.map((u) => u.probe).sort(), ['3.2', '3.4', '3.8', '8.1', '8.2']);
  for (const u of doc.unavailable) {
    assert.match(u.reason, /psql/i);
    assert.doesNotMatch(u.reason, /found/i);
  }
  assert.equal(doc.target.dbname, null);
});

test('collectDb: bootstrap returning exit 0 with empty stdout (Critical 2\'s empty-stdout scenario) fails validation and never reports "no policies found"', () => {
  const runQuery = () => fakeOk('');
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  assert.equal(doc.facts.length, 0);
  assert.equal(doc.unavailable.length, 5);
  for (const u of doc.unavailable) assert.match(u.reason, /exactly one/);
});

test('collectDb: bootstrap returning a \\conninfo-shaped sentence fails validation and the sentence never reaches target.dbname', () => {
  const conninfo = 'You are connected to database "appdb" as user "reviewuser" on host "10.1.2.3" at port "5432".\n';
  const runQuery = () => fakeOk(conninfo);
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  assert.equal(doc.target.dbname, null);
  assert.equal(doc.unavailable.length, 5);
  const json = JSON.stringify(doc);
  assert.ok(!json.includes('appdb'));
  assert.ok(!json.includes('reviewuser'));
  assert.ok(!json.includes('10.1.2.3'));
});

test('collectDb: a single query returning malformed (wrong-arity) output lands only that probe in unavailable, never a fabricated fact', () => {
  const runQuery = ({ key }) => (key === 'rls' ? fakeOk('schemaname,relname,indexrelname,idx_scan\n') : successRunQuery({ key }));
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  assert.ok(doc.unavailable.some((u) => u.probe === '8.1'));
  assert.ok(!doc.facts.some((f) => f.probe === '8.1'));
  // every other probe, unaffected by 8.1's malformed row, still has real facts
  for (const probe of ['8.2', '3.2', '3.4', '3.8']) {
    assert.ok(doc.facts.some((f) => f.probe === probe));
  }
});

test('collectDb: bootstrap failure by connection/auth/timeout each produce a reason distinguishable from the others', () => {
  const scenarios = [
    ['connection', 'could not establish a connection to the database within the configured timeout'],
    ['auth', 'authentication or authorisation to the database failed'],
    ['timeout', 'the query was cancelled after exceeding statement_timeout'],
  ];
  const reasons = scenarios.map(([kind, reason]) => {
    const runQuery = () => fakeFail(kind, reason);
    const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
    return doc.unavailable[0].reason;
  });
  assert.equal(new Set(reasons).size, 3, 'connection/auth/timeout failures must be textually distinct');
});

test('collectDb: 3.2 lands in facts (not unavailable) when idxUsage succeeds even though tableScans fails, with the failure folded into a fact', () => {
  const runQuery = ({ key }) => {
    if (key === 'tableScans') return fakeFail('error', 'psql exited with status 1');
    return successRunQuery({ key });
  };
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  assert.ok(!doc.unavailable.some((u) => u.probe === '3.2'), '3.2 has real evidence from idxUsage and must not also be a gap');
  assert.ok(doc.facts.some((f) => f.probe === '3.2' && /table scan statistics could not be inspected/.test(f.fact)));
});

test('collectDb: 3.2 lands in unavailable only when BOTH idxUsage and tableScans fail', () => {
  const runQuery = ({ key }) => {
    if (key === 'idxUsage' || key === 'tableScans') return fakeFail('error', 'psql exited with status 1');
    return successRunQuery({ key });
  };
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  assert.ok(doc.unavailable.some((u) => u.probe === '3.2'));
  assert.ok(!doc.facts.some((f) => f.probe === '3.2'));
});

test('collectDb: 3.4 reconciles the same way across constraintCounts/noFkTables', () => {
  const partialRunQuery = ({ key }) => {
    if (key === 'noFkTables') return fakeFail('error', 'psql exited with status 1');
    return successRunQuery({ key });
  };
  const partial = collectDb({ dsn: FAKE_DSN }, { runQuery: partialRunQuery });
  assert.ok(!partial.unavailable.some((u) => u.probe === '3.4'));
  assert.ok(partial.facts.some((f) => f.probe === '3.4' && /tables missing a foreign key could not be inspected/.test(f.fact)));

  const bothFailRunQuery = ({ key }) => {
    if (key === 'constraintCounts' || key === 'noFkTables') return fakeFail('error', 'psql exited with status 1');
    return successRunQuery({ key });
  };
  const bothFail = collectDb({ dsn: FAKE_DSN }, { runQuery: bothFailRunQuery });
  assert.ok(bothFail.unavailable.some((u) => u.probe === '3.4'));
  assert.ok(!bothFail.facts.some((f) => f.probe === '3.4'));
});

// --- invariant: a probe lands in exactly one of facts / unavailable, never
// both, never neither — extends the same discipline repo.test.mjs asserts
// for collect-static.mjs's collectors to this collector.

function assertMutualExclusion(doc) {
  const factProbes = new Set(doc.facts.map((f) => f.probe));
  for (const { probe } of doc.unavailable) {
    assert.ok(!factProbes.has(probe), `probe ${probe} appears in both facts and unavailable`);
  }
}

test('collectDb: no probe appears in both facts and unavailable, across success, total failure, malformed-output, and partial-failure scenarios', () => {
  const scenarios = [
    collectDb({ dsn: FAKE_DSN }, { runQuery: successRunQuery }),
    collectDb({ dsn: FAKE_DSN }, { runQuery: () => fakeFail('unavailable-tool', 'psql absent') }),
    collectDb({ dsn: FAKE_DSN }, { runQuery: () => fakeOk('') }),
    collectDb({ dsn: FAKE_DSN }, {
      runQuery: ({ key }) => (key === 'rls' ? fakeOk('one,field\n') : successRunQuery({ key })),
    }),
    collectDb({ dsn: FAKE_DSN }, {
      runQuery: ({ key }) => (key === 'tableScans' ? fakeFail('error', 'x') : successRunQuery({ key })),
    }),
    collectDb({ dsn: FAKE_DSN }, {
      runQuery: ({ key }) => (['idxUsage', 'tableScans'].includes(key) ? fakeFail('error', 'x') : successRunQuery({ key })),
    }),
  ];
  for (const doc of scenarios) assertMutualExclusion(doc);
});

test('every probe named across every collectDb scenario is either 8.1/8.2/3.2/3.4/3.8 or the meta.connection pseudo-probe', () => {
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery: successRunQuery });
  const allowed = new Set(['8.1', '8.2', '3.2', '3.4', '3.8', 'meta.connection']);
  for (const f of doc.facts) assert.ok(allowed.has(f.probe), `unexpected probe ${f.probe}`);
});

// --- DSN leak: the emitted document must never carry the password, host or
// user, in any field, under any outcome.

test('DSN leak: the whole emitted document never contains the DSN password/host/user, on a simulated auth failure', () => {
  const runQuery = () => fakeFail('auth', 'authentication or authorisation to the database failed');
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery });
  const json = JSON.stringify(doc);
  assert.ok(!json.includes(FAKE_PASSWORD), 'password must never appear in the emitted evidence document');
  assert.ok(!json.includes(FAKE_HOST), 'host must never appear either');
  assert.ok(!json.includes(FAKE_USER), 'user must never appear either');
  assert.ok(!json.includes(FAKE_DSN), 'the raw DSN must never appear either');
});

test('DSN leak: the whole emitted document never contains the DSN password/host/user, on a fully successful run', () => {
  const doc = collectDb({ dsn: FAKE_DSN }, { runQuery: successRunQuery });
  const json = JSON.stringify(doc);
  assert.ok(!json.includes(FAKE_PASSWORD));
  assert.ok(!json.includes(FAKE_HOST));
  assert.ok(!json.includes(FAKE_USER));
  assert.ok(!json.includes(FAKE_DSN));
});

// --- real end-to-end: psql genuinely absent ---------------------------------
//
// psql is very likely absent on the machine running this suite (confirmed
// absent on the machine this was written on — the same situation
// repo.test.mjs's govulncheck tests document). That makes the absent-tool
// path the one scenario testable against the REAL collectDb (no injected
// deps, a real spawnSync('psql', ...) call) without a fake executable.

test('real end-to-end: with psql absent (the expected case), every probe is unavailable, reasons name psql, and the DSN never leaks — no injected deps', () => {
  const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 3000 });
  assert.equal(doc.tier, 'db');
  assert.equal(doc.unavailable.length, 5);
  assert.equal(doc.facts.length, 0);
  const json = JSON.stringify(doc);
  assert.ok(!json.includes(FAKE_PASSWORD));
  assert.ok(!json.includes(FAKE_HOST));
  assert.ok(!json.includes(FAKE_USER));
  assert.ok(!json.includes(FAKE_DSN));
});

// --- real end-to-end: a fake `psql` on PATH -------------------------------
//
// The scenarios above (injected deps.runQuery) prove the parsing/validation
// logic in isolation, but nothing above drives a REAL spawnSync('psql', ...)
// call through unexpected-but-exit-0 output, or a real ETIMEDOUT from the OS
// killing a hung process. This section builds a tiny real executable (via
// `go build` — go is already a soft dependency of this test suite; see
// README's npm/go gotcha) and prepends it to PATH so collectDb()'s
// unmodified, real spawnSync('psql', ...) call finds and runs it — the same
// path production code takes, not a shortcut around it. Its behaviour is
// selected via the FAKE_PSQL_MODE environment variable, which each test sets
// and restores. If `go` isn't available, every test in this section skips
// rather than failing, mirroring this project's existing go-optional
// precedent (see repo.test.mjs / README).

const FAKE_PSQL_SOURCE = `package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

func hasArg(args []string, exact string) bool {
	for _, a := range args {
		if a == exact {
			return true
		}
	}
	return false
}

func anyArgContains(args []string, sub string) bool {
	for _, a := range args {
		if strings.Contains(a, sub) {
			return true
		}
	}
	return false
}

func main() {
	args := os.Args[1:]
	mode := os.Getenv("FAKE_PSQL_MODE")
	isBootstrap := hasArg(args, "SELECT current_database()")
	isRls := anyArgContains(args, "relforcerowsecurity")
	isPolicies := anyArgContains(args, "array_to_string(roles")

	switch mode {
	case "empty-stdout":
		os.Exit(0)
	case "header-only":
		if isBootstrap {
			fmt.Println("testdb")
		} else if isRls {
			fmt.Println("schemaname,relname,indexrelname,idx_scan")
		}
		os.Exit(0)
	case "conninfo":
		fmt.Println("You are connected to database \\"appdb\\" as user \\"reviewuser\\" on host \\"10.1.2.3\\" at port \\"5432\\".")
		os.Exit(0)
	case "separator-collision":
		if isBootstrap {
			fmt.Println("testdb")
		} else if isRls {
			fmt.Println("public,\\"ac,counts\\",f,f,0")
		}
		os.Exit(0)
	case "hang":
		time.Sleep(60 * time.Second)
	case "nonzero-partial":
		if isBootstrap {
			fmt.Println("testdb")
			os.Exit(0)
		}
		if isPolicies {
			fmt.Fprintln(os.Stderr, "ERROR:  permission denied for relation pg_policies")
			os.Exit(1)
		}
		os.Exit(0)
	default:
		if isBootstrap {
			fmt.Println("testdb")
		}
		os.Exit(0)
	}
}
`;

let fakePsqlDir = null;
let fakePsqlAvailable = false;
let originalPath = null;

before(() => {
  originalPath = process.env.PATH;
  const goCheck = spawnSync('go', ['version'], { encoding: 'utf8' });
  if (goCheck.error || goCheck.status !== 0) return;

  const dir = mkdtempSync(join(tmpdir(), 'fake-psql-'));
  const srcPath = join(dir, 'fake_psql.go');
  writeFileSync(srcPath, FAKE_PSQL_SOURCE);
  const exeName = process.platform === 'win32' ? 'psql.exe' : 'psql';
  const outPath = join(dir, exeName);
  const build = spawnSync('go', ['build', '-o', outPath, srcPath], { encoding: 'utf8', timeout: 60_000 });
  if (build.error || build.status !== 0) return;

  fakePsqlDir = dir;
  fakePsqlAvailable = true;
});

after(() => {
  process.env.PATH = originalPath;
  delete process.env.FAKE_PSQL_MODE;
  if (fakePsqlDir) rmSync(fakePsqlDir, { recursive: true, force: true });
});

function withFakePsql(t, mode, fn) {
  if (!fakePsqlAvailable) {
    t.skip('go not available to build the fake psql fixture for this real end-to-end test');
    return;
  }
  process.env.PATH = `${fakePsqlDir}${delimiter}${originalPath}`;
  process.env.FAKE_PSQL_MODE = mode;
  try {
    fn();
  } finally {
    process.env.PATH = originalPath;
    delete process.env.FAKE_PSQL_MODE;
  }
}

test('fake psql: empty stdout on every call (Critical 2) fails bootstrap validation — never "no policies found"', (t) => {
  withFakePsql(t, 'empty-stdout', () => {
    const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 5000 });
    assert.equal(doc.facts.length, 0);
    assert.equal(doc.unavailable.length, 5);
    for (const u of doc.unavailable) assert.doesNotMatch(u.reason, /found/i);
  });
});

test('fake psql: a header-only row leaking through on the RLS query (Critical 2/Important 3) lands only 8.1 in unavailable, never a fabricated "RLS is disabled" fact', (t) => {
  withFakePsql(t, 'header-only', () => {
    const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 5000 });
    assert.equal(doc.target.dbname, 'testdb');
    assert.ok(doc.unavailable.some((u) => u.probe === '8.1'));
    assert.ok(!doc.facts.some((f) => f.probe === '8.1'));
    assert.ok(!JSON.stringify(doc).includes('RLS is disabled'));
  });
});

test('fake psql: a psqlrc-style \\conninfo injection (Critical 1) never leaks host/user/dbname into the document, on a real spawned process', (t) => {
  withFakePsql(t, 'conninfo', () => {
    const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 5000 });
    assert.equal(doc.target.dbname, null);
    assert.equal(doc.unavailable.length, 5);
    const json = JSON.stringify(doc);
    assert.ok(!json.includes('appdb'));
    assert.ok(!json.includes('reviewuser'));
    assert.ok(!json.includes('10.1.2.3'));
    assert.ok(!json.includes(FAKE_PASSWORD));
    assert.ok(!json.includes(FAKE_HOST));
  });
});

test('fake psql: a table name with an embedded comma round-trips correctly through real --csv output (Important 3, positive case)', (t) => {
  withFakePsql(t, 'separator-collision', () => {
    const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 5000 });
    assert.equal(doc.target.dbname, 'testdb');
    assert.ok(doc.facts.some((f) => f.probe === '8.1' && /ac,counts/.test(f.fact)), 'the comma-bearing table name must appear whole, not truncated to "ac"');
    assert.ok(!doc.unavailable.some((u) => u.probe === '8.1'));
  });
});

test('fake psql: a real hang past the timeout (Important 5) is classified as a timeout, never "psql is not installed"', (t) => {
  withFakePsql(t, 'hang', () => {
    const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 3000 });
    assert.equal(doc.unavailable.length, 5);
    for (const u of doc.unavailable) {
      assert.doesNotMatch(u.reason, /install/i, 'a hung database must never be reported as "psql is not installed"');
      assert.match(u.reason, /timeout|terminated/i);
    }
  });
});

test('fake psql: a real permission-denied error on one query (not bootstrap) lands only that probe in unavailable, never "no policies found"', (t) => {
  withFakePsql(t, 'nonzero-partial', () => {
    const doc = collectDb({ dsn: FAKE_DSN, spawnTimeoutMs: 5000 });
    assert.equal(doc.target.dbname, 'testdb');
    assert.ok(doc.unavailable.some((u) => u.probe === '8.2'));
    assert.ok(!doc.facts.some((f) => f.probe === '8.2'));
    assert.ok(!JSON.stringify(doc).includes('no policies found'));
  });
});

// --- collect-db.mjs CLI --------------------------------------------------

test('CLI: --dsn with no following value exits 2 with the usage message', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--dsn'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: collect-db\.mjs/);
  assert.equal(result.stdout, '');
});

test('CLI: usage text recommends the environment over --dsn, names a read-only role, and mentions process-list visibility', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--dsn'], { encoding: 'utf8' });
  assert.match(result.stderr, /shell history/i);
  assert.match(result.stderr, /read-only/i);
  assert.match(result.stderr, /process list/i);
});

test('CLI: --help prints usage and exits 0 without ever attempting a connection', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--help'], { encoding: 'utf8', env: { ...process.env, PGHOST: 'should-never-be-contacted.invalid' } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: collect-db\.mjs/);
  assert.equal(result.stderr, '');
});

test('CLI: -h also prints usage and exits 0', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '-h'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: collect-db\.mjs/);
});

test('CLI: with psql absent, a run against an unroutable --dsn still exits 0 with a well-formed document on stdout, and never leaks the DSN', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--dsn', FAKE_DSN], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
  const doc = JSON.parse(result.stdout);
  assert.equal(doc.tier, 'db');
  assert.ok(!result.stdout.includes(FAKE_PASSWORD));
  assert.ok(!result.stdout.includes(FAKE_HOST));
  assert.ok(!result.stdout.includes(FAKE_USER));
});

test('CLI: when both PGURL and --dsn are given, a note on stderr says PGURL wins (stdout stays clean JSON)', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--dsn', FAKE_DSN], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PGURL: 'postgres://other-host/otherdb' },
  });
  assert.match(result.stderr, /PGURL.*takes precedence/i);
  assert.doesNotThrow(() => JSON.parse(result.stdout), 'stdout must remain valid JSON, unpolluted by the stderr note');
});

test('CLI: --out writes the file and prints the "<n> facts, <m> gaps → <out>" summary line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-audit-db-cli-'));
  try {
    const outPath = join(dir, 'db.json');
    const result = spawnSync(process.execPath, [CLI_PATH, '--dsn', FAKE_DSN, '--out', outPath], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, `expected a clean run, got stderr: ${result.stderr}`);
    assert.match(result.stdout, /\d+ facts, \d+ gaps → .*db\.json/);
    const doc = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(doc.tier, 'db');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
