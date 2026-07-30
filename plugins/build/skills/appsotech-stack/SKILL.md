---
name: appsotech-stack
description: >
  Build applications on the Appsotech house stack — Go API (fasthttp, pgx/v5),
  Next.js public surfaces, React + Vite surfaces behind auth, Flutter mobile,
  PostgreSQL, Redis, R2 storage, Zoho SMTP, LiveKit calls, websocket chat,
  Coolify deploy — and design them to a frozen, accessibility-gated design
  system. Use when starting a new project or product; adding a surface,
  feature or API to an existing one; or building, designing, styling or
  laying out any UI — a screen, page, dashboard, landing page, form,
  component, admin panel, mobile screen, or a single-file HTML prototype.
  Fires on "start a new project", "build me a screen", "make a prototype",
  "put a UI on this" and "make it look good" — not only on "design" or
  "scaffold". The stack, layout, ports and deployment are already decided:
  never ask what to build them with.
---

# Appsotech stack

One skill, two halves. **How it is wired** — surfaces, ports, database, API,
deploy — and **how it looks** — style, tokens, accessibility. Load this at the
start of a project and it covers both.

**The stack is not a question.** Everything below is already decided and is not
re-litigated at the start of a run.

| Layer | What it is |
|---|---|
| API | Go 1.24 — fasthttp, fasthttprouter, pgx/v5, zerolog, golang-jwt/v5 |
| Database | PostgreSQL 17 — one database per product, numbered SQL migrations, RLS |
| Public web | Next.js 15 App Router, TypeScript, Tailwind v4 |
| Web behind auth | React 18 + Vite 5, TanStack Query, zustand, react-hook-form + zod, i18next, Sentry |
| Mobile | Flutter 3.5 — dio, riverpod, go_router |
| Background jobs | Postgres queue (`FOR UPDATE SKIP LOCKED`) + a Go worker |
| Cache / rate limit / bus | Redis 7 |
| Live chat | fasthttp websocket + Redis pub/sub |
| Live voice and video | LiveKit — the API mints tokens, media never proxies |
| Object storage | Cloudflare R2, via the S3 API |
| Transactional email | Zoho SMTP |
| Deploy | Coolify — Docker Compose behind Traefik, the only ingress |
| Design | pro-max generates style; elite owns tokens and the accessibility floor |
| Tests | Go `testing`, Vitest + Testing Library, Playwright, `flutter_test` |

If the operator asks for something outside this — a Rails API, a Vue frontend —
build what they asked for and say once that it departs from the house stack.
Do not silently substitute.

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
| Motion — transform/opacity only, `prefers-reduced-motion` honoured | **elite** — pro-max's GSAP presets are filtered through it |
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
triggered by a new surface.

| File | Role | Changes when |
|---|---|---|
| `design/design-system.md` | Master — style, palette, fonts, rationale | explicit re-selection only |
| `design/tokens.css` | The tokens, elite's naming | regenerated from the Master |
| `design/tokens.dart` | Same values for Flutter, generated | regenerated from the Master |
| `design/overrides.md` | Per-surface deviations | normal work |

Tokens are **per product, not per surface**. `webapp` and `admin-web` share one
system, or the same product looks like two.

## Paths

Two roots, and confusing them breaks the gate. **`design/…`, `apps/…`,
`backend/…`** are relative to the **target project**. **`scripts/…` and
`references/…`** are relative to **this skill's own directory**.

The working directory during a run is the target project, so a bare
`node scripts/contrast.mjs` never resolves. Resolve once, up front:

```bash
for base in \
  "$CLAUDE_PLUGIN_ROOT/skills/appsotech-stack/scripts" \
  "$HOME/.claude/skills/appsotech-stack/scripts" \
  ".claude/skills/appsotech-stack/scripts"; do
  [ -f "$base/contrast.mjs" ] && SCRIPTS="$base" && break
done
CONTRAST="$SCRIPTS/contrast.mjs"
AUDIT="$SCRIPTS/audit-markup.mjs"
RESPONSIVE="$SCRIPTS/responsive-check.mjs"
SCAFFOLD="$SCRIPTS/scaffold.mjs"
echo "${SCRIPTS:-NOT FOUND}"
```

If it did not resolve, say so and fall back to checking by hand against
`references/design-tokens.md` and `references/design-gate.md` — do not skip the
checks silently.

---

## Phase 0 — What kind of work is this?

Three routes. Decide before doing anything, because two of them skip most of
the scaffolding.

| The request | Route |
|---|---|
| A new product or project | **A** — every phase, 1 → 9 |
| A feature or surface in an existing product | **B** — skip Phases 1–3, start at 4 |
| A standalone screen, mockup or single-file prototype | **C** — skip Phases 1–4 entirely, start at 5 |

**Route C matters.** "Make me a prototype" or "build me a login screen" is not
a request for a port block, a database name or a Coolify stack. Go straight to
the design phases, produce the screen, and run the gate. Do not scaffold a
product around a mockup.

Route B: an existing product already has its allocation and its frozen design
system. Read `design/design-system.md` and `docs/ports-and-databases.md` rather
than regenerating either.

## Phase 1 — Scope *(Route A)*

**Target directory.** Where the product goes. If the working directory already
has `backend/` or `apps/`, this is Route B.

**Product slug.** A DNS label: lowercase, alphanumeric, no hyphens. It becomes
`<slug>.<root-domain>`, a Go module path and a database name, so it cannot be
changed cheaply later. Derive it from what the operator called the thing; ask
only if there is no reasonable candidate. `app`, `admin`, `api` and `www` are
reserved and can never be a slug.

**Existing allocations.** If a `docs/ports-and-databases.md` exists anywhere up
the tree, it is authoritative. Pass it with `--allocations` so the new product
cannot be handed a block another product is on.

## Phase 2 — Pick the surfaces *(Route A)*

Ask with `AskUserQuestion`, **all three questions in a single call**, each
`multiSelect: true`. This is the only point where the operator chooses shape.

*Which application surfaces?*

| Option | Description to show |
|---|---|
| `platform-web` | Next.js — product marketing; a tenant signs up here. Indexed, so SSR earns its cost. |
| `tenant-web` | Next.js — each tenant's own public site; learner signup and login. |
| `webapp` | React + Vite — the application itself, behind auth at `/app`. Never indexed. |
| `admin-web` | React + Vite — operator console spanning every tenant. |

*Which services?*

| Option | Description to show |
|---|---|
| `backend` | Go API — fasthttp + pgx/v5, served same-origin at `/v1`. |
| `worker` | Background jobs — a second entrypoint in the API's own module, Postgres queue. |
| `mobile` | Flutter — learner mobile app. |

*Which of these does it need?*

| Option | Description to show |
|---|---|
| Live chat | Websocket messaging. Forces Redis on: without a shared bus a message reaches only the sender's replica. |
| Live voice / video | LiveKit. The API mints short-lived join tokens; media goes direct. |
| Transactional email | Zoho SMTP. Selects the worker too — sending from a handler makes the user wait on someone else's mail server. |
| File uploads | Cloudflare R2, presigned, so bytes never pass through the API. |

Recommend `backend` + `webapp` + `tenant-web` as the smallest coherent product
and mark it so. Pre-select nothing in the third question.

**Redis is not a checkbox** — it comes with any API by default. Mention it
rather than asking; pass `--no-redis` only if the operator declines it.

There is deliberately **no gateway option**. Coolify's Traefik is the only
ingress; a second proxy doing on-demand TLS would have to own `:443`, which
Traefik already does.

Then read `references/layout.md` and honour every warning the scaffolder emits
about an incoherent selection.

## Phase 3 — Allocate and scaffold *(Route A)*

```
node "$SCAFFOLD" <slug> --surfaces <comma,separated> \
  --out <targetDir> --root-domain <domain> \
  [--worker] [--realtime chat,video] [--storage] [--mail] [--no-redis] \
  [--allocations <path/to/ports-and-databases.md>]
```

Run with `--dry-run` first and show the port block, database name and file
list. Then run it for real.

It never overwrites an existing file — it reports `(exists, skipped)`. That is
what makes a second run over a product safe.

Confirm the skeleton stands up:

```
cd <targetDir>/backend && go mod tidy && go build ./...
cd <targetDir>/apps/<surface> && npm install && npm run build
```

`go mod tidy` will populate the `// indirect` block; what it must **not** do is
change the direct `require` block.

## Phase 4 — Domain *(Routes A and B)*

Find out what the product actually does. One focused round, then build.

- **Entities and their relationships** — what exists, what owns what, what
  cascades on delete.
- **Actors and what each may do** — this becomes the RBAC table, and a role
  discovered later is a migration plus an audit of every handler.
- **The tenant boundary** — what "one organisation" means here.
- **The one workflow that matters most** — build it end to end first.

Write the answers to `docs/domain.md` before writing code.

## Phase 5 — Design: select

**Skip entirely if `design/design-system.md` exists.** Read it and go to
Phase 6.

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

**Never fail the build over this.** Only style *breadth* degrades — 84 styles
down to 12 curated directions. Tokens, the accessibility floor, the patterns
and the gate are vendored and identical in all three tiers.

## Phase 6 — Design: freeze

Read `references/design-tokens.md`, then write:

- `design/tokens.css` — pro-max's values in **elite's naming scheme**, light
  and dark blocks, both required
- `design/design-system.md` — style, palette, fonts and *why*, so the next
  session inherits the reasoning and not just the values
- `design/tokens.dart` — **only if there is a Flutter surface.** Generated from
  `tokens.css`, never hand-maintained beside it: two hand-kept copies drift,
  and the drift shows as an app that is subtly a different product from its own
  website.

Then gate it before committing:

```
node "$CONTRAST" design/tokens.css
```

Non-zero exit means a pair is below the floor. **Fix the token and re-run.**
Catching this here costs one token; catching it in Phase 9 costs an audit of
every component that consumed it.

**No palette values inline in markup, ever.**

## Phase 7 — Build

Read `references/backend-go.md`, `references/web-surfaces.md` and
`references/feature-build.md`. Then, as they apply:

| Reference | When |
|---|---|
| `references/patterns-web.md` | a dashboard, landing page or Tailwind/React component |
| `references/mobile-flutter.md` | Flutter — how the app is wired: API client, auth, offline |
| `references/patterns-mobile.md` | Flutter — how it looks: `ThemeData`, light/dark, responsive |
| `references/services.md` | the product took jobs, caching, chat, calls, storage or email |

The two Flutter files are deliberately separate and both apply: one is
architecture, the other is theming, and a Flutter surface needs both.

**Build vertically, one feature at a time — never layer by layer.** A feature
is done when a real user action reaches Postgres and comes back.

1. **Migration** — numbered `.up.sql`/`.down.sql`; every table gets its tenant
   column and RLS policy in the same migration
2. **Feature package** — `internal/<feature>/` with all four files
3. **Routes** — registered in `cmd/api/main.go` under `/v1`
4. **Go tests** — table-driven, against a real database, including the
   tenant-boundary test
5. **API client and screens** — typed client, TanStack Query hooks, then the
   screens, styled from the tokens
6. **Component tests** — Vitest + Testing Library; one Playwright spec for the
   workflow named in Phase 4

Three rules apply to every feature:

- **Cache keys, websocket rooms, LiveKit room names and R2 object keys are
  tenant-namespaced.** None is a database row, so RLS covers none of them.
- **Every job handler is idempotent.** Delivery is at-least-once.
- **No component names a raw colour.** It is broken in dark mode and nobody
  finds out until they look.

## Phase 8 — Deploy *(Routes A and B)*

Read `references/deploy-coolify.md`. The failure modes that produce no error
anywhere:

- A service not joined to the **external `coolify` network** is unreachable.
- Traefik routes by **label**, never by `ports:`.
- The organisation-host rule is `HostRegexp`, and **v2 and v3 syntax differ**.
- Wildcard certificates are issued over **DNS-01 only**.

## Phase 9 — Verify and gate

Do not report anything as built on the strength of having written it.

| What | Command |
|---|---|
| Go | `go mod tidy && go build ./... && go vet ./... && go test ./...` |
| Next.js | `npm run build && npm run typecheck` |
| Vite | `npm run build && npm run type-check && npm run test` |
| Flutter | `flutter analyze && flutter test` |
| Compose | `docker compose -f deploy/<slug>.compose.yml config` |
| Design tokens | `node "$CONTRAST" design/tokens.css` |
| UI source | `node "$AUDIT" apps/<surface>/src` |
| Rendered UI (Vite) | `node "$RESPONSIVE" --serve apps/<surface>/dist` |
| Rendered UI (Next.js) | `npm run start`, then `node "$RESPONSIVE" http://localhost:<port>` |

**Any surface under `apps/` is a UI surface, so the design rows apply.** If
`design/tokens.css` does not exist, Phases 5–6 never ran — do them before
reporting the surface built. A surface that compiles is not a surface that is
finished.

A Vite surface builds to a static `dist/`, which `--serve` hosts directly. A
Next.js surface builds to `.next/` and needs its own server. `apps/mobile` is a
human pass: `flutter analyze` covers the code, and layout at the largest OS
text scale and in landscape does not automate.

Then walk `references/design-gate.md` end to end. The scripts cover the items
marked `[auto]`; the rest are judgement calls — whether the tablet layout is
designed or merely fits, whether dark mode was designed or inverted, whether
the memorable element survived into the code.

Report what passed, what failed with its output, and anything left unbuilt. A
phase that was skipped is said plainly, not omitted.

Finally, update `docs/ports-and-databases.md` with the new product's block, API
port and database. A product missing from that table is a collision waiting for
the next one.

## No filesystem — the claude.ai chat case

No repository, no shell, no persistence. This is **Route C by definition**, and
four phases run differently.

| Phase | In chat |
|---|---|
| 0 | Route C. There is no project to scaffold. |
| 5 | No Python, so **tier 3 by definition**. Use `references/style-directions.md` and say the range was the twelve. |
| 6 | Nothing to write to. Put the `:root` and `.dark` blocks **at the top of the artefact**, and paste the summary into the reply so the user can commit it. |
| 9 | The scripts cannot run. Walk the checklist by hand — the palettes in `style-directions.md` are pre-verified so the numbers need not be recomputed. |

**The frozen design rule still applies, with the user as the store.** Ask
whether a palette already exists before selecting. A user who pastes their
tokens in has frozen them, and re-selecting over the top is the same drift
arriving by a different route.

Never invent a palette when `style-directions.md` covers the case.

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
