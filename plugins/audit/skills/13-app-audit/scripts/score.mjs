#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scoreAudit } from './lib/scoring.mjs';
import { renderScorecard, renderBaselineDiff } from './lib/render.mjs';
import { flagValue, positionals } from './lib/cli-args.mjs';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--baseline', '--out']);

const input = positionals(args, VALUE_FLAGS)[0] ?? null;

if (!input) {
  console.error('usage: score.mjs <scores.json> [--baseline <scorecard.json>] [--out <dir>]');
  process.exit(2);
}

const outDir = flagValue(args, '--out') ?? '.';
const doc = JSON.parse(readFileSync(input, 'utf8'));
// scores.json may carry an optional top-level `weights` key (Phase 1's
// re-weighting, threaded through by the auditor) — scoreAudit already
// accepts this via opts.weights and falls back to the default WEIGHTS table
// whenever it's absent; this was previously unreachable because nothing
// called scoreAudit with a second argument at all.
const card = scoreAudit(doc, { weights: doc.weights });
let md = renderScorecard(card);

const baselinePath = flagValue(args, '--baseline');
if (baselinePath) {
  md += '\n\n' + renderBaselineDiff(card, JSON.parse(readFileSync(baselinePath, 'utf8')));
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'SCORECARD.md'), md);
writeFileSync(join(outDir, 'scorecard.json'), JSON.stringify(card, null, 2));

if (card.overall === null) {
  console.log('no probes were scored — overall not computed');
} else {
  console.log(`overall ${card.overall} — ${card.band}`);
}
if (card.gates.length) console.log(`GATES FIRED: ${card.gates.map((g) => g.gate).join(', ')}`);
if (card.unverified.length) console.log(`${card.unverified.length} probes UNVERIFIED — this is a floor score`);
