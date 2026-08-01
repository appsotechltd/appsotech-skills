# Page archetypes — Phase 3

Read this **before laying anything out**. Roughly eight page types recur in
every product; each gets one canonical composition with real numbers, so it is
decided once here instead of re-invented per surface.

The rest of the skill judges elements — contrast, labels, tap targets. This
file judges the **page**. An admin sign-in consisting of a 400px card floating
in an empty 1440×900 viewport passes every element check and is still an
unfinished page; the archetype is what says so.

Each archetype ends with a FORBIDDEN clause (the failure it exists to prevent)
and an ESCAPE clause (the legitimate exception, recorded in
`design/overrides.md` — a deviation someone can review, where a silent one
cannot be).

## 1. Authentication — sign in, sign up, MFA, password reset

**≥1024px: a 50/50 split. Not a centred card.**

- **Left — the brand half.** Uses the **dark token scope** regardless of theme.
  Wordmark top-left. One line of positioning at 32–40px. One piece of
  substance below it: a customer logo row, a single statistic, or the
  product's memorable element. Never a stock photograph.
- **Right — the form half**, on `--background`. Form column max-width 400px,
  centred within its half. Fields full-width of that column.

| Width | Behaviour |
|---|---|
| ≥1024px | the 50/50 split |
| 768–1023px | the brand half collapses to a 96px band above the form |
| <768px | band becomes the wordmark alone; form full-width, 24px gutters |

Every field carries a visible `<label>` — never placeholder-as-label. The
submit control is full-width of the form column. Errors render above the
submit control, in `--destructive`, with `role="alert"`.

WHY: the centred card is what every framework ships, and it is the reason auth
is the least designed page in most products. A 50/50 split costs nothing, uses
the viewport, and gives the brand its only uninterrupted moment with somebody
who is not yet a customer.

**FORBIDDEN:** a card narrower than 480px floating in a viewport wider than
1024px with no other content. That is an unfinished page, not a minimal one.

**ESCAPE:** a surface whose sign-in is a modal over existing content. Record it
in `design/overrides.md`.

## 2. Hero / landing

**The hero runs on the dark token scope by default, in both themes.**

Not "a darker background colour" — the whole dark block:

```html
<section data-theme="dark" class="bg-background text-foreground">
```

THIS IS LOAD-BEARING. In a Swiss-derived system the primary action is ink, not
colour, so `--primary` is near-black. A dark background carrying light-mode
tokens renders the primary CTA against its own background at 1.02:1 — it
disappears. Measured on a representative product:

```
dark hero + light-mode tokens
  accent text ......................  3.35:1   FAIL
  --primary (the CTA fill) .........  1.02:1   INVISIBLE

dark hero + the existing dark-mode tokens
  accent text ......................  5.64:1   pass
  --foreground ..................... 17.84:1   pass
```

The dark-mode accent and foreground are already tuned for this surface. **No
new palette values are needed and the freeze is untouched** — this is
composition, not colour.

**RHYTHM:** the section immediately following a dark hero must be light. Two
dark bands in sequence merge into one mass and the page loses its first
transition. Check this whenever a hero is changed.

**CANVAS:** if the product has an ambient canvas treatment it belongs here.
Particle and line treatments read substantially better on dark, which is a
second reason for this default. Which treatment, which engine, and what it may
cost stay `hero.md`'s — that file owns treatment and budget; this section owns
the token scope and the composition around it.

**FORBIDDEN:** a full-bleed hero whose CTA sits below the fold at 1440×900 —
headline, one line of sub and the primary action are all visible without
scrolling.

**ESCAPE:** a product whose accent is light-on-dark by construction keeps a
light hero. Record it in `design/overrides.md` **with the measured contrast
numbers**, not just the decision.

## 3. Dashboard / overview

12-column grid. A stat row on top — four KPIs at desktop, two at tablet, one
column on a phone — then **one** primary visual at roughly ⅔ width with a
supporting list or feed beside it. The page answers "is anything wrong, and
what changed" in the first screenful; everything below is drill-down.

| Width | Behaviour |
|---|---|
| ≥1024px | stat row + ⅔/⅓ main split |
| 768–1023px | stats 2×2; main and side stack |
| <768px | one column, stats first |

**FORBIDDEN:** a wall of equal-sized cards — nine identical tiles is a menu,
not an overview, and it means nobody decided what matters most.

**ESCAPE:** a wall-display or NOC view designed to be read at distance. Record
it, with the viewing distance it is designed for.

## 4. Index / list — the data table

Toolbar above the table: search on the left, filters beside it, the primary
action on the right. The identifying column left-aligned and first; numeric
columns right-aligned. Declare density — **comfortable** (~56px rows) or
**compact** (~40px) — per table, deliberately. Pagination, not infinite scroll
(the gate already bans that). The empty state is designed: what this list is,
what fills it, and the primary action repeated.

Below 1024px the table either drops secondary columns or becomes cards — it
never horizontally scrolls as the *default* desktop state.

**FORBIDDEN:** a desktop table wrapped in `overflow-x: auto` because nobody
chose which columns matter. The scroll container is the prescribed answer for
genuinely wide data, not a substitute for deciding.

**ESCAPE:** log viewers and streams, where monospaced width is the content.

## 5. Detail / record

Header first: the record's identifier, its status, and the actions, with
actions right-aligned. Then a two-column body at ≥1024px — main content at ⅔,
metadata sidebar at ⅓. Content is grouped into titled sections, not one long
definition list. Below 1024px the sidebar stacks under the header, above the
main content.

**FORBIDDEN:** thirty label/value rows with no grouping — if every fact has
equal weight, the page has no opinion about what the reader came for.

**ESCAPE:** print and export views, which are linear by nature.

## 6. Form / wizard

Single column, max-width 640px. Labels above fields. One topic per step and no
more than about seven visible inputs at once — past that, split into steps and
show progress. The primary action sits at the end of the column;
destructive/cancel actions are visually subordinate to it.

**FORBIDDEN:** two-column field grids. The eye zigzags and users miss fields.
The exception is a tightly-coupled pair (city/postcode) — a pair, not a grid.

**ESCAPE:** dense data-entry for expert operators who key hundreds of records.
Record it, with who the operator is.

## 7. Settings

At ≥1024px: a left navigation of setting groups (~240px) beside a content
column capped at 640px. Each group is its own page or section. The destructive
zone — delete, transfer, reset — comes last, visually separated and labelled.
Below 1024px the navigation collapses to tabs or a menu.

**FORBIDDEN:** one endless page of forty toggles. Settings nobody can find are
settings that generate support tickets.

**ESCAPE:** a product with five settings or fewer uses a single card and skips
the navigation entirely.

## 8. Empty, loading and error states

Every screen has all three, and all three keep the app chrome rendered —
navigation never disappears because content is absent.

- **Empty** says what this is, what fills it, and repeats the primary action.
  "No data" is a diagnosis, not a state.
- **Loading** is a skeleton matching the final layout. A bare spinner is
  acceptable only for sub-second waits where the shape is unknowable.
- **Error** says what failed and what to do next — never a raw exception, and
  never a dead end without a retry or a way back.

**FORBIDDEN:** a blank viewport while data loads. The first paint teaches the
user what the page is; blank teaches them it is broken.

**ESCAPE:** none. These three apply to every screen in every archetype above.
