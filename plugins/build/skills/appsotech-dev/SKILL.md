---
name: appsotech-dev
description: >
  Build applications on the Appsotech house stack — Go API (fasthttp, pgx/v5),
  Next.js public surfaces, React + Vite surfaces behind auth, Flutter mobile,
  PostgreSQL, Redis, R2 storage, Zoho SMTP, LiveKit calls, websocket chat,
  Coolify deploy. Use when starting a new project or product; scaffolding a
  repository; adding a surface, feature or API to an existing one; allocating
  ports or databases; or deploying. Fires on "start a new project", "add a
  feature", "scaffold this", "build the API" and "deploy it". The stack,
  layout, ports and deployment are already decided: never ask what to build
  them with. Design and UI work is delegated to `appsotech-design`, which this
  skill reads at Phase 5 — a run that starts here still covers both.
---

# Appsotech stack

**How it is wired** — surfaces, ports, database, API, deploy. How it *looks*
is `appsotech-design`, which this skill reads at Phase 5, so starting a project
here still covers both halves. Loading the design skill alone is also fine, and
is the right move when there is no stack to scaffold.

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
| Design | `appsotech-design` — pro-max generates style, elite owns tokens and the floor |
| Tests | Go `testing`, Vitest + Testing Library, Playwright, `flutter_test` |

If the operator asks for something outside this — a Rails API, a Vue frontend —
build what they asked for and say once that it departs from the house stack.
Do not silently substitute.

## Design — delegated, never restated

Everything about how it *looks* lives in **`appsotech-design`**: the precedence
table (pro-max generates, elite verifies), the frozen design rule, tokens,
patterns, motion, hero treatments and the gate. None of it is repeated here.
Two copies of a precedence table is how the two copies come to disagree, and
the one thing worse than an unenforced rule is two versions of it.

## Paths

Two roots, and confusing them breaks the gate. **`design/…`, `apps/…`,
`backend/…`** are relative to the **target project**. **`scripts/…` and
`references/…`** are relative to a skill's own directory.

The working directory during a run is the target project, so a bare
`node scripts/scaffold.mjs` never resolves. Resolve both skills up front:

```bash
for base in \
  "$CLAUDE_PLUGIN_ROOT/skills/appsotech-dev/scripts" \
  "$HOME/.claude/skills/appsotech-dev/scripts" \
  ".claude/skills/appsotech-dev/scripts"; do
  [ -f "$base/scaffold.mjs" ] && SCRIPTS="$base" && break
done
SCAFFOLD="$SCRIPTS/scaffold.mjs"

for base in \
  "$CLAUDE_PLUGIN_ROOT/skills/appsotech-design" \
  "$HOME/.claude/skills/appsotech-design" \
  ".claude/skills/appsotech-design"; do
  [ -f "$base/SKILL.md" ] && DESIGN="$base" && break
done
GATE="$DESIGN/scripts/gate.mjs"
echo "stack ${SCRIPTS:-NOT FOUND} / design ${DESIGN:-NOT FOUND}"
```

**Read `$DESIGN/SKILL.md` before Phase 5** and follow it for Phases 5–7's
design work. The two ship together in the `build` plugin, so a plugin install
has both; a copy install needs both folders.

If `$DESIGN` did not resolve, **say so and stop the design phases** rather than
improvising a palette from memory. Scaffolding and backend work carry on
regardless — those do not depend on it. An ungated design system invented on
the spot is the exact thing this repo exists to prevent, and it is better to
report the skill as missing than to produce one that looks finished.

---

## Phase 0 — What kind of work is this?

Four answers, and one of them is "not this skill". Decide before doing
anything, because three of them skip most of the scaffolding.

| The request | Route |
|---|---|
| Whether to build it, what it should be, who it is for | **None** — this is upstream. Stop. |
| A new product or project | **A** — every phase, 1 → 9 |
| A feature or surface in an existing product | **B** — skip Phases 1–3, start at 4 |
| A standalone screen, mockup or single-file prototype | **C** — skip Phases 1–4 entirely, start at 5 |

**Route None matters most, because the description above is deliberately pushy
and will fire on "let's build a marketplace" from someone who wanted to think,
not to ship.** Phases 1–2 commit a slug that becomes a DNS label, a Go module
path *and* a database name; Phase 6 then freezes a palette only an explicit
restyle unfreezes. Committing that for someone still deciding what the product
is costs more to undo than to defer. Say so and stop — hand over to a
discovery skill if one is available, otherwise ask what they want built.
**Never scaffold to avoid an awkward pause.**

It does not apply to a throwaway screen made to think *against* — that is
Route C, a prototype being an instrument of deciding rather than something you
decide before it. Nor to a decision already made, however it was reached.

Route B: an existing product already has its allocation, its domain and its
frozen design system. Read `docs/domain.md`, `design/design-system.md` and
`docs/ports-and-databases.md` rather than regenerating any of them, and check
`docs/specs/` for a spec covering the feature being asked for.

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

**If `docs/domain.md` exists, read it and use it**, and ask only about what it
leaves open. Re-interrogating someone about entities they wrote down last week
is the same failure as regenerating a frozen palette. Read any brief,
one-pager or spec in `docs/` and `docs/specs/` first, for the same reason.

Upstream documents settle **part of what follows, and it is worth knowing which
part.** A spec's user stories, grouped by persona, are the actor list; its
acceptance criteria are the one workflow. A brainstorm gives a direction and a
riskiest assumption, which is less. Neither says what owns what, what cascades
on delete, or what "one organisation" means — no product document does, because
those are decisions about data. **Never infer a schema from a PRD**: take the
actors and the workflow from it, and ask about the rest.

Find out what the product actually does. One focused round, then build.

- **Entities and their relationships** — what exists, what owns what, what
  cascades on delete.
- **Actors and what each may do** — this becomes the RBAC table, and a role
  discovered later is a migration plus an audit of every handler.
- **The tenant boundary** — what "one organisation" means here.
- **The one workflow that matters most** — build it end to end first.

Write the answers to `docs/domain.md` before writing code.

## Phases 5 and 6 — Design: select and freeze

**`appsotech-design` owns both.** Read `$DESIGN/SKILL.md` and follow its
Phases 1 and 2: engine resolution in three tiers, the four selection questions,
then `design/tokens.css`, `design/design-system.md`, the contrast gate and the
freeze fingerprint.

Two things this skill contributes, because they are stack facts rather than
design ones:

- The Flutter token copy belongs at `apps/mobile/lib/design/tokens.dart`, since
  that is where this layout puts the Flutter package.
- Tokens are **per product, not per surface**. `webapp` and `admin-web` share
  one system, or the same product looks like two.

**Skip both phases entirely if `design/design-system.md` exists.** Read it and
go to Phase 7.

## Phase 7 — Build

Read `references/backend-go.md`, `references/web-surfaces.md` and
`references/feature-build.md`. Then, as they apply:

| Reference | When |
|---|---|
| `$DESIGN/references/patterns-web.md` | a dashboard, landing page or Tailwind/React component |
| `references/mobile-flutter.md` | Flutter — how the app is wired: API client, auth, offline |
| `$DESIGN/references/patterns-mobile.md` | Flutter — how it looks: `ThemeData`, light/dark, responsive |
| `$DESIGN/references/motion.md` | anything animates — and *before* adding motion, since its first rule is whether to animate at all |
| `$DESIGN/references/hero.md` | a hero section on `platform-web` or `tenant-web` — particles, 3D, a full-screen treatment or a hero image |
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
   workflow named in Phase 4. **If a spec supplied acceptance criteria, they
   are the test cases** — Given/When/Then maps onto a Playwright step and a Go
   table row one for one, including the error and edge cases it listed.
   Inventing a parallel set leaves the written criteria unverified while the
   suite looks thorough.

Three rules apply to every feature:

- **Cache keys, websocket rooms, LiveKit room names and R2 object keys are
  tenant-namespaced.** None is a database row, so RLS covers none of them.
- **Every job handler is idempotent.** Delivery is at-least-once.
- **No component names a raw colour.** It is broken in dark mode and nobody
  finds out until they look.
- **Ask whether it should animate before animating it.** A keyboard-initiated
  action seen 100+ times a day gets no animation at all — see `motion.md`.
- **A canvas belongs in a hero on a public surface, or nowhere.** Never in
  `webapp` or `admin-web`, and never as the LCP element — see `hero.md`.

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
| **Design, all of it** | `node "$GATE" --domain docs/domain.md --serve apps/<surface>/dist` |

`gate.mjs` finds `design/`, the Flutter token copy and every `apps/*/src` by
convention, so only a rendered target needs naming — `--serve` for a static
build, `--url` for a Next.js surface after `npm run start`. `--domain` is
passed here because `docs/domain.md` is a stack artefact: the design skill does
not default it, since a design-only project has none and a permanent SKIP for a
file nobody meant to write is how a warning becomes noise.

**A step it could not run reports `SKIP` and is never counted as a pass**, said
again at the end. That is why it exists: nine separate commands get run as six,
and the three nobody ran look like silence rather than absence.

The individual scripts live in `$DESIGN/scripts/` and are worth reaching for
while fixing one thing.

**Any surface under `apps/` is a UI surface, so the design rows apply.** If
`design/tokens.css` does not exist, Phases 5–6 never ran — do them before
reporting the surface built. A surface that compiles is not a surface that is
finished.

A Vite surface builds to a static `dist/`, which `--serve` hosts directly. A
Next.js surface builds to `.next/` and needs its own server. `apps/mobile` is a
human pass: `flutter analyze` covers the code, and layout at the largest OS
text scale and in landscape does not automate.

Then walk `$DESIGN/references/design-gate.md` end to end. The scripts cover the
items marked `[auto]`; the rest are judgement calls — whether the tablet layout
is designed or merely fits, whether dark mode was designed or inverted, whether
the memorable element survived into the code.

Report what passed, what failed with its output, and anything left unbuilt. A
phase that was skipped is said plainly, not omitted.

Finally, update `docs/ports-and-databases.md` with the new product's block, API
port and database. A product missing from that table is a collision waiting for
the next one.

## No filesystem — the claude.ai chat case

No repository, no shell, no persistence, so there is nothing here to scaffold:
this is **Route C by definition** and the work is entirely `appsotech-design`'s.
Its own chat section covers the three phases that run differently, including
the rule that matters most — the frozen design rule still applies with the user
as the store, so ask whether a palette already exists before selecting one.

## Boundary

`appsotech-audit` is independent and must stay that way — it runs on inherited
codebases that never touched this skill. This skill may reference the audit;
**the audit never references this skill.**

Anything upstream — brainstorming, discovery, a brief — is the same shape in
the other direction. It decides *what* to build and *for whom*; this decides
how it is wired and how it looks. **Upstream may reopen the product. It never
reopens the stack**, from any source.

That handoff is a **file, never a conversation**: sessions start fresh and
remote, so a brainstorm ending in chat and a build starting tomorrow share
nothing. It has to land in `docs/`, or Phase 4 will ask again and be right to.

## Attribution

Nothing third-party is vendored here. `appsotech-design` carries the vendored
**elite-frontend-ux** material and the attribution for it, for
**emilkowalski/skills**, and for `ui-ux-pro-max`.
