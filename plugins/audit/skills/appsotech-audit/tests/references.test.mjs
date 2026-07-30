import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILL = join(import.meta.dirname, '..');
const REF = (f) => readFileSync(join(SKILL, 'references', f), 'utf8');

// The repo root (five levels up from tests/: tests -> appsotech-audit -> skills
// -> audit -> plugins -> repo root), same derivation manifests.test.mjs
// already uses, to reach the standalone root-level methodology document.
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const ROOT_DOC = () => readFileSync(join(ROOT, '13-app-audit', 'app-audit.md'), 'utf8');

const FILES = ['rubric-layers-01-04.md', 'rubric-layers-05-09.md', 'rubric-layers-10-13.md'];
const EXPECTED_COUNTS = { 1: 8, 2: 8, 3: 9, 4: 9, 5: 7, 6: 7, 7: 7, 8: 9, 9: 7, 10: 7, 11: 7, 12: 8, 13: 8 };
const GATES = {
  '1.4': 'G3', '3.6': 'G1', '4.3': 'G6', '5.3': 'G4', '8.1': 'G2',
  '8.3': 'G2', '8.4': 'G8', '9.1': 'G7', '12.3': 'G5', '13.2': 'G1',
};

function probeIds(text) {
  // table rows shaped: | 1.4 | probe text | evidence |
  return [...text.matchAll(/^\|\s*(\d{1,2}\.\d{1,2})\s*\|/gm)].map((m) => m[1]);
}

test('all 101 probes appear exactly once across the three rubric files', () => {
  const all = FILES.flatMap((f) => probeIds(REF(f)));
  assert.equal(all.length, 101, `expected 101 probes, found ${all.length}`);
  assert.equal(new Set(all).size, 101, 'duplicate probe IDs found');
});

test('each layer has its expected probe count', () => {
  const all = FILES.flatMap((f) => probeIds(REF(f)));
  const counts = {};
  for (const id of all) {
    const layer = Number(id.split('.')[0]);
    counts[layer] = (counts[layer] ?? 0) + 1;
  }
  assert.deepEqual(counts, EXPECTED_COUNTS);
});

test('probe numbering within each layer is contiguous from 1', () => {
  const all = FILES.flatMap((f) => probeIds(REF(f)));
  for (const [layer, count] of Object.entries(EXPECTED_COUNTS)) {
    const nums = all
      .filter((id) => id.startsWith(`${layer}.`))
      .map((id) => Number(id.split('.')[1]))
      .sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: count }, (_, i) => i + 1), `layer ${layer}`);
  }
});

test('every gate marker sits on the correct probe and nowhere else', () => {
  const text = FILES.map(REF).join('\n');
  const found = {};
  for (const m of text.matchAll(/^\|\s*(\d{1,2}\.\d{1,2})\s*\|([^|]*)\|/gm)) {
    const gate = m[2].match(/\[(G[1-8])\]/);
    if (gate) found[m[1]] = gate[1];
  }
  assert.deepEqual(found, GATES);
});

test('layer files carry no probes belonging to another file', () => {
  const ranges = [[1, 4], [5, 9], [10, 13]];
  FILES.forEach((f, i) => {
    const [lo, hi] = ranges[i];
    for (const id of probeIds(REF(f))) {
      const layer = Number(id.split('.')[0]);
      assert.ok(layer >= lo && layer <= hi, `${id} is in ${f} but belongs to layers ${lo}-${hi}`);
    }
  });
});

test('scoring.md states the weights, all eight gates and all five bands', () => {
  const s = REF('scoring.md');
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']) {
    assert.match(s, new RegExp(`\\b${g}\\b`), `scoring.md must define ${g}`);
  }
  for (const b of ['Production-hardened', 'Production-ready', 'Serviceable', 'At risk', 'Not production-viable']) {
    assert.ok(s.includes(b), `scoring.md must define band "${b}"`);
  }
  assert.ok(s.includes('capped at 2'), 'scoring.md must state the attested cap');
});

function weightTable(text) {
  // rows shaped: | 8 | Security / RLS | 12 |  (three plain, unbolded columns)
  const weights = {};
  for (const m of text.matchAll(/^\|\s*(\d{1,2})\s*\|[^|]+\|\s*(\d{1,3})\s*\|\s*$/gm)) {
    weights[Number(m[1])] = Number(m[2]);
  }
  return weights;
}

test('scoring.md weight table has the exact default weights and they sum to 100', () => {
  const s = REF('scoring.md');
  const weights = weightTable(s);
  const expected = { 1: 6, 2: 10, 3: 10, 4: 12, 5: 7, 6: 6, 7: 7, 8: 12, 9: 5, 10: 5, 11: 6, 12: 7, 13: 7 };
  assert.deepEqual(weights, expected, 'scoring.md weight table must match the default weights exactly');
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100, `default weights must sum to 100, got ${sum}`);
});

test('scoring.md band boundaries and the gate-cap figure are exact', () => {
  const s = REF('scoring.md');
  const bandRanges = {};
  for (const m of s.matchAll(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+?)\s*\|/gm)) {
    bandRanges[m[1]] = m[2];
  }
  assert.equal(bandRanges['Production-hardened'], '85–100');
  assert.equal(bandRanges['Production-ready'], '70–84');
  assert.equal(bandRanges['Serviceable'], '55–69');
  assert.equal(bandRanges['At risk'], '40–54');
  assert.equal(bandRanges['Not production-viable'], '<40');
  assert.match(s, /cap the overall score at 49/, 'scoring.md must state the hard-gate cap figure of 49');
  assert.ok(s.includes('**Evidence over assertion.**'), 'scoring.md must keep the "Evidence over assertion." lead-in');
});

test('report-templates.md defines every register field, all four severities, both sequencing overrides, and all seven report sections', () => {
  const s = REF('report-templates.md');
  const fields = [
    'ID', 'Layer / Probe', 'Title', 'Severity', 'Hard gate', 'Evidence', 'Impact',
    'Likelihood', 'Effort', 'Recommendation', 'Owner', 'Target date', 'Status',
  ];
  for (const f of fields) {
    assert.ok(s.includes(`**${f}**`), `report-templates.md must define register field "${f}"`);
  }
  for (const sev of ['P0', 'P1', 'P2', 'P3']) {
    assert.ok(s.includes(sev), `report-templates.md must define severity ${sev}`);
  }
  assert.match(s, /hard gate goes first/, 'must state the hard-gate-first sequencing override');
  assert.match(s, /reduces blast radius/, 'must state the cheap-blast-radius-reducer sequencing override');
  const sections = [
    'Cover', 'Executive summary', 'Scorecard', 'Findings register',
    'Remediation plan', 'Evidence appendix', 'Re-audit date',
  ];
  for (const section of sections) {
    assert.ok(s.includes(`**${section}**`), `report-templates.md must list report-structure section "${section}"`);
  }
});

test('report-templates.md includes the layer ownership map with all eight arbitration rows intact', () => {
  const s = REF('report-templates.md');
  const heading = '## Layer ownership map';
  const start = s.indexOf(heading);
  assert.ok(start !== -1, 'report-templates.md must have a "## Layer ownership map" heading');
  const rest = s.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s/);
  const mapSection = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const rows = {};
  for (const m of mapSection.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)) {
    if (m[1] === 'Concern' || m[1].startsWith('---')) continue;
    rows[m[1]] = [m[2], m[3]];
  }

  const expected = {
    'Where the app runs and how it gets there': ['5 Hosting/deployment', '6 Cloud/compute'],
    'Which resources exist, sized how, at what cost': ['6 Cloud/compute', '5 Hosting/deployment'],
    'Abuse prevention and quota enforcement': ['9 Rate limiting', '8 Security'],
    'Authorisation policy at the data layer': ['8 Security/RLS', '4 Auth/permissions'],
    'Identity, sessions, and role model': ['4 Auth/permissions', '8 Security/RLS'],
    'Capacity headroom and elasticity': ['11 Load balancing/scaling', '6 Cloud/compute'],
    'Detection and diagnosis of failure': ['12 Error tracking/logs', '13 Availability/recovery'],
    'Restoration after failure': ['13 Availability/recovery', '12 Error tracking/logs'],
  };
  assert.deepEqual(rows, expected);
});

// --- root app-audit.md must stay bound to references/rubric-layers-*.md ----
//
// 13-app-audit/app-audit.md (the standalone, browsable methodology document
// at the repo root) and references/rubric-layers-*.md (what the skill
// actually loads at runtime) carry 100% duplicated probe-table content by
// design — one document for a human reading the methodology on its own, one
// split by layer range for the skill to load incrementally. Nothing
// previously checked that the two stayed in sync; an edit to a probe's
// wording, evidence column or gate marker in only one of them would silently
// desync the published methodology from what the skill actually scores
// against. This compares every probe row (the full `| ID | ... | ... |`
// line, gate marker included) between the two sources.

function probeRows(text) {
  const rows = {};
  for (const m of text.matchAll(/^\|\s*(\d{1,2}\.\d{1,2})\s*\|.*\|\s*$/gm)) {
    rows[m[1]] = m[0].trim();
  }
  return rows;
}

test('root app-audit.md probe rows are byte-identical to references/rubric-layers-*.md — no silent desync', () => {
  const refRows = {};
  for (const f of FILES) Object.assign(refRows, probeRows(REF(f)));
  const rootRows = probeRows(ROOT_DOC());
  assert.equal(Object.keys(rootRows).length, 101, 'root app-audit.md must carry all 101 probe rows');
  assert.deepEqual(
    rootRows,
    refRows,
    'app-audit.md has drifted from references/rubric-layers-*.md — keep the duplicated probe tables in sync',
  );
});
