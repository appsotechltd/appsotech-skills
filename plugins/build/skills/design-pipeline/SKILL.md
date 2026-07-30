---
name: design-pipeline
description: >
  Design and build user interfaces to a frozen, project-wide design system —
  style, palette, type, tokens, accessibility. Use when asked to build,
  design, style, restyle or lay out any UI: a screen, page, view, dashboard,
  landing page, form, component, admin panel, marketing site, mobile screen,
  or a single-file HTML prototype or mockup. Fires on "build me a screen",
  "make a prototype", "put a UI on this", "make it look good" and
  "pick colours/fonts" — not only the word "design". Also use before writing
  the first line of markup for a new surface, and when reviewing existing UI
  for accessibility or visual consistency.
---

# Design pipeline

Two design authorities, and they do not overlap: **pro-max generates, elite
verifies.** pro-max proposes taste; elite owns structure and the accessibility
floor and has the last word.

| Decision | Authority |
|---|---|
| Style direction | **pro-max**, filtered through elite |
| Palette values | **pro-max**, filtered through elite |
| Font pairing | **pro-max**, filtered through elite |
| Token architecture and naming (`--background`, `--primary`, `--muted-foreground`, dark mode) | **elite** — pro-max supplies values *into* this scheme |
| Type scale, line-height, 45–75ch measure, max 2–3 typefaces | **elite** |
| Spacing scale and section rhythm | **elite** |
| Motion — transform/opacity only, `prefers-reduced-motion` honoured | **elite** — pro-max's GSAP presets are filtered through it |
| Accessibility floor — 4.5:1 text, 3:1 focus ring, 44×44px targets, labelled inputs | **elite, non-negotiable** |
| Responsive across mobile, tablet and desktop | **elite, non-negotiable** |
| Light *and* dark mode on every surface | **elite, non-negotiable** |
| Final sign-off | **elite's pre-delivery checklist**, run last on finished code |

Two requirements hold on every surface this skill touches, and neither is
negotiable against a style choice:

- **Responsive.** Mobile, tablet and desktop each get a designed layout. A
  desktop grid squeezed narrow is not responsive. Tablet (768–1023px) is the
  width most often skipped.
- **Light and dark.** Web *and* Flutter. Driven by tokens, so a component that
  names a raw colour is broken in one mode and nobody finds out until they
  look.

## What "filtered through elite" means

pro-max owns the choice. elite owns the veto. Three filters apply to every
selection before it is frozen:

1. **Contrast.** pro-max palettes are *not* contrast-safe by construction — it
   ships `On X`/`X` pairs that sometimes fail 4.5:1. Check before freezing, not
   at the gate. Phase 3 runs the contrast gate — see **Paths** below.
2. **Fonts.** Inter, Roboto and Arial are never display faces here, whatever
   pro-max returns. Re-query for another pairing.
3. **Motion.** GSAP presets that animate layout properties are rewritten to
   transform/opacity or dropped.

A style choice never wins against the accessibility floor. If a palette cannot
meet 4.5:1, the palette changes — not the requirement.

## The frozen design rule

**If `design/design-system.md` exists, read it and use it. Do not re-run
selection.**

Every session starts fresh and remote: nothing outside the repository
survives. Re-running selection means pro-max reasons from scratch again and
returns a different palette and different fonts for the same repo — a product
with a new aesthetic every Tuesday.

The frozen files are the memory. Re-selection happens **only** when the user
asks for it in so many words ("restyle", "pick a new palette", "start the
design over"). It is never a default, never inferred from "make this look
better", and never triggered by a new surface being added.

| File | Role | Changes when |
|---|---|---|
| `design/design-system.md` | Master — style, palette, fonts, rationale | explicit re-selection only |
| `design/tokens.css` | The tokens themselves, elite's naming | regenerated from the Master |
| `design/overrides.md` | Per-surface deviations and additions | normal work |

Tokens are **per product, not per surface**. `webapp` and `admin-web` share one
system, or the same product looks like two.

## Paths — read this before running anything

Two different roots are in play and confusing them breaks the gate.

- **`design/…`** is relative to the **target project** — the repo being built.
- **`scripts/…` and `references/…`** are relative to **this skill's own
  directory**, wherever it is installed.

The working directory during a run is the target project, so a bare
`node scripts/contrast.mjs` never resolves. Resolve the skill once, at the
start of the run, and use the variable everywhere after:

```bash
for base in \
  "$CLAUDE_PLUGIN_ROOT/skills/design-pipeline/scripts" \
  "$HOME/.claude/skills/design-pipeline/scripts" \
  ".claude/skills/design-pipeline/scripts"; do
  [ -f "$base/contrast.mjs" ] && SCRIPTS="$base" && break
done
CONTRAST="$SCRIPTS/contrast.mjs"
AUDIT="$SCRIPTS/audit-markup.mjs"
echo "${SCRIPTS:-NOT FOUND}"
```

`$CLAUDE_PLUGIN_ROOT` **is** correct here — this is our own plugin. It is only
wrong when hunting for pro-max, which lives in a different plugin.

`$CONTRAST` and `$AUDIT` below mean the paths resolved above. If they did not
resolve, say so and fall back to checking by hand against
`references/design-tokens.md` and `references/design-gate.md` — do not skip the
checks silently.

---

## Phase 1 — Detect the stack

From the project itself. **Never assume a default** — a hardcoded one silently
misroutes every recommendation that follows.

| Signal | pro-max `--stack` |
|---|---|
| `package.json` with `next` | `nextjs` |
| `package.json` with `vite` + `react` | `react` |
| `package.json` with React Native markers | `react-native` |
| `pubspec.yaml` | `flutter` |
| `Package.swift` | `swiftui` |
| `composer.json` | `laravel` |
| Single-file HTML prototype, no manifest | `html-tailwind` |

In a house monorepo the stack is per surface, so detect per surface:
`apps/platform-web` and `apps/tenant-web` are `nextjs`, `apps/webapp` and
`apps/admin-web` are `react`, `apps/mobile` is `flutter`. The design system is
still one per product.

If nothing matches, **ask**. Do not guess.

## Phase 2 — Select

**Skip this phase entirely if `design/design-system.md` exists.** Read it
instead and go to Phase 3.

Resolve the design engine (below), then read `references/design-phase.md`. It
carries the questions to answer before querying anything, and the exact query
forms.

Ask for four things, in this order:

1. **Product type** — `-d product`, for the reasoning rules
2. **Style direction** — `-d style`
3. **Palette** — `-d color`
4. **Font pairing** — `-d typography`

Selection happens **before any markup exists**. Choosing a palette after the
components are built means retrofitting, and retrofitting is where hardcoded
hex values come from.

## Phase 3 — Freeze

Read `references/design-tokens.md`, then write:

- `design/tokens.css` — pro-max's values in **elite's naming scheme**, with the
  dark-mode block. Both blocks are required, always.
- `design/design-system.md` — style, palette, fonts, and *why*, so the next
  session inherits the reasoning and not just the values
- `design/tokens.dart` — **only if the product has a Flutter surface.**
  Generated from `tokens.css`, never hand-maintained beside it: two hand-kept
  copies drift, and the drift shows up as an app that is subtly a different
  product from its own website.

Then run the contrast gate before committing anything:

```
node "$CONTRAST" design/tokens.css
```

It exits non-zero on any pair below its threshold. **Fix the token and re-run —
do not proceed with a failing palette.** Catching this here costs one token;
catching it at Phase 5 costs an audit of every component that consumed it.

Commit both files. **No palette values inline in markup, ever** — a hex code in
a component is a value that will not follow the token when it changes.

## Phase 4 — Build

Use the project's own stack conventions. In a house repo that means
`appsotech-stack`'s references — this skill owns how it *looks*, that one owns
how it is *wired*.

Read `references/patterns-web.md` when the work is a dashboard, a landing page,
or a Tailwind/React component. Read `references/patterns-mobile.md` when the
surface is Flutter. Read both if the feature spans them, and skip both for
anything else.

## Phase 5 — Gate

Two scripts, then the checklist. Run them **before presenting anything**.

```
node "$CONTRAST" design/tokens.css      # the tokens are still compliant
node "$AUDIT" <src-dir>                 # the code actually uses them
```

The second is the one that catches drift. `contrast.mjs` validates the token
file; a component with a hardcoded `#3B82F6` passes it trivially, because the
check never sees the component. `audit-markup.mjs` reads the source and fails
on colours outside `design/`, dynamic Tailwind classes, click handlers on
non-interactive elements, images without `alt`, unlabelled inputs, banned
display faces and focus removed with nothing put back.

It exits 1 on errors, 0 on warnings alone. Use `--warn-only` to survey an
existing codebase without failing, and suppress a genuinely-justified line with
a `design-ok` comment rather than deleting the rule.

Then walk `references/design-gate.md` end to end. It is the last step on
finished code, not a checklist to read at the start and remember — and the
items the scripts cannot check (tablet layout, dark-mode design quality, dark
patterns, the memorable element) are exactly the ones that need a human pass.

Report what failed and what you changed. A gate that always passes silently is
a gate nobody ran.

---

## Resolving the design engine

Guard on Python first — pro-max is a Python script and nothing else works
without it:

```bash
python3 --version || echo "NO PYTHON"
```

Then locate the search script, repo paths first (cloud sessions have no home
directory that survives):

```bash
for p in \
  ".claude/skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/plugins/"*"/ui-ux-pro-max/.claude/skills/ui-ux-pro-max/scripts/search.py" \
  "$HOME/.claude/skills/ui-ux-pro-max/scripts/search.py"; do
  [ -f "$p" ] && echo "FOUND $p" && break
done
```

`$CLAUDE_PLUGIN_ROOT` is deliberately **not** in that list. It resolves to
*this* plugin's root, never pro-max's, so it can only ever produce a false
negative.

Three tiers. Stop at the first that works.

| Tier | Condition | Action |
|---|---|---|
| 1 | Script found | Query it directly with `--json`. Deterministic, preferred. |
| 2 | Not found, skill installed | Invoke it by name; ask for style, palette, font pairing. |
| 3 | Neither, or no Python | Read `references/style-directions.md`, proceed, and **tell the user** the engine was unavailable so the narrower range is explained. |

**Never fail the build over this.** Only *style breadth* degrades — 84 styles
and 192 palettes down to 12 curated directions. Token architecture, the
accessibility floor, the patterns and the gate come from vendored files and are
identical in all three tiers. A chat session with no filesystem still produces
a compliant, tokenised, non-generic interface.

## No filesystem — the claude.ai chat case

In chat there is no repository, no shell and no persistence between
conversations. Every phase still runs; four of them run differently. Do not
skip a phase because its artefact cannot be written — say where the artefact
would have gone instead.

| Phase | In chat |
|---|---|
| 1 Detect | Nothing to read. **Ask** what it is being built in — and take "a single HTML file" as a real answer, not an absence of one. |
| 2 Select | No Python, so this is **tier 3 by definition**. Use `references/style-directions.md` and say the range was the twelve. |
| 3 Freeze | Nothing to write to. Put the `:root` and `.dark` blocks **at the top of the artefact itself**, and paste the design-system summary into the reply so the user can commit it later. |
| 4 Build | Unchanged. |
| 5 Gate | The script cannot run. Walk the checklist by hand — and the palettes in `style-directions.md` are pre-verified precisely so the numbers do not have to be recomputed here. |

**The frozen design rule still applies, with the user as the store.** There is
no `design/design-system.md` to read, so ask whether one exists before
selecting: "do you already have a palette and fonts for this?" A user who
pastes their tokens in has frozen them, and re-selecting over the top is the
same drift the rule exists to prevent — it just arrives by a different route.

Never invent a palette in chat when `style-directions.md` covers the case.
Improvising is what produces the generic result, and it is unnecessary: twelve
verified directions are available with no filesystem at all.

## Boundary

`13-layer-app-audit` is independent and must stay that way — it runs on
inherited codebases that never touched this skill. This skill may reference the
audit; **the audit never references this skill.**

## Attribution

`references/design-tokens.md`, `patterns-web.md`, `design-gate.md` and the
direction list in `style-directions.md` are vendored from the
**elite-frontend-ux** skill and reorganised by phase. `ui-ux-pro-max` is *not*
vendored — it is queried where installed, and is MIT licensed,
© Next Level Builder, github.com/nextlevelbuilder/ui-ux-pro-max-skill.
