---
name: appsotech-design
description: >
  Design and build user interfaces against a frozen, accessibility-gated design
  system — style direction, palette, font pairing, design tokens, light and dark
  mode, responsive layout, motion, hero treatments, and a mechanical gate that
  checks the result in a real browser. Use when building, designing, styling,
  restyling or laying out any UI: a screen, page, dashboard, landing page, hero,
  form, component, admin panel, mobile screen, or a single-file HTML prototype.
  Fires on "build me a screen", "make a prototype", "put a UI on this", "make it
  look good", "pick a palette", "add dark mode" and "make it responsive" — not
  only on the word "design". Stack-agnostic: it works on React, Next.js, Vue,
  Svelte, Flutter, plain HTML or a single file.
---

# Appsotech design

Style, tokens, patterns and the gate. This skill decides **how a thing looks**
and proves it meets the floor. It does not care what the thing is built with.

`appsotech-dev` handles wiring — surfaces, ports, API, deploy — and delegates
every decision below to this file. Loading either one is enough; loading the
stack pulls this in by path.

## Design authority

Two sources, and they do not overlap: **pro-max generates, elite verifies.**
pro-max proposes taste; elite owns structure and the accessibility floor and
has the last word.

| Decision | Authority |
|---|---|
| Style direction, palette values, font pairing | **pro-max**, filtered through elite |
| Token architecture and naming (`--background`, `--primary`, dark mode) | **elite** — pro-max supplies values *into* this scheme |
| Type scale, line-height, 45–75ch measure, max 2–3 typefaces | **elite** |
| Spacing scale and section rhythm | **elite** |
| Motion — whether to animate at all, duration, easing, gestures | **elite's constraints + `references/motion.md`'s craft bar** — pro-max's GSAP presets are filtered through both |
| Hero treatment — particles, 3D, image or type alone, and its budget | **`references/hero.md`** — the only place decorative motion and 3D are allowed |
| Accessibility floor — 4.5:1 text, 3:1 focus ring, 44×44px targets, labelled inputs | **elite, non-negotiable** |
| Responsive across mobile, tablet and desktop | **elite, non-negotiable** |
| Light *and* dark mode on every surface | **elite, non-negotiable** |

"Filtered through elite" means three vetoes applied before anything is frozen:
pro-max palettes are **not** contrast-safe and are checked; Inter, Roboto and
Arial are never display faces whatever pro-max returns; GSAP presets that
animate layout properties are rewritten or dropped. A style choice never wins
against the accessibility floor — if a palette cannot meet 4.5:1, the palette
changes.

## The frozen design rule

**If `design/design-system.md` exists, read it and use it. Do not re-run
selection.**

Sessions start fresh and remote: nothing outside the repository survives.
Re-running selection means pro-max reasons from scratch and returns a different
palette and different fonts for the same repo — a product with a new aesthetic
every Tuesday.

Re-selection happens **only** when the user asks in so many words ("restyle",
"pick a new palette"). Never inferred from "make this look better", never
triggered by a new surface or a new page.

| File | Role | Changes when |
|---|---|---|
| `design/design-system.md` | Master — style, palette, fonts, hero form, rationale | explicit re-selection only |
| `design/tokens.css` | The tokens, elite's naming | regenerated from the Master |
| `<flutter-package>/lib/design/tokens.dart` | Same values for Flutter, **generated** | `node "$TOKENSDART"` — never by hand |
| `design/overrides.md` | Per-surface deviations | normal work |

Tokens are **per product, not per surface**. Two surfaces of one product share
one system, or the product looks like two products.

## Paths

Two roots, and confusing them breaks the gate. **`design/…`, `apps/…`, `src/…`**
are relative to the **target project**. **`scripts/…` and `references/…`** are
relative to **this skill's own directory**.

The working directory during a run is the target project, so a bare
`node scripts/contrast.mjs` never resolves. Resolve once, up front:

```bash
for base in \
  "$CLAUDE_PLUGIN_ROOT/skills/appsotech-design/scripts" \
  "$HOME/.claude/skills/appsotech-design/scripts" \
  ".claude/skills/appsotech-design/scripts"; do
  [ -f "$base/contrast.mjs" ] && SCRIPTS="$base" && break
done
GATE="$SCRIPTS/gate.mjs"
CONTRAST="$SCRIPTS/contrast.mjs"
AUDIT="$SCRIPTS/audit-markup.mjs"
RESPONSIVE="$SCRIPTS/responsive-check.mjs"
TOKENSDART="$SCRIPTS/tokens-dart.mjs"
FREEZE="$SCRIPTS/freeze-check.mjs"
CONSISTENCY="$SCRIPTS/consistency.mjs"
echo "${SCRIPTS:-NOT FOUND}"
```

If it did not resolve, say so and fall back to checking by hand against
`references/design-tokens.md` and `references/design-gate.md` — do not skip the
checks silently.

---

## Phase 0 — What kind of design work is this?

| The request | Route |
|---|---|
| A product with no design system yet | **Every phase, 1 → 4** |
| A screen or component in a product that has one | **Skip 1–2.** Read `design/design-system.md` **and** `references/archetypes.md`, build, gate. |
| A standalone mockup or single-file prototype | **Skip 1–2 if a system exists**, otherwise select quickly and put the tokens in the file itself |
| "Restyle it", "pick a new palette" | **Phase 1**, and only when asked in those words |

The second row is the common one and the one most often got wrong. A new page
is not a reason to re-select anything.

## Phase 1 — Select

**Skip entirely if `design/design-system.md` exists.** Read it and go to
Phase 2.

Resolve the design engine (below), then read `references/design-phase.md`. It
carries the questions to answer before querying anything — who uses this, what
single action they should take, and what one thing they will remember — plus
the exact query forms.

Ask for four things in order: **product type**, **style direction**,
**palette**, **font pairing**. Selection happens **before any markup exists**;
choosing a palette after the components are built is where hardcoded hex comes
from.

### Resolving the design engine

Guard on Python — pro-max is a Python script:

```bash
python3 --version || echo "NO PYTHON"

for p in \
  ".claude/skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/plugins/"*"/ui-ux-pro-max/.claude/skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/skills/ui-ux-pro-max/scripts/search.py"; do
  [ -f "$p" ] && SEARCH="$p" && break
done
```

`$CLAUDE_PLUGIN_ROOT` is deliberately absent from that list: it resolves to
*this* plugin, never pro-max's, so it can only produce a false negative.

| Tier | Condition | Action |
|---|---|---|
| 1 | Script found | Query it with `--json`. Deterministic, preferred. |
| 2 | Not found, skill installed | Invoke `ui-ux-pro-max` by name; ask for style, palette, font pairing. |
| 3 | Neither, or no Python | Read `references/style-directions.md`, proceed, and **tell the user** the engine was unavailable. |

**Tier 3 is the default operating mode, not the exception.** Remote and
headless sessions — the normal case — rarely have pro-max installed, so
`style-directions.md` is the working aesthetic engine most of the time, and it
is written to that standard: triples ready to paste, candidates per sector, a
suite-uniqueness rule. Treat tiers 1–2 as the upgrade when available, not the
baseline.

**Never fail the build over this.** Only style *breadth* degrades — 84 styles
down to 12 curated directions. Tokens, the accessibility floor, the patterns
and the gate are vendored and identical in all three tiers.

## Phase 2 — Freeze

Read `references/design-tokens.md`, then write:

- `design/tokens.css` — pro-max's values in **elite's naming scheme**, light
  and dark blocks, both required
- `design/design-system.md` — style, palette, fonts and *why*, so the next
  session inherits the reasoning and not just the values. If the product has
  public surfaces, this is also where the **hero form** is recorded — the one
  abstract shape derived from what the product does, per `references/hero.md`.
  Unrecorded, the next session invents a different one, which is the palette
  drift problem wearing a different hat.
- The Flutter copy, **only if there is a Flutter surface**, and never by hand:

  ```
  node "$TOKENSDART" design/tokens.css -o <package>/lib/design/tokens.dart
  ```

  It lives inside the Flutter package because Dart resolves library code
  relative to `lib/` — a file at the repository root is not importable. The
  `design/` segment in the path is also what keeps the markup audit's
  hardcoded-colour rule off it, which is right: this is the one place raw
  colour belongs on the Flutter side.

Then gate it before committing:

```
node "$CONTRAST" design/tokens.css
```

Non-zero exit means a pair is below the floor. **Fix the token and re-run.**
Catching this here costs one token; catching it at the gate costs an audit of
every component that consumed it.

Then record the freeze, which is what makes the frozen design rule checkable
rather than merely stated:

```
node "$FREEZE" design/tokens.css design/design-system.md --record
```

That fingerprints the palette into `design-system.md`, so the gate can ask one
question every run: does `tokens.css` still hold the palette this document
describes? A silent edit otherwise leaves the rationale explaining colours that
are gone. **Re-record only alongside a restyle the user asked for** — never to
turn a red gate green.

**No palette values inline in markup, ever.**

## Phase 3 — Build

| Reference | When |
|---|---|
| `references/archetypes.md` | the surface is one of the eight recurring page types — auth, hero, dashboard, list, detail, form, settings, states — read **before** laying anything out |
| `references/patterns-web.md` | a dashboard, landing page or Tailwind/React component |
| `references/patterns-mobile.md` | Flutter — `ThemeData`, light/dark, responsive |
| `references/motion.md` | anything animates — and *before* adding motion, since its first rule is whether to animate at all |
| `references/hero.md` | a hero section — particles, 3D, a full-screen treatment or a hero image |

The archetypes are why a sign-in page comes out as a 50/50 split and a hero
comes out on the dark token scope **without being asked** — those are the
defaults, and departing from one is recorded in `design/overrides.md`.

Three rules apply to everything built here:

- **No component names a raw colour.** It is broken in dark mode and nobody
  finds out until they look.
- **Ask whether it should animate before animating it.** A keyboard-initiated
  action seen 100+ times a day gets no animation at all — see `motion.md`.
- **A canvas belongs in a hero on a public surface, or nowhere.** Never behind
  auth, and never as the LCP element — see `hero.md`.

## Phase 4 — Gate

Do not report anything as designed on the strength of having written it.

```
node "$GATE" --serve <build-dir>
```

It discovers `design/` and every `apps/*/src` by convention; pass `--src`,
`--tokens`, `--system`, `--dart` or `--domain` when the project is laid out
differently. Only a rendered target needs naming — `--serve` for a static
build, `--url` for a server that is already running.

**A step it could not run reports `SKIP`, and a gap fails the gate** — pass
`--allow-skip` only to acknowledge a gap you have checked by hand. A true
absence (no Flutter package at all) reports `N/A` and never fails; the two are
kept apart because seven Flutter apps once drifted for months behind a skip
that read like an absence. A partial run reported as a clean one is worse than
no gate, because it gets believed.

Then walk `references/design-gate.md` end to end. The scripts cover the items
marked `[auto]`; the rest are judgement calls — whether the tablet layout is
designed or merely fits, whether dark mode was designed or inverted, whether
the memorable element survived into the code.

**Then look at it.** Screenshot every surface at 1440×900 in **both themes**
— `responsive-check` writes these already unless `--no-shots` — and read the
images back before reporting. The scripts prove the floor; only looking proves
the design. In the audit behind this rule, a four-way accent divergence, a
70%-empty sign-in page and a forked product still shipping its parent's
marketing copy were all invisible to the scripts and obvious in the
screenshots. If a screenshot cannot be produced, say so — never report a
surface as designed on the strength of a green gate.

Report what passed, what failed with its output, and what did not run.

## No filesystem — the chat case

No repository, no shell, no persistence.

| Phase | In chat |
|---|---|
| 1 | No Python, so **tier 3 by definition**. Use `references/style-directions.md` and say the range was the twelve. |
| 2 | Nothing to write to. Put the `:root` and `.dark` blocks **at the top of the artefact**, and paste the summary into the reply so the user can commit it. |
| 4 | The scripts cannot run. Walk the checklist by hand — the palettes in `style-directions.md` are pre-verified so the numbers need not be recomputed. |

**The frozen design rule still applies, with the user as the store.** Ask
whether a palette already exists before selecting. A user who pastes their
tokens in has frozen them, and re-selecting over the top is the same drift
arriving by a different route.

Never invent a palette when `style-directions.md` covers the case.

## Projects that are not on the house stack

Everything above is stack-agnostic except the default paths. `design/` at the
project root is a convention, not a requirement — every script takes a flag.
The one thing that does not bend is the token naming scheme: pro-max's values
are mapped into elite's names, because the contrast gate, the markup audit and
the Flutter generator all key off them.

## Attribution

`references/design-tokens.md`, `patterns-web.md`, `design-gate.md` and the
direction list in `style-directions.md` are vendored from the
**elite-frontend-ux** skill and reorganised by phase. `references/motion.md` is
distilled from **emilkowalski/skills**, MIT © Emil Kowalski,
github.com/emilkowalski/skills. `ui-ux-pro-max` is *not* vendored — it is
queried where installed, and is MIT licensed, © Next Level Builder,
github.com/nextlevelbuilder/ui-ux-pro-max-skill.
