#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { collectLive } from './lib/live.mjs';
import { flagValue } from './lib/cli-args.mjs';

const args = process.argv.slice(2);
const USAGE = 'usage: collect-live.mjs --url <base> [--auth-path <p>] [--probe-rate-limit] [--i-own-this] [--out <path>]';

function usageExit() {
  console.error(USAGE);
  process.exit(2);
}

const url = flagValue(args, '--url');
const authPath = flagValue(args, '--auth-path');
const out = flagValue(args, '--out');
const probeRateLimit = args.includes('--probe-rate-limit');
const iOwnThis = args.includes('--i-own-this');

if (!url) usageExit();

// Validated once, up front, so a malformed --url produces the same clean
// usage-and-exit-2 as a missing one, instead of an uncaught TypeError from
// deep inside the collector the first time it tries to resolve a relative
// path against this string.
try {
  new URL(url);
} catch {
  usageExit();
}

const doc = await collectLive({ url, authPath, probeRateLimit, iOwnThis });
const json = JSON.stringify(doc, null, 2);

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`${doc.facts.length} facts, ${doc.unavailable.length} gaps → ${out}`);
} else {
  console.log(json);
}
