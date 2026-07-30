# Layout, ports and databases

## One layout, every product

Every product ships the same surfaces under `apps/`, so a path means the same
thing whichever product you are standing in.

```
<product>/
├── apps/
│   ├── platform-web/   # Next.js     — product marketing; a tenant signs up here
│   ├── tenant-web/     # Next.js     — each tenant's own public site
│   ├── webapp/         # React/Vite  — the application itself, behind auth
│   ├── admin-web/      # React/Vite  — operator console across all tenants
│   └── mobile/         # Flutter     — learner mobile app
├── backend/            # Go          — the product API
├── deploy/             # Coolify compose stacks
└── docs/               # domain.md, ports-and-databases.md
```

There is no `gateway/`. Coolify's Traefik is the only ingress — see
`deploy-coolify.md` for how organisation hostnames are routed and why a second
proxy cannot coexist with it.

**Marketing sites are Next.js. Application surfaces are React + Vite.** Public
pages need SSR and structured data for crawlers and link-preview bots; anything
behind auth is never indexed, so SSR is pure cost there.

## The Go API layout

```
backend/
├── cmd/
│   ├── api/            # the HTTP server
│   ├── worker/         # background jobs, if any
│   └── seed/           # development data
├── internal/
│   ├── cache/          # Redis: read-through cache, rate limiting
│   ├── config/         # environment, read once at boot
│   ├── db/             # pgxpool construction
│   ├── jobs/           # Postgres job queue and the worker runner
│   ├── mail/           # Zoho SMTP
│   ├── middleware/     # logger, cors, auth, tenant, rbac
│   ├── problems/       # RFC 7807 error types
│   ├── realtime/       # websocket hub, LiveKit tokens
│   ├── response/       # the {"data": ...} envelope
│   ├── storage/        # Cloudflare R2
│   └── <feature>/      # one package per domain concept
└── migrations/         # 000001_name.up.sql / .down.sql
```

`cache/`, `jobs/`, `mail/`, `realtime/` and `storage/` are scaffolded only when
the product asked for them — see `services.md`.

`cmd/worker` shares this module and its config; it is a second entrypoint, not
a service of its own. It builds from `Dockerfile.worker` and gets no port and
no Traefik router, because it serves no HTTP.

`internal/` is one package per domain concept — `student`, `fees`, `timetable`,
`assessment` — not one package per technical layer. A `handlers/` directory
holding every handler in the system is the arrangement this avoids: it puts
every feature's code in four different places and makes deleting a feature an
archaeology exercise.

## The Vite surface layout

```
apps/webapp/src/
├── components/     # presentational, no data fetching
├── contexts/       # React context providers
├── hooks/          # shared behaviour
├── i18n/           # locale resources
├── lib/            # api.ts and other zero-dependency helpers
├── pages/          # one per route
├── services/       # typed API clients, one file per feature
├── stores/         # zustand stores
└── styles/
```

`services/` holds the typed client and nothing else — no React, no hooks. That
separation is what lets a service be tested without rendering anything and
imported by a hook, a store or a loader without dragging a component tree in.

## Ports

Every app in every product has its own development port, so the whole suite can
run at once. This is not tidiness: the arrangement before the allocation table
had three collisions and could not run.

Each product owns a **block of ten**, assigned in canonical `apps/` order:

| Offset | Surface |
|---|---|
| +0 | `platform-web` |
| +1 | `tenant-web` |
| +2 | `webapp` |
| +3 | `admin-web` |

Ports are assigned by the surface's fixed offset, **not** by counting the
surfaces a product happens to have. A product with no `tenant-web` still leaves
`+1` empty and puts `webapp` on `+2`. Otherwise adding `tenant-web` later
shifts everything after it, and a port that moved is a port that is now wrong
in some Dockerfile nobody thought to grep.

Blocks run from 3200 upward. 3100 and API port 8100 belong to the suite site,
which is not a product — it has no tenants of its own, so it can never be
allocated to one. API ports run from 8080. Postgres keeps 5432, Redis 6379.

These ports reach an app **directly**, bypassing Traefik. That is what they
are for: reaching one directly is how you tell "the app is broken" apart from
"the ingress is routing it wrong". Normal use goes through Traefik by
hostname.

### Changing a port

Change it in the allocation table **and** in the app's own config, in the same
commit:

| Surface kind | Where the port lives |
|---|---|
| Next.js | `package.json` → `dev` and `start` scripts, and `Dockerfile` → `ENV PORT` / `EXPOSE` |
| Vite | `vite.config.ts` → `server.port` |
| Go API | the `SERVER_ADDR` environment variable, and `Dockerfile` |

**`SERVER_ADDR`, not `PORT`.** The Go server binds `cfg.ServerAddr`. `PORT` is
parsed into config for parity with platforms that inject it, but
`ListenAndServe` never sees it — setting only `PORT` leaves the server on its
default while every config file looks correct.

A Vite surface's *container* port is always 80: the build is a static bundle
served by nginx, and Traefik proxies to `:80` for every one of them. Its
allocated port is a development port only.

## Databases

Every product gets its own PostgreSQL database, named `<prefix>_<slug>`. No two
products share one, and inside each database every row belongs to exactly one
tenant.

**Separate databases, not separate schemas in one database.** A schema shares a
connection pool, a `pg_dump`, a restore and a `max_connections` budget with
every other schema beside it. Separate databases mean one product's migration,
long query or restore cannot reach another's data.

CI databases are ephemeral and named by the workflow, so they sit deliberately
outside the allocation table.

## Hostnames

| Surface | Hostname |
|---|---|
| `platform-web` | `<product>.<root>` |
| `admin-web` | `admin.<product>.<root>` |
| `tenant-web` | `<tenant>.<product>.<root>/`, and the organisation's own domain |
| `webapp` | the same organisation host, at `/app` |
| API | the same organisation host, at `/v1` |

One origin per organisation: one certificate, one cookie jar, one address to
put on a letter to a parent. `app`, `admin`, `api` and `www` are reserved
labels and can never be tenant slugs.

`admin-web` is deliberately **not** on an organisation host. It is the operator
console and lists every tenant of a product, so it cannot live at one
organisation's address.
