export const WEIGHTS = { 1: 6, 2: 10, 3: 10, 4: 12, 5: 7, 6: 6, 7: 7, 8: 12, 9: 5, 10: 5, 11: 6, 12: 7, 13: 7 };

export const LAYER_NAMES = {
  1: 'Front-end foundations', 2: 'APIs / back-end logic', 3: 'Database / storage',
  4: 'Auth / permissions', 5: 'Hosting / deployment', 6: 'Cloud / compute', 7: 'CI/CD',
  8: 'Security / row-level security', 9: 'Rate limiting', 10: 'Caching / CDN',
  11: 'Load balancing / scaling', 12: 'Error tracking / logs', 13: 'Availability / recovery',
};

export const LAYER_PROBE_COUNTS = { 1: 8, 2: 8, 3: 9, 4: 9, 5: 7, 6: 7, 7: 7, 8: 9, 9: 7, 10: 7, 11: 7, 12: 8, 13: 8 };

export const GATE_PROBES = {
  '1.4': 'G3', '3.6': 'G1', '4.3': 'G6', '5.3': 'G4', '7.4': 'G3', '8.1': 'G2',
  '8.3': 'G2', '8.4': 'G8', '9.1': 'G7', '12.3': 'G5', '13.2': 'G1',
};

export const GATE_TEXT = {
  G1: 'No restore from backup successfully performed in the last 90 days',
  G2: 'Client-reachable tables holding user data with no row-level security or equivalent server-side authorisation',
  G3: 'Secrets present in version control history, build logs, or client bundles',
  G4: 'No tested rollback path for a production deployment',
  G5: 'Unredacted PII or credentials flowing into logs or the error tracker',
  G6: 'Any administrative account without MFA, or a shared admin credential',
  G7: 'No rate limiting on authentication or password-reset endpoints',
  G8: 'A production dependency with a known critical CVE and no compensating control',
};

export const GATE_CAP = 49;
const ATTESTED_CAP = 2;
const EVIDENCE_CLASSES = new Set(['demonstrated', 'inspected', 'attested']);

export function clampByClass(score, cls) {
  if (!EVIDENCE_CLASSES.has(cls)) {
    throw new Error(
      `clampByClass: unrecognised evidence class ${JSON.stringify(cls)}; expected one of demonstrated, inspected, attested`,
    );
  }
  return cls === 'attested' ? Math.min(score, ATTESTED_CAP) : score;
}

function effective(entry) {
  if (entry.score === 'N/A') return null;
  return clampByClass(entry.score, entry.class);
}

export function layerScore(entries) {
  let sum = 0;
  let applicable = 0;
  for (const e of entries) {
    if (e.score === 'N/A') {
      if (!e.naJustification) throw new Error('N/A requires a justification');
      continue;
    }
    sum += effective(e);
    applicable += 1;
  }
  if (applicable === 0) return { score: null, applicable: 0 };
  // Full precision: this feeds weightedOverall's arithmetic. Round only for display
  // (in scoreAudit's `layers[]` table), never here — rounding twice compounds error
  // by up to ~0.01 per layer, which is enough to flip a reported band at the boundary.
  return { score: (sum / (4 * applicable)) * 100, applicable };
}

export function weightedOverall(layerScores, weights = WEIGHTS) {
  let num = 0;
  let den = 0;
  const missing = [];
  for (const [layer, score] of Object.entries(layerScores)) {
    if (score === null || score === undefined) continue;
    const w = weights[layer];
    if (w === undefined || w === null || Number.isNaN(w)) {
      missing.push(layer);
      continue;
    }
    num += score * w;
    den += w;
  }
  if (missing.length > 0) {
    throw new Error(
      `weightedOverall: weights map is missing a weight for layer(s) with applicable probes: ${missing.join(', ')}`,
    );
  }
  // Single rounding point for the reported overall.
  return den === 0 ? null : round2(num / den);
}

export function firedGates(probes) {
  const byGate = new Map();
  for (const [id, gate] of Object.entries(GATE_PROBES)) {
    const entry = probes[id];
    if (!entry || entry.score !== 0) continue;
    if (!byGate.has(gate)) byGate.set(gate, []);
    byGate.get(gate).push(id);
  }
  return [...byGate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([gate, ids]) => ({ gate, probes: ids, text: GATE_TEXT[gate] }));
}

export function band(overall) {
  if (overall >= 85) return 'Production-hardened';
  if (overall >= 70) return 'Production-ready';
  if (overall >= 55) return 'Serviceable';
  if (overall >= 40) return 'At risk';
  return 'Not production-viable';
}

export function scoreAudit(doc, opts = {}) {
  const weights = opts.weights ?? WEIGHTS;
  const probes = {};
  const grouped = {};

  for (const [id, entry] of Object.entries(doc.probes)) {
    const layer = Number(id.split('.')[0]);
    const eff = effective(entry);
    probes[id] = {
      ...entry,
      effectiveScore: eff,
      clamped: eff !== null && eff !== entry.score,
      gate: GATE_PROBES[id] ?? null,
    };
    (grouped[layer] ??= []).push(entry);
  }

  const layers = [];
  const layerScores = {};
  for (const layer of Object.keys(grouped).map(Number).sort((a, b) => a - b)) {
    const { score, applicable } = layerScore(grouped[layer]);
    layerScores[layer] = score; // full precision — this is what gets weighted
    layers.push({
      layer,
      name: LAYER_NAMES[layer],
      weight: weights[layer],
      applicable,
      expected: LAYER_PROBE_COUNTS[layer],
      score: score === null ? null : round2(score), // rounded once, for display only
    });
  }

  const gates = firedGates(doc.probes);
  const weighted = weightedOverall(layerScores, weights);
  const overall = gates.length > 0 ? Math.min(weighted ?? 0, GATE_CAP) : weighted;

  return {
    scope: doc.scope ?? null,
    probeCount: Object.keys(doc.probes).length,
    layers,
    weightedOverall: weighted,
    overall,
    band: overall === null ? null : band(overall),
    gates,
    unverified: Object.entries(doc.probes)
      .filter(([, e]) => e.unverified)
      .map(([id]) => id)
      .sort(compareProbeIds),
    probes,
  };
}

export function compareProbeIds(a, b) {
  const [layerA, probeA] = a.split('.').map(Number);
  const [layerB, probeB] = b.split('.').map(Number);
  return layerA - layerB || probeA - probeB;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
