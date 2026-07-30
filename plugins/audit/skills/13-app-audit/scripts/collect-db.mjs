#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { collectDb, resolveDsn } from './lib/db.mjs';
import { flagValue } from './lib/cli-args.mjs';

const args = process.argv.slice(2);
const USAGE = [
  'usage: collect-db.mjs [--dsn <connstring>] [--out <path>]',
  '',
  '  Requires psql (PostgreSQL 12 or later, for --csv output) on PATH.',
  '',
  '  Reads the connection from the environment by preference: PGURL (a full',
  '  connection string/URI), or the standard PGHOST/PGDATABASE/PGUSER/',
  '  PGPASSWORD/... variables psql already reads natively. --dsn is an',
  '  explicit alternative for when neither is set — a value passed on the',
  '  command line lands in your shell history AND is visible to other users',
  '  on this machine via the process list for as long as this command runs,',
  '  so prefer the environment. If PGURL is also set, it wins over --dsn.',
  '',
  '  Use a read-only database role for the connection. Every query already',
  '  runs inside a read-only transaction with a statement timeout, but a',
  '  least-privilege role is still the right input, not a substitute for one.',
].join('\n');

// --help/-h must never fall through to collectDb(): on a machine that
// already has PG* environment variables set (a normal thing for a
// developer or CI box to have), the absence of this check meant --help
// silently connected to whatever database those variables pointed at
// instead of printing usage.
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

function usageExit() {
  console.error(USAGE);
  process.exit(2);
}

// --dsn present but with no usable value (e.g. the last token on the line,
// or immediately followed by another flag) is a real mistake worth catching
// here rather than silently falling through to "no --dsn given" and reading
// from the environment instead, which would run the collector against a
// connection the caller never intended.
const dsnGiven = args.includes('--dsn');
const dsnFlag = flagValue(args, '--dsn');
if (dsnGiven && !dsnFlag) usageExit();

const out = flagValue(args, '--out');
const { dsn, source } = resolveDsn({ dsnFlag });

// PGURL silently outranking a --dsn the caller explicitly typed is exactly
// the kind of thing worth a one-line heads-up — printed to stderr so it
// never pollutes the JSON document on stdout.
if (dsnFlag && source === 'PGURL environment variable') {
  console.error('note: PGURL is set and takes precedence over --dsn; the --dsn value is being ignored');
}

const doc = collectDb({ dsn });
const json = JSON.stringify(doc, null, 2);

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`${doc.facts.length} facts, ${doc.unavailable.length} gaps → ${out}`);
} else {
  console.log(json);
}
