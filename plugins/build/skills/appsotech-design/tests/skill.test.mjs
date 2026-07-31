import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// The skill's prose is load-bearing: the frontmatter drives triggering, the
// reference table drives what gets read, and the paths block drives what gets
// run. None of that is executed by the test suite unless something asserts it,
// and every failure mode below was first found by hand in this repo — stale
// phase headers left over from vendoring, a description that could silently
// break triggering, scripts documentation forgot to wire up.

const ROOT = join(import.meta.dirname, '..');
const SKILL = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');

// The design skill's phases run 0–4. Anything higher is another skill's
// numbering leaking in — which is exactly what the vendored reference headers
// did (Phase 5, Phase 9) until they were renumbered by hand.
const MAX_PHASE = 4;

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must open with a --- frontmatter block');
  const fm = m[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const descBlock = fm.match(/^description:\s*>\s*\n((?:[ ]{2}.*\n?)+)/m)?.[1]
    ?? fm.match(/^description:\s*(.+)$/m)?.[1];
  const description = descBlock
    ? descBlock.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
    : null;
  return { name, description };
}

// --- frontmatter ------------------------------------------------------------

test('the frontmatter name is well-formed and matches the folder', () => {
  const { name } = frontmatter(SKILL);
  assert.equal(name, basename(ROOT),
    'a name that differs from the folder breaks copy-install resolution');
  assert.match(name, /^[a-z][a-z0-9-]*$/, 'lowercase and hyphens only');
  assert.ok(name.length <= 64, 'skill names are capped at 64 characters');
});

test('the description exists, fits the loader cap, and sells the triggers', () => {
  const { description } = frontmatter(SKILL);
  assert.ok(description && description.length > 100,
    'the description is what triggering matches against — a stub kills the skill silently');
  assert.ok(description.length <= 1024,
    `descriptions are capped at 1024 characters; this one is ${description.length}`);
  // The deliberate design decisions of this description, pinned so an edit
  // that drops them is a conscious one: it must fire on bare UI requests, and
  // it must say it is not tied to the house stack.
  for (const phrase of ['build me a screen', 'dark mode', 'Stack-agnostic']) {
    assert.ok(description.includes(phrase), `description lost: "${phrase}"`);
  }
});

// --- the prose agrees with the filesystem ------------------------------------

function citedReferences(text) {
  return [...text.matchAll(/`?(?:\$DESIGN\/)?references\/([a-z-]+\.md)`?/g)]
    .map((m) => m[1]);
}

test('every reference SKILL.md cites exists on disk', () => {
  for (const f of new Set(citedReferences(SKILL))) {
    assert.ok(existsSync(join(ROOT, 'references', f)),
      `SKILL.md cites references/${f}, which does not exist`);
  }
});

test('every reference on disk is cited by SKILL.md', () => {
  // An orphaned reference is dead weight: nothing routes a reader to it, so
  // it silently stops being true and nobody notices.
  const cited = new Set(citedReferences(SKILL));
  for (const f of readdirSync(join(ROOT, 'references'))) {
    assert.ok(cited.has(f), `references/${f} is never cited by SKILL.md`);
  }
});

test('every script on disk is wired into the SKILL.md paths block', () => {
  for (const f of readdirSync(join(ROOT, 'scripts'))) {
    assert.ok(SKILL.includes(f),
      `scripts/${f} exists but SKILL.md never names it — nothing will run it`);
  }
});

test('cross-references between reference files all resolve', () => {
  // Backticked .md names in a reference are either sibling references or
  // project artefacts the skill writes (design-system.md, overrides.md,
  // domain.md). The artefacts live in the target project, not here, so they
  // are excluded by name — everything else must exist beside the citer, which
  // is what catches a typo'd or renamed reference.
  const PROJECT_ARTEFACTS = new Set(['design-system.md', 'overrides.md', 'domain.md']);
  const dir = join(ROOT, 'references');
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const [, target] of text.matchAll(/`([a-z-]+\.md)`/g)) {
      if (PROJECT_ARTEFACTS.has(target)) continue;
      assert.ok(existsSync(join(dir, target)),
        `${f} cites ${target}, which does not exist beside it`);
    }
  }
});

// --- phase numbering ---------------------------------------------------------

test(`no phase number anywhere exceeds ${MAX_PHASE}`, () => {
  // This is the mechanical version of the renumbering done by hand after the
  // split: the vendored headers said Phase 5 and the hero said Phases 5–7,
  // sending readers to phases this skill does not have.
  const files = [
    ['SKILL.md', SKILL],
    ...readdirSync(join(ROOT, 'references')).map((f) =>
      [`references/${f}`, readFileSync(join(ROOT, 'references', f), 'utf8')]),
    ...readdirSync(join(ROOT, 'scripts')).map((f) =>
      [`scripts/${f}`, readFileSync(join(ROOT, 'scripts', f), 'utf8')]),
  ];
  for (const [name, text] of files) {
    for (const [, n] of text.matchAll(/Phases? (\d+)/g)) {
      assert.ok(Number(n) <= MAX_PHASE,
        `${name} mentions Phase ${n}, but this skill's phases stop at ${MAX_PHASE}`);
    }
  }
});

test('the phase headers in the references match the numbers SKILL.md assigns', () => {
  // Each reference announces which phase it serves; SKILL.md routes readers by
  // phase. If the two disagree, the reader lands in the wrong place while both
  // files look internally consistent.
  const expected = {
    'design-phase.md': 1,
    'design-tokens.md': 2,
    'patterns-web.md': 3,
    'patterns-mobile.md': 3,
    'design-gate.md': 4,
  };
  for (const [f, phase] of Object.entries(expected)) {
    const firstLine = readFileSync(join(ROOT, 'references', f), 'utf8').split('\n')[0];
    assert.match(firstLine, new RegExp(`Phase ${phase}\\b`),
      `${f} header says "${firstLine}" but SKILL.md routes it to Phase ${phase}`);
  }
});

// --- the stack-agnostic claim ------------------------------------------------

test('house-stack surface names appear only as labelled examples', () => {
  // The skill claims to work on any stack. House names are allowed where they
  // are presented as examples of a general rule (hero.md's table, "on the
  // house stack" asides) — never as the rule itself. This pins the fix that
  // lifted them out, by requiring the generalising phrase in any file that
  // still uses the names.
  const dir = join(ROOT, 'references');
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (/platform-web|tenant-web|admin-web|apps\/mobile/.test(text)) {
      assert.ok(/house stack|Appsotech name/.test(text),
        `${f} uses house-stack names without labelling them as examples`);
    }
  }
});
