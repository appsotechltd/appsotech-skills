---
name: appsotech-stack
description: >
  Build an application on the Appsotech house stack — Go API (fasthttp,
  pgx/v5), Next.js public surfaces, React + Vite surfaces behind auth,
  Flutter mobile, PostgreSQL, Redis, R2 storage, Zoho SMTP, LiveKit calls,
  websocket chat, Coolify deploy. Use when asked
  to build, scaffold, start or add an app, product, service, portal, admin
  console, dashboard, API or mobile app; to add a feature or surface to an
  existing product; or to set up a new project. The stack, layout, ports and
  deployment are already decided — never ask what to build them with.
---

# Appsotech stack

**The stack is not a question.** Everything below is already decided and is not
re-litigated at the start of a run. What the operator picks is *which surfaces
to build* and *what the product does* — nothing else.

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
| Tests | Go `testing`, Vitest + Testing Library, Playwright, `flutter_test` |

If the operator asks for something outside this — a Rails API, a Vue frontend —
build what they asked for and say once that it departs from the house stack.
Do not silently substitute.

All paths below are relative to this skill's own directory, wherever it is
installed. Load a reference file only when its phase says to.

## Phase 1 — Scope

Establish three things. Two can usually be answered without asking.

**Target directory.** Where the product goes. If the operator named a path, use
it. If the working directory is already a product (it has `backend/` or
`apps/`), this is an *add-to-existing* run — skip Phase 2's allocation and read
the existing ports instead.

**Product slug.** A DNS label: lowercase, alphanumeric, no hyphens. It becomes
`<slug>.<root-domain>`, a Go module path and a database name, so it cannot be
changed cheaply later. Derive it from what the operator called the thing; ask
only if there is no reasonable candidate. `app`, `admin`, `api` and `www` are
reserved and can never be a slug.

**Existing allocations.** If a `docs/ports-and-databases.md` exists anywhere up
the tree, it is the allocation table and it is authoritative. Pass it to the
scaffolder with `--allocations` so the new product cannot be handed a port
block another product is already on.

## Phase 2 — Pick the surfaces

Ask with `AskUserQuestion`, **both questions in a single call**, both
`multiSelect: true`. This is the checkbox step and it is the only point where
the operator chooses shape.

Question 1 — *Which application surfaces?*

| Option | Description to show |
|---|---|
| `platform-web` | Next.js — product marketing; a tenant signs up here. Indexed, so SSR earns its cost. |
| `tenant-web` | Next.js — each tenant's own public site; learner signup and login. Reads the Host header to decide which organisation. |
| `webapp` | React + Vite — the application itself, behind auth at `/app`. Never indexed, so SSR would be pure cost. |
| `admin-web` | React + Vite — operator console spanning every tenant. |

Question 2 — *Which services?*

| Option | Description to show |
|---|---|
| `backend` | Go API — fasthttp + pgx/v5, served same-origin at `/v1`. |
| `worker` | Background jobs — a second entrypoint in the API's own module, with a Postgres queue. |
| `mobile` | Flutter — learner mobile app. |

Question 3 — *Which of these does it need?*

| Option | Description to show |
|---|---|
| Live chat | Websocket messaging. Forces Redis on: without a shared bus, a message reaches only clients on the sender's replica. |
| Live voice / video | LiveKit calls. The API mints short-lived join tokens; media goes direct. |
| Transactional email | Zoho SMTP. Selects the worker too — sending from a request handler makes the user wait on someone else's mail server. |
| File uploads | Cloudflare R2, presigned, so bytes never pass through the API. |

Recommend `backend` + `webapp` + `tenant-web` as the smallest coherent product
and mark it so. Pre-select nothing in question 3.

**Redis is not a checkbox** — it comes with any API by default, for caching and
rate limiting. Mention it rather than asking, and pass `--no-redis` only if the
operator says they do not want it.

There is deliberately **no gateway option**. Coolify's Traefik is the only
ingress; a second proxy doing on-demand TLS would have to own `:443`, which
Traefik already does. If someone asks for the Caddy gateway, explain that and
point at `references/deploy-coolify.md` for how a tenant's own domain is
routed instead.

Then read `references/layout.md` and honour every warning the scaffolder emits
about an incoherent selection — web surfaces without an API, `webapp` without
`tenant-web`.

## Phase 3 — Allocate and scaffold

```
node scripts/scaffold.mjs <slug> --surfaces <comma,separated> \
  --out <targetDir> --root-domain <domain> \
  [--worker] [--realtime chat,video] [--storage] [--mail] [--no-redis] \
  [--allocations <path/to/ports-and-databases.md>]
```

Run it with `--dry-run` first and show the operator the port block, database
name and file list. Then run it for real.

The scaffolder never overwrites an existing file — it reports `(exists,
skipped)`. That makes a second run over a product safe, which is the only
reason anyone runs one.

What it writes is everything the conventions decide by themselves: manifests,
configs, Dockerfiles, the process entrypoint, the RFC 7807 error envelope, the
`{"data": ...}` response envelope, CORS and tenant middleware, health and
readiness routes, the Coolify compose stack. What it does not write is any
domain code at all. That is Phase 4 onward, and it is the larger part of the
work.

Confirm the skeleton stands up before building on it:

```
cd <targetDir>/backend && go mod tidy && go build ./...
cd <targetDir>/apps/<surface> && npm install && npm run build
```

`go mod tidy` first — it has to run at all, because the scaffold ships no
`go.sum`. It will populate the `// indirect` block, which is expected. What it
must **not** do is change the direct `require` block: the generated `go.mod`
declares exactly what the generated code imports. If a direct dependency
disappears, a template declared something nothing imports.

## Phase 4 — Domain

Now find out what the product actually does. This is a real interview, not a
form — one focused round, then build.

Establish:

- **Entities and their relationships.** What things exist, what each owns, what
  cascades when one is deleted.
- **Actors and what each may do.** Every role that touches the system. This
  becomes the RBAC table, and a role discovered later is a migration plus an
  audit of every handler.
- **The tenant boundary.** What "one organisation" means here. Every row in
  every table belongs to exactly one, and RLS enforces it.
- **The one workflow that matters most.** Build that end to end first, so
  there is something real to react to before the long tail is built.

Write the answers to `docs/domain.md` in the target repository before writing
code. It is what the migrations, the RBAC table and the screens are all
generated from, and it is what a reviewer checks them against.

## Phase 5 — Build

Read `references/backend-go.md`, then `references/web-surfaces.md`, then
`references/feature-build.md`. Read `references/services.md` if the product
took any of caching, chat, calls, storage or email. Read
`references/mobile-flutter.md` only if `mobile` was selected.

Two rules from `services.md` apply to every feature and are worth carrying in
before you read it:

- **Cache keys, websocket rooms, LiveKit room names and R2 object keys are all
  namespaced by tenant.** None of them is a database row, so row-level security
  does not cover any of them.
- **Every job handler must be idempotent.** Delivery is at-least-once — a
  worker that dies after doing the work runs the job again when it is reaped.

**Build vertically, one feature at a time — never layer by layer.** A feature
is done when a real user action reaches Postgres and comes back. Finishing all
the migrations before any handler exists means nothing is demonstrable until
everything is, and the schema is never corrected by contact with a UI.

For each feature, in order:

1. **Migration** — numbered `.up.sql`/`.down.sql` pair. Every table carries a
   tenant column, and every table gets an RLS policy in the same migration.
2. **Feature package** — `internal/<feature>/` with the four files:
   `model.go`, `queries.go`, `service.go`, `handler.go`. Never fewer.
3. **Routes** — registered in `cmd/api/main.go` under `/v1`.
4. **Go tests** — the service against a real database, the handler against its
   router. Table-driven.
5. **API client and screens** — typed client in `src/services/`, TanStack Query
   hooks, then the screens. Anything with a visual surface goes through the
   **`design-pipeline`** skill: it owns style, tokens, responsive behaviour,
   light/dark and the accessibility gate. This skill owns how the surface is
   wired; that one owns how it looks.
6. **Component tests** — Vitest + Testing Library. One Playwright spec for the
   workflow named in Phase 4.

Then the next feature. Do not start one before the last is green.

## Phase 6 — Deploy

Read `references/deploy-coolify.md`.

The failure modes that produce no error message anywhere:

- A service not joined to the **external `coolify` network** is unreachable.
  Traefik has nothing to route to; the container is healthy and the logs are
  clean.
- Traefik routes by **label**, never by `ports:`. Publishing a host port does
  not make a service reachable and does expose it beside TLS rather than
  behind it.
- The organisation-host rule is `HostRegexp`, and **v2 and v3 syntax differ**.
  A v3 rule on a v2 Traefik simply never matches. Check the version before
  debugging a 404.
- Wildcard certificates for `*.<product>.<root>` are issued over **DNS-01
  only**. Without a DNS credential on the certresolver, tenant subdomains fail
  at TLS handshake — at request time, not deploy time.

## Phase 7 — Verify

Do not report a surface as built on the strength of having written it.

| Surface | Command |
|---|---|
| Go | `go mod tidy && go build ./... && go vet ./... && go test ./...` |
| Next.js | `npm run build && npm run typecheck` |
| Vite | `npm run build && npm run type-check && npm run test` |
| Flutter | `flutter analyze && flutter test` |
| Compose | `docker compose -f deploy/<slug>.compose.yml config` |

Run every one that applies. Report what passed, what failed with its output,
and anything left unbuilt. A phase that was skipped is said plainly, not
omitted.

Finally, update the allocation table — `docs/ports-and-databases.md` — with the
new product's block, API port and database. A product missing from that table
is a collision waiting for the next one.
