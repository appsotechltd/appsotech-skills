import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAudit } from '../scripts/lib/scoring.mjs';
import { renderScorecard, renderBaselineDiff } from '../scripts/lib/render.mjs';

const clean = { probes: { '1.1': { score: 4, class: 'inspected' }, '9.1': { score: 3, class: 'inspected' } } };
const gated = { probes: { '1.1': { score: 4, class: 'inspected' }, '9.1': { score: 0, class: 'inspected' } } };

test('a triggered gate is stated on the cover, not buried', () => {
  const md = renderScorecard(scoreAudit(gated));
  const cover = md.split('## ')[0];
  assert.match(cover, /G7/);
  assert.match(cover, /rate limiting on authentication/i);
  assert.match(cover, /49/);
});

test('a clean run says no gates triggered', () => {
  const md = renderScorecard(scoreAudit(clean));
  assert.match(md, /No hard gates triggered/i);
});

test('the scorecard lists every scored layer with weight and score', () => {
  const md = renderScorecard(scoreAudit(clean));
  // Layer 1: one applicable probe scored 4/4 -> 100, weight 6. Layer 9: 3/4 -> 75, weight 5.
  // Assert weight and score co-occur with the layer name in one table row, not merely that
  // the name appears somewhere in the document.
  assert.match(md, /\|\s*1\s*\|\s*Front-end foundations\s*\|\s*6\s*\|[^|]*\|\s*100\s*\|/);
  assert.match(md, /\|\s*9\s*\|\s*Rate limiting\s*\|\s*5\s*\|[^|]*\|\s*75\s*\|/);
});

test('unverified probes are surfaced with a warning', () => {
  const card = scoreAudit({ probes: { '3.6': { score: 2, class: 'attested', unverified: true } } });
  const md = renderScorecard(card);
  assert.match(md, /UNVERIFIED/);
  // The ID and the UNVERIFIED marker must land in the same row, not merely both appear
  // somewhere in the document.
  assert.match(md, /\|\s*3\.6\s*\|\s*UNVERIFIED\s*\|/);
});

test('unverified table reports each probe\'s real score, not a hardcoded "held at 2" claim', () => {
  // Regression test for a real defect (Task 9 dogfood run, 2026-07-29): the renderer used
  // to print "these probes ... are held at 2" unconditionally, which was false for any
  // unverified probe not actually scored 2 — 3.6 here is unevidenced and correctly 0.
  const card = scoreAudit({
    probes: {
      '3.6': { score: 0, class: 'attested', unverified: true },
      '5.7': { score: 2, class: 'attested', unverified: true },
    },
  });
  const md = renderScorecard(card);
  assert.doesNotMatch(md, /held at 2/i);
  // Each row must show its own real (clamped) score next to its ID and UNVERIFIED marker —
  // not merely appear somewhere in the document, and not imply every row shares one value.
  assert.match(md, /\|\s*3\.6\s*\|\s*UNVERIFIED\s*\|\s*0\s*\|/);
  assert.match(md, /\|\s*5\.7\s*\|\s*UNVERIFIED\s*\|\s*2\s*\|/);
});

test('clamped probes are flagged so a reader can see the cap bite', () => {
  const card = scoreAudit({ probes: { '5.3': { score: 4, class: 'attested' } } });
  const md = renderScorecard(card);
  assert.match(md, /capped/i);
  // The probe ID, claimed score (4) and effective score (2) must appear together in one
  // table row, in that order — not just as three substrings scattered anywhere in the
  // document, which a wrong-column-order or wrong-value renderer could still satisfy.
  assert.match(md, /\|\s*5\.3\s*\|\s*4\s*\|\s*2\s*\|\s*attested\s*\|/);
});

test('baseline diff reports per-layer movement with direction', () => {
  const before = scoreAudit({ probes: { '1.1': { score: 1, class: 'inspected' } } });
  const after = scoreAudit({ probes: { '1.1': { score: 3, class: 'inspected' } } });
  const md = renderBaselineDiff(after, before);
  // Before (25), after (75) and the signed delta (+50) must appear together in layer 1's
  // row, not merely "+50" appearing somewhere in the document.
  assert.match(md, /\|\s*1\s*\|[^|]*\|\s*25\s*\|\s*75\s*\|\s*\+50\s*\|/);
});

test('baseline diff names gates that closed and gates that opened', () => {
  const before = scoreAudit(gated);
  const after = scoreAudit(clean);
  const md = renderBaselineDiff(after, before);
  // G7 must be named on the same line as "closed", not merely present somewhere in the
  // document alongside an unrelated "closed" heading.
  assert.match(md, /\*\*G7\*\*.*closed/i);
});

test('cover states the literal cap sentence and the uncapped average when the cap actually bites', () => {
  // gated: weighted average 54.55 (well above 49), one gate fires -> overall capped to 49.
  const card = scoreAudit(gated);
  assert.equal(card.overall, 49);
  assert.equal(card.weightedOverall, 54.55);
  const md = renderScorecard(card);
  const cover = md.split('## ')[0];
  assert.match(cover, /Overall capped at 49 by hard gate\(s\)\./);
  assert.match(cover, /54\.55/);
});

test('cover does not claim a cap bit when a gate fires but the average was already at or below 49', () => {
  // A single gate-bearing probe scored 0 is both the only probe and the only layer, so the
  // honest weighted average is 0 — already below the 49 cap before any capping logic runs.
  const lowAndGated = { probes: { '9.1': { score: 0, class: 'inspected' } } };
  const card = scoreAudit(lowAndGated);
  assert.equal(card.overall, card.weightedOverall, 'fixture must exercise the not-actually-capped branch');
  const md = renderScorecard(card);
  const cover = md.split('## ')[0];
  assert.match(cover, /G7/);
  assert.match(cover, /triggered/i);
  // This is the regression this test exists to catch: a renderer that always prints the
  // "capped at 49" sentence whenever a gate fires, even when the number wasn't moved.
  assert.doesNotMatch(cover, /Overall capped at 49/i);
});
