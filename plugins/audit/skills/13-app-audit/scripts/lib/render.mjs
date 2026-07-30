import { GATE_CAP, compareProbeIds, round2 } from './scoring.mjs';

function scopeField(scope, key, fallback = '(unspecified)') {
  const v = scope?.[key];
  return v === undefined || v === null || v === '' ? fallback : v;
}

function gateProbeLabel(probes) {
  return probes.length === 1 ? `probe ${probes[0]}` : `probes ${probes.join(', ')}`;
}

// The cover is the only section a reader may see; it must never contain the literal
// substring "## " (renderScorecard's callers, and the test suite, split on it to isolate
// the cover from the rest of the document — see the "not buried" test).
function renderCover(card) {
  const { scope, overall, band, gates, weightedOverall, coverage } = card;
  const lines = ['# Audit Scorecard', ''];

  lines.push(`- **System:** ${scopeField(scope, 'system')}`);
  lines.push(`- **Ref:** ${scopeField(scope, 'ref')}`);
  lines.push(`- **Environment:** ${scopeField(scope, 'environment')}`);
  lines.push(`- **Date:** ${scopeField(scope, 'date')}`);
  lines.push(`- **Auditor:** ${scopeField(scope, 'auditor')}`);
  if (coverage) {
    lines.push(
      `- **Coverage:** ${coverage.scored}/${coverage.expected} probes · ` +
      `${coverage.layersScored}/${coverage.layersExpected} layers`,
    );
  }
  lines.push(`- **Overall:** ${overall === null ? 'not scored (no probes evaluated)' : overall}`);
  // A partial audit reports no band. The weighted number renormalises over the
  // layers that are present, so four layers scored well read as 100 —
  // "Production-hardened" off a third of the rubric is a claim nobody can
  // stand behind, and the cover is the line that reaches a client.
  lines.push(
    `- **Band:** ${
      band === null
        ? coverage && !coverage.complete
          ? 'PARTIAL AUDIT — no band. Not a verdict.'
          : 'n/a'
        : band
    }`,
  );
  lines.push('');

  if (coverage && !coverage.complete) {
    lines.push(
      `**This audit is incomplete.** ${coverage.scored} of ${coverage.expected} probes were ` +
      'scored, and the overall above is a weighted average of only the layers present — ' +
      'it is not comparable to a complete audit and must not be reported as one.',
    );
    lines.push('');
    if (coverage.missingLayers.length > 0) {
      lines.push(`- Layers with nothing scored: ${coverage.missingLayers.join(', ')}`);
    }
    if (coverage.incompleteLayers.length > 0) {
      lines.push(
        '- Partially scored layers: ' +
        coverage.incompleteLayers.map((l) => `${l.layer} (${l.got}/${l.expected})`).join(', '),
      );
    }
    lines.push('');
  }

  if (gates.length === 0) {
    lines.push('No hard gates triggered.');
  } else {
    lines.push('**Hard gates triggered:**');
    lines.push('');
    for (const g of gates) {
      lines.push(`- **${g.gate}** — ${g.text} (${gateProbeLabel(g.probes)})`);
    }
    lines.push('');
    // A gate firing does not always mean the cap actually moved the number: if the honest
    // weighted average was already at or below GATE_CAP, `overall` equals `weightedOverall`
    // and nothing was capped. Only claim "capped at 49" when it is literally true, but always
    // surface the uncapped weighted average so a reader who stops at the cover still learns
    // whether a stack scoring above 90 is being reported as 49 (or not).
    if (weightedOverall !== null && overall !== weightedOverall) {
      lines.push(`Overall capped at ${GATE_CAP} by hard gate(s). Uncapped weighted average: ${weightedOverall}.`);
    } else {
      lines.push(
        `Hard gate(s) triggered; the weighted average (${weightedOverall}) was already at or below the ` +
        `${GATE_CAP} cap, so the reported overall was not reduced by capping.`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderScorecardTable(card) {
  const rows = card.layers.map((l) => {
    const score = l.score === null ? 'N/A' : l.score;
    // "Applicable" carries applicable/expected rather than a bare count so a partial audit
    // (probes not yet collected for a layer) is visible directly in the scorecard table.
    return `| ${l.layer} | ${l.name} | ${l.weight} | ${l.applicable}/${l.expected} | ${score} |`;
  });
  return [
    '## Scorecard',
    '',
    '| Layer | Name | Weight | Applicable | Score |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function renderUnverified(card) {
  if (card.unverified.length === 0) return '';
  const rows = card.unverified.map((id) => {
    const p = card.probes[id];
    const note = p?.note ?? '';
    // Report each probe's own actual (post-clamp) score rather than asserting a fixed
    // number in prose: "attested" caps a probe at 2, it does not set it to 2. A probe with
    // no supporting evidence at all is 0 per the maturity scale ("no evidence the concern
    // is addressed at all"), and printing "held at 2" for a row that is actually 0 tells a
    // reader "Defined" when the truth is "Absent" — on the one table whose entire purpose
    // is showing how much of the audit is measurement versus silence.
    const score = p?.effectiveScore ?? p?.score ?? '';
    return `| ${id} | UNVERIFIED | ${score} | ${note} |`;
  });
  return [
    '## Unverified probes',
    '',
    'These probes could not be evidenced. The Score column is each probe\'s own actual, ' +
      'already-clamped value — an evidence-class ceiling of 2, not a floor or a default; an ' +
      'unevidenced probe is commonly 0 ("no evidence the concern is addressed at all" per the ' +
      'maturity scale), not 2. The overall is a floor, not a measurement.',
    '',
    '| ID | Status | Score | Note |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function renderCapped(card) {
  const clampedIds = Object.entries(card.probes)
    .filter(([, p]) => p.clamped === true)
    .map(([id]) => id)
    .sort(compareProbeIds);
  if (clampedIds.length === 0) return '';
  const rows = clampedIds.map((id) => {
    const p = card.probes[id];
    return `| ${id} | ${p.score} | ${p.effectiveScore} | ${p.class} |`;
  });
  return [
    '## Capped by evidence class',
    '',
    '| Probe | Claimed | Effective | Evidence class |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

export function renderScorecard(card) {
  const sections = [renderCover(card), renderScorecardTable(card)];
  const unverified = renderUnverified(card);
  if (unverified) sections.push(unverified);
  const capped = renderCapped(card);
  if (capped) sections.push(capped);
  return sections.join('\n');
}

function layerMap(card) {
  return new Map(card.layers.map((l) => [l.layer, l]));
}

function formatDelta(before, after) {
  if (before === null || after === null) return '—';
  const delta = round2(after - before);
  if (delta === 0) return '0';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function renderMovementTable(card, baseline) {
  const curr = layerMap(card);
  const prev = layerMap(baseline);
  const layers = [...new Set([...curr.keys(), ...prev.keys()])].sort((a, b) => a - b);
  const rows = layers.map((layer) => {
    const c = curr.get(layer);
    const p = prev.get(layer);
    const name = c?.name ?? p?.name ?? '';
    const beforeScore = p?.score ?? null;
    const afterScore = c?.score ?? null;
    const beforeText = beforeScore === null ? 'N/A' : beforeScore;
    const afterText = afterScore === null ? 'N/A' : afterScore;
    return `| ${layer} | ${name} | ${beforeText} | ${afterText} | ${formatDelta(beforeScore, afterScore)} |`;
  });
  return [
    '| Layer | Name | Before | After | Δ |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function gateMap(card) {
  return new Map(card.gates.map((g) => [g.gate, g]));
}

function renderGateMovement(card, baseline) {
  const before = gateMap(baseline);
  const after = gateMap(card);
  const closed = [...before.keys()].filter((g) => !after.has(g)).sort();
  const opened = [...after.keys()].filter((g) => !before.has(g)).sort();

  const lines = ['### Gates closed since baseline', ''];
  if (closed.length === 0) {
    lines.push('None.');
  } else {
    for (const g of closed) lines.push(`- **${g}** — closed (${before.get(g).text})`);
  }
  lines.push('', '### Gates opened since baseline', '');
  if (opened.length === 0) {
    lines.push('None.');
  } else {
    for (const g of opened) lines.push(`- **${g}** — opened (${after.get(g).text})`);
  }
  return lines.join('\n');
}

export function renderBaselineDiff(card, baseline) {
  const baselineDate = scopeField(baseline.scope, 'date', 'previous audit');
  return [
    `## Movement since ${baselineDate}`,
    '',
    renderMovementTable(card, baseline),
    '',
    renderGateMovement(card, baseline),
    '',
  ].join('\n');
}
