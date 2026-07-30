#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scoreAudit } from './lib/scoring.mjs';
import { renderScorecard, renderBaselineDiff } from './lib/render.mjs';
import { flagValue, positionals } from './lib/cli-args.mjs';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--baseline', '--out']);

const input = positionals(args, VALUE_FLAGS)[0] ?? null;
const allowPartial = args.includes('--partial');

if (!input) {
  console.error('usage: score.mjs <scores.json> [--baseline <scorecard.json>] [--out <dir>] [--partial]');
  process.exit(2);
}

const outDir = flagValue(args, '--out') ?? '.';
const doc = JSON.parse(readFileSync(input, 'utf8'));

// Phase 1 calls the reference point non-negotiable and says these five keys
// are exact, but nothing enforced it: a scores.json with no scope rendered
// "(unspecified)" in all five cover fields and scored anyway. A scorecard
// with no `ref` can never be re-audited against, which is the whole reason
// Phase 1 refuses to substitute "latest" for a real one.
const REQUIRED_SCOPE = ['system', 'ref', 'environment', 'date', 'auditor'];
const missingScope = REQUIRED_SCOPE.filter(
  (k) => doc.scope?.[k] === undefined || doc.scope?.[k] === null || doc.scope?.[k] === '',
);
if (missingScope.length > 0) {
  console.error(
    `scores.json is missing required scope field(s): ${missingScope.join(', ')}\n` +
    'Copy the five keys verbatim from Phase 1 into a top-level "scope" object. ' +
    'A scorecard without a ref cannot be re-audited against.',
  );
  process.exit(2);
}
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

const { coverage } = card;
console.log(
  `coverage ${coverage.scored}/${coverage.expected} probes · ` +
  `${coverage.layersScored}/${coverage.layersExpected} layers`,
);

if (card.overall === null) {
  console.log('no probes were scored — overall not computed');
} else if (card.band === null) {
  console.log(`overall ${card.overall} — PARTIAL AUDIT, no band`);
} else {
  console.log(`overall ${card.overall} — ${card.band}`);
}
if (card.gates.length) console.log(`GATES FIRED: ${card.gates.map((g) => g.gate).join(', ')}`);
if (card.unverified.length) console.log(`${card.unverified.length} probes UNVERIFIED — this is a floor score`);

// Non-zero on an unacknowledged partial run. The artifact already says it is
// incomplete, but Phase 3 writes scores.json after every layer group, so the
// half-finished file is the normal intermediate state — scoring one by
// accident and handing the result on is the easy mistake, and it is the one
// that puts a flattering number in front of a client.
if (!coverage.complete && !allowPartial) {
  console.error(
    `\nRefusing to report a partial audit as complete. ${coverage.expected - coverage.scored} probe(s) unscored` +
    (coverage.missingLayers.length ? `; no probes at all in layer(s) ${coverage.missingLayers.join(', ')}` : '') +
    '.\nFinish the remaining layer groups, or pass --partial to acknowledge an interim scorecard.',
  );
  process.exit(1);
}
