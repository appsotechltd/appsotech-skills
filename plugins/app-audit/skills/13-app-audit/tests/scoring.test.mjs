import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEIGHTS, GATE_PROBES, clampByClass, layerScore, weightedOverall,
  firedGates, band, scoreAudit,
} from '../scripts/lib/scoring.mjs';

test('weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('attested evidence is clamped to 2', () => {
  assert.equal(clampByClass(4, 'attested'), 2);
  assert.equal(clampByClass(3, 'attested'), 2);
  assert.equal(clampByClass(1, 'attested'), 1);
  assert.equal(clampByClass(4, 'inspected'), 4);
  assert.equal(clampByClass(4, 'demonstrated'), 4);
});

test('clampByClass throws loudly on an unrecognised evidence class instead of skipping the cap', () => {
  assert.throws(() => clampByClass(4, 'Attested'), /evidence class/i);
  assert.throws(() => clampByClass(4, 'verified'), /evidence class/i);
  assert.throws(() => clampByClass(4, undefined), /evidence class/i);
});

test('layer score is a percentage of the 4x applicable maximum', () => {
  const entries = [
    { score: 4, class: 'inspected' },
    { score: 2, class: 'inspected' },
  ];
  // (4 + 2) / (4 * 2) * 100 = 75
  assert.deepEqual(layerScore(entries), { score: 75, applicable: 2 });
});

test('N/A probes leave the denominator', () => {
  const entries = [
    { score: 4, class: 'inspected' },
    { score: 'N/A', class: 'inspected', naJustification: 'no serverless components' },
  ];
  // (4) / (4 * 1) * 100 = 100
  assert.deepEqual(layerScore(entries), { score: 100, applicable: 1 });
});

test('N/A without justification throws', () => {
  assert.throws(
    () => layerScore([{ score: 'N/A', class: 'inspected' }]),
    /justification/i,
  );
});

test('a layer with every probe N/A scores null, not NaN', () => {
  const r = layerScore([{ score: 'N/A', class: 'inspected', naJustification: 'n/a' }]);
  assert.equal(r.score, null);
  assert.equal(r.applicable, 0);
});

test('layerScore returns full precision, not pre-rounded to 2dp', () => {
  const entries = [
    { score: 1, class: 'inspected' },
    { score: 1, class: 'inspected' },
    { score: 0, class: 'inspected' },
  ];
  // 2 / (4*3) * 100 = 16.66666...
  const { score } = layerScore(entries);
  assert.ok(Math.abs(score - (200 / 12)) < 1e-9, `expected full-precision 16.6666..., got ${score}`);
  assert.notEqual(score, 16.67, 'layerScore must not pre-round; that compounds error in weightedOverall');
});

test("scoreAudit excludes an all-N/A layer's weight from the denominator instead of coercing its score to zero", () => {
  const card = scoreAudit({
    probes: {
      '1.1': { score: 'N/A', class: 'inspected', naJustification: 'no such surface in this app' },
      '1.2': { score: 'N/A', class: 'inspected', naJustification: 'no such surface in this app' },
      '2.1': { score: 4, class: 'inspected' },
    },
  });
  const layer1 = card.layers.find((l) => l.layer === 1);
  assert.equal(layer1.score, null);
  assert.equal(layer1.applicable, 0);
  // If layer 1's weight (6) were folded into the denominator as a zero-scoring layer,
  // this would come out diluted (1000/16 = 62.5) instead of the correct 100.
  assert.equal(card.weightedOverall, 100);
});

test("weightedOverall divides by the weights actually supplied, not a hardcoded 100", () => {
  const layers = { 1: 100, 2: 50 };
  const weights = { 1: 6, 2: 10 };
  // (100*6 + 50*10) / (6+10) = 1100/16 = 68.75
  assert.equal(weightedOverall(layers, weights), 68.75);
});

test('weightedOverall throws naming the layer(s) a custom weights map omits, instead of returning NaN', () => {
  assert.throws(
    () => weightedOverall({ 1: 100, 8: 0 }, { 1: 100 }),
    /\b8\b/,
  );
});

test('scoreAudit does not silently report a wrong band when a custom weights map is incomplete', () => {
  // Layer 8 has an applicable probe (and fires gate G2) but the supplied weights map
  // only covers layer 1. Previously this produced weightedOverall: NaN, overall: NaN,
  // band: 'Not production-viable' — a plausible-looking wrong answer instead of a loud
  // failure, silently swallowing the fact that G2 should have capped the score at 49.
  assert.throws(
    () => scoreAudit(
      { probes: { '1.1': { score: 4, class: 'inspected' }, '8.1': { score: 0, class: 'inspected' } } },
      { weights: { 1: 100 } },
    ),
    /\b8\b/,
  );
});

test('scoreAudit rounds exactly once for the reported overall — double rounding must not flip the band', () => {
  // Hand-picked probe scores (found by exhaustive random search over the real weights
  // and probe counts, then verified independently) whose true weighted average is
  // 54.99 ("At risk"), but which becomes 55.00 ("Serviceable") if each layer's score is
  // rounded to 2dp before being folded into the weighted average. No gate-bearing probe
  // is scored 0, so this exercises only the rounding path, not the gate cap.
  const layerRawScores = {
    1: [4, 4, 4, 4, 4, 0, 0, 0],
    2: [4, 4, 4, 4, 4, 4, 0, 0],
    3: [4, 4, 4, 4, 0, 3, 0, 0, 0],
    4: [4, 4, 4, 4, 2, 0, 0, 0, 0],
    5: [4, 4, 4, 0, 0, 0, 0],
    6: [4, 4, 4, 4, 4, 0, 0],
    7: [4, 4, 4, 4, 2, 0, 0],
    8: [4, 4, 4, 4, 4, 0, 0, 0, 0],
    9: [4, 4, 4, 2, 0, 0, 0],
    10: [4, 4, 4, 4, 1, 0, 0],
    11: [4, 4, 4, 0, 0, 0, 0],
    12: [4, 4, 4, 4, 0, 0, 0, 0],
    13: [4, 4, 3, 0, 0, 0, 0, 0],
  };
  const probes = {};
  for (const [layer, scores] of Object.entries(layerRawScores)) {
    scores.forEach((score, i) => { probes[`${layer}.${i + 1}`] = { score, class: 'inspected' }; });
  }

  const card = scoreAudit({ probes });
  assert.deepEqual(card.gates, [], 'no gate should fire in this fixture');
  assert.equal(card.weightedOverall, 54.99);
  assert.equal(card.band, 'At risk');
});

test('gates fire only at score 0 on their marked probe', () => {
  const gates = firedGates({
    '8.1': { score: 0, class: 'inspected' },
    '8.3': { score: 1, class: 'inspected' },
    '9.1': { score: 0, class: 'inspected' },
  });
  const names = gates.map((g) => g.gate).sort();
  assert.deepEqual(names, ['G2', 'G7']);
  assert.deepEqual(gates.find((g) => g.gate === 'G2').probes, ['8.1']);
});

test('two probes firing the same gate report it once with both probes', () => {
  const gates = firedGates({
    '3.6': { score: 0, class: 'attested' },
    '13.2': { score: 0, class: 'attested' },
  });
  assert.equal(gates.length, 1);
  assert.equal(gates[0].gate, 'G1');
  assert.deepEqual(gates[0].probes, ['3.6', '13.2']);
});

test('a gate-bearing probe scored N/A with justification does not fire its gate', () => {
  const gates = firedGates({
    '8.1': { score: 'N/A', class: 'inspected', naJustification: 'no client-reachable tables in this deployment' },
  });
  assert.deepEqual(gates, []);
});

test('band boundaries', () => {
  assert.equal(band(85), 'Production-hardened');
  assert.equal(band(84.9), 'Production-ready');
  assert.equal(band(70), 'Production-ready');
  assert.equal(band(69.9), 'Serviceable');
  assert.equal(band(55), 'Serviceable');
  assert.equal(band(54.9), 'At risk');
  assert.equal(band(40), 'At risk');
  assert.equal(band(39.9), 'Not production-viable');
});

test('a fired gate caps the overall at 49 however high the weighted average', () => {
  const probes = {};
  // every probe perfect except 8.1, which fires G2
  for (const [layer, count] of Object.entries({ 1: 8, 2: 8, 3: 9, 4: 9, 5: 7, 6: 7, 7: 7, 8: 9, 9: 7, 10: 7, 11: 7, 12: 8, 13: 8 })) {
    for (let i = 1; i <= count; i++) probes[`${layer}.${i}`] = { score: 4, class: 'inspected' };
  }
  probes['8.1'] = { score: 0, class: 'inspected' };

  const card = scoreAudit({ probes });
  assert.ok(card.weightedOverall > 90, 'weighted average should be high');
  assert.equal(card.overall, 49, 'gate must cap the reported overall');
  assert.equal(card.band, 'At risk');
  assert.deepEqual(card.gates.map((g) => g.gate), ['G2']);
});

test('scoreAudit applies the attested clamp before computing layer scores', () => {
  const probes = { '9.1': { score: 4, class: 'attested' } };
  const card = scoreAudit({ probes });
  assert.equal(card.probes['9.1'].effectiveScore, 2);
  assert.equal(card.probes['9.1'].clamped, true);
});

test('scoreAudit collects unverified probe IDs', () => {
  const card = scoreAudit({
    probes: {
      '3.6': { score: 2, class: 'attested', unverified: true },
      '5.3': { score: 3, class: 'inspected' },
    },
  });
  assert.deepEqual(card.unverified, ['3.6']);
});

test('unverified probe IDs are sorted numerically by layer then probe, not lexicographically', () => {
  const card = scoreAudit({
    probes: {
      '13.2': { score: 2, class: 'attested', unverified: true },
      '2.1': { score: 2, class: 'attested', unverified: true },
      '9.1': { score: 2, class: 'attested', unverified: true },
    },
  });
  // A bare string .sort() would put '13.2' before '2.1' before '9.1'.
  assert.deepEqual(card.unverified, ['2.1', '9.1', '13.2']);
});

test('custom weights override the defaults', () => {
  const card = scoreAudit(
    { probes: { '1.1': { score: 4, class: 'inspected' }, '2.1': { score: 0, class: 'inspected' } } },
    { weights: { ...WEIGHTS, 1: 90, 2: 10 } },
  );
  // layer1=100 w90, layer2=0 w10 → 9000/100 = 90
  assert.equal(card.weightedOverall, 90);
});

test('every gate-bearing probe ID is a real probe ID', () => {
  const counts = { 1: 8, 2: 8, 3: 9, 4: 9, 5: 7, 6: 7, 7: 7, 8: 9, 9: 7, 10: 7, 11: 7, 12: 8, 13: 8 };
  for (const id of Object.keys(GATE_PROBES)) {
    const [l, p] = id.split('.').map(Number);
    assert.ok(counts[l] >= p, `${id} exceeds layer ${l} probe count`);
  }
});
