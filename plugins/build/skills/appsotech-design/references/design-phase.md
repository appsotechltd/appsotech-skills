# Selection — Phase 1

**Only reached when `design/design-system.md` does not exist.** If it does,
read it and go to Phase 2.

## Before querying anything

These three questions come from **elite-frontend-ux** §1 and apply in every
tier — they do not need the design engine, and skipping them produces a
technically-compliant interface with no point of view.

**Context analysis**

- **WHO** uses this? Persona, expertise level, device context. An admin console
  used all day on a desktop and a parent portal opened once a term on a phone
  are not the same design problem.
- **WHAT** single action should they take? One primary goal per screen.
- **WHY** should they trust or engage? The value proposition.

**Aesthetic commitment.** Choose a direction and commit. Timid design fails,
and a design that hedges between two directions reads as neither.

**The memorability test.** What ONE thing will users remember? If you cannot
answer, the design has no focus yet — and the checklist in Phase 4 asks you to
name it, so decide now rather than inventing an answer later.

Write the answers into `design/design-system.md` at freeze time. They are the
reasoning the next session inherits.

## Querying pro-max (tier 1)

The query is **positional**. There is no `--query` flag.

```bash
# $SEARCH is whatever the resolution loop in SKILL.md found. Do not hardcode
# a path here — the same skill runs from a repo checkout, a plugin install and
# a home-directory copy, and only one of those three is ever right.
python3 "$SEARCH" "<query>" -d <domain> -s <stack> -n 3 --json
```

| Flag | Meaning |
|---|---|
| `-d`, `--domain` | `style`, `color`, `chart`, `landing`, `product`, `ux`, `typography`, `icons`, `gsap`, `react`, `web`, `google-fonts` |
| `-s`, `--stack` | `react`, `nextjs`, `vue`, `svelte`, `astro`, `swiftui`, `react-native`, `flutter`, `nuxtjs`, `nuxt-ui`, `html-tailwind`, `shadcn`, `jetpack-compose`, `threejs`, `angular`, `laravel`, `javafx`, `wpf`, `winui`, `avalonia`, `uno`, `uwp` |
| `-n`, `--max-results` | default 3 |
| `--json` | machine-readable — always use it |
| `--full` | do not truncate long field values |

Ask in this order. Each answer narrows the next.

```bash
# 1. Product type — the reasoning rules for this kind of app
python3 "$SEARCH" "school management for parents and staff" -d product -n 3 --json

# 2. Style direction
python3 "$SEARCH" "school management dashboard" -d style -n 3 --json

# 3. Palette
python3 "$SEARCH" "school management dashboard" -d color -n 3 --json

# 4. Font pairing
python3 "$SEARCH" "school management dashboard" -d typography -n 3 --json
```

Stack-specific guidance, once the project's stack is known:

```bash
python3 "$SEARCH" "data table" -s react -n 3 --json
```

Ask for **three** results, not one. The first is not always the best fit, and
seeing three makes the choice an actual decision rather than an acceptance.

### What comes back

`-d color` returns semantic keys that map straight onto elite's token names —
`Primary`, `On Primary`, `Secondary`, `On Secondary`, `Accent`, `On Accent`,
`Background`, `Foreground`. See `design-tokens.md` for the mapping table.

`-d typography` returns `Heading Font` and `Body Font` with a pairing name and
mood keywords.

`-d style` returns a style category, keywords, colour guidance and effects.

## Filtering the answer

pro-max owns the choice; elite owns the veto. Apply all three filters **before**
freezing.

**Contrast.** pro-max palettes are not contrast-safe. Check every `On X` / `X`
pair:

```bash
node "$CONTRAST" --pair "#FFFFFF" "#3B82F6"
```

If a pair fails, either darken the background token or take the next result.
Do not accept it and plan to fix it in components.

**Fonts.** If the pairing returns Inter, Roboto or Arial as the *heading* face,
take another result. Those are body faces at best here. A body font of Inter is
tolerable; a display font of Inter is the generic look this skill exists to
avoid.

**Motion.** `-d gsap` presets that animate width, height, margin or padding get
rewritten to transform/opacity or dropped.

## Tier 2 — the skill is installed but the script did not resolve

Invoke `ui-ux-pro-max` by name and ask for the same four things in the same
order. Then apply the same three filters — they are not the engine's job.

Note the plugin installs several sibling skills (`design`, `design-system`,
`brand`, `banner-design`, `slides`, `ui-styling`). Name `ui-ux-pro-max`
specifically.

## Tier 3 — no engine

Read `references/style-directions.md` and choose from the twelve directions
there. Every palette in that file is already contrast-checked, so the filters
above are satisfied by construction.

**Tell the user** the design engine was unavailable and that the choice came
from the twelve-direction fallback. They should know why the range was narrower
— not discover it later when someone asks why the palette looks familiar.

Nothing else degrades: tokens, the accessibility floor, patterns and the gate
are identical in all three tiers.

## Recording the decision

At freeze time, `design/design-system.md` records:

- The three context answers, and the one memorable element
- The chosen style direction and **why it beat the alternatives seen**
- The palette, with the contrast results
- The font pairing
- Which tier produced it — so a later session knows whether the choice came
  from 84 styles or from 12
