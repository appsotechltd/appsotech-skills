# Building a feature

**Vertically, one at a time.** A feature is done when a real user action reaches
Postgres and comes back.

Building layer by layer — all the migrations, then all the handlers, then all
the screens — means nothing is demonstrable until everything is, and the schema
is never corrected by contact with a UI. By the time the first screen is wired,
the tables it needs have been wrong for a week.

## The loop

For each feature, in this order. Do not start the next before this one is green.

### 1. Migration

A numbered `.up.sql`/`.down.sql` pair. Every table gets its tenant column and
its RLS policy **in the same migration that creates it** — see
`backend-go.md`. A policy added by a later migration leaves a window in which
the table is readable across tenants.

Write the `.down.sql` properly. A down migration that is a stub is a migration
that cannot be rolled back, discovered at the moment rollback is needed.

### 2. Feature package

`internal/<feature>/` with all four files — `model.go`, `queries.go`,
`service.go`, `handler.go`. Never fewer, even when one would be three lines: a
feature that starts as "just a handler" is the one that grows SQL inside a
handler.

### 3. Routes

Registered in `cmd/api/main.go` under `/v1`. One `Routes(router, handler)` call
per feature package.

### 4. Go tests

Table-driven, against a real Postgres.

Include the tenant-boundary test every time: create a row as tenant A, read it
as tenant B, assert nothing comes back. That single test is what catches a
migration that forgot its policy — and a mocked database cannot run it, which
is why the tests use a real one.

### 5. API client and hooks

Typed client in `src/services/<feature>.ts`, TanStack Query hooks in
`src/hooks/`. Types mirror the Go structs; the `{"data": ...}` envelope is
unwrapped in `lib/api.ts` and never appears at a call site.

### 6. Screens

Pages, then components. Every user-facing string through i18next — adding one
in English inline is how the second locale becomes a rewrite.

### 7. Component tests

Vitest + Testing Library, querying by role and label. One Playwright spec for
the workflow named as most important in the domain phase.

## Order of features

Build the **one workflow that matters most** end to end first, straight through
every layer, before broadening. It is the fastest way to find out that the
domain model is wrong, and it gives the operator something real to react to
while the long tail is still cheap to change.

Then: authentication and roles, because everything after them assumes an actor.
Then the remaining entities, most-depended-upon first.

## What "done" means

A feature is not done because the code is written. Before moving on:

```bash
cd backend && go build ./... && go vet ./... && go test ./...
cd apps/webapp && npm run type-check && npm run test
```

Report failures with their output. Never report a feature as complete on the
strength of having written it — the whole point of the vertical slice is that
it can be run.

## Things that go wrong

**A handler that grew rules.** Authorisation or validation in `handler.go` is
skipped by every caller that is not HTTP — a worker, a seed script, a CLI. It
belongs in `service.go`.

**A query without `tenant_id`.** RLS makes it return nothing rather than
another organisation's rows, so it fails as an empty list rather than a leak —
but an empty list that should not be empty is a confusing bug. Lead every
tenant-scoped query and every index with `tenant_id`.

**Server state in zustand.** Two sources of truth for the same row, no
invalidation, and staleness that arrives as a bug report about a number being
wrong. TanStack Query owns anything the server sent.

**A `VITE_API_URL` in the bundle.** Baked in at build time, so staging and
production need different builds of identical code. The client uses `/v1`
relative and nothing else.

**An edited migration.** Two databases with the same version number and
different schemas, which nothing recovers from. Fix forward with a new pair.
