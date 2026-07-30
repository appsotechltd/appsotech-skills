#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { collectStatic } from './lib/repo.mjs';
import { flagValue, positionals } from './lib/cli-args.mjs';

const args = process.argv.slice(2);
const USAGE = 'usage: collect-static.mjs <targetDir> [--out <path>]';
const VALUE_FLAGS = new Set(['--out']);

function usageExit() {
  console.error(USAGE);
  process.exit(2);
}

const target = positionals(args, VALUE_FLAGS)[0] ?? null;
if (!target) usageExit();

// A typo'd or nonexistent target must not be indistinguishable from a real
// target that genuinely has no CI, no Dockerfile and no build output:
// collectStatic() reports both the same way (a well-formed document, every
// relevant probe in unavailable[]), so existence is checked here rather
// than left for a reader to infer from an all-gaps evidence file that never
// says the directory it was pointed at doesn't exist.
if (!existsSync(target) || !statSync(target).isDirectory()) usageExit();

const out = flagValue(args, '--out');

const doc = collectStatic(target);
const json = JSON.stringify(doc, null, 2);

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`${doc.facts.length} facts, ${doc.unavailable.length} gaps → ${out}`);
} else {
  console.log(json);
}
