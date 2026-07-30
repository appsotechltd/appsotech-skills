# Appsotech Skills

Skills for Claude Code, published by Appsotech Limited.

## Install as a plugin

    /plugin marketplace add appsotechltd/appsotech-skills
    /plugin install audit@appsotech
    /plugin install build@appsotech

## Install by copying

    cp -r plugins/audit/skills/13-app-audit ~/.claude/skills/
    cp -r plugins/build/skills/appsotech-stack ~/.claude/skills/

On Windows (PowerShell):

    Copy-Item -Recurse plugins\audit\skills\13-app-audit $HOME\.claude\skills\
    Copy-Item -Recurse plugins\build\skills\appsotech-stack $HOME\.claude\skills\

## Skills

### `appsotech-stack`

Builds an application on the Appsotech house stack. The stack, the directory
layout, the port allocation and the deployment are already decided — a run
never asks what to build things with. It asks two things: which surfaces to
build (a checklist), and what the product does.

Surfaces are the fixed set every product is assembled from:

| Surface | What it is |
|---|---|
| `platform-web` | Next.js — product marketing |
| `tenant-web` | Next.js — a tenant's own public site |
| `webapp` | React + Vite — the application, behind auth at `/app` |
| `admin-web` | React + Vite — operator console across all tenants |
| `mobile` | Flutter — learner mobile app |
| `backend` | Go — the product API, same-origin at `/v1` |

Alongside them, opted into per product: a **Go worker** over a Postgres job
queue; **Redis** for caching, rate limiting and pub/sub; **fasthttp
websockets** for live chat; **LiveKit** for voice and video; **Cloudflare R2**
for object storage; **Zoho SMTP** for transactional email.

`scripts/scaffold.mjs` allocates the product's block of ten development ports
and its own PostgreSQL database, then writes everything the conventions decide
by themselves — manifests, TypeScript configs, Dockerfiles, the RFC 7807 error
envelope, CORS and tenant middleware, health and readiness routes, and the
Coolify compose stack with every surface routed. It never overwrites an
existing file, so a second run over a product is safe. Domain code is not
scaffolded: that is the feature phase, built one vertical slice at a time.

There is no separate gateway. Coolify's Traefik is the only ingress — a proxy
doing on-demand TLS would have to own `:443`, which Traefik already does.

### `13-app-audit`

Runs the [13-Layer App Audit](13-app-audit/app-audit.md) against a codebase.
101 probes across 13 layers, scored 0–4 from collected evidence, weighted to a
single figure, with eight hard gates that cap the score at 49 when triggered.

Produces `audit/<date>/` containing a scorecard, a findings register with
reproducible evidence references, and a sequenced remediation plan.

Evidence is collected in up to four tiers: the repository always; a live URL
when supplied; a direct, read-only Postgres connection when one is available;
and whatever MCP connectors happen to be authorised — Supabase, Vercel and
Cloudflare are common examples, not the definition. Probes that cannot be
evidenced are capped at 2 and marked UNVERIFIED rather than guessed.

## Repository layout

The marketplace has two levels. `.claude-plugin/marketplace.json` lists
**themed plugins** — each one a coherent area of concern (`audit`, one day
maybe `security`, `perf`). Each plugin holds **related skills** as sibling
folders under its own `skills/`:

    plugins/<theme>/.claude-plugin/plugin.json
    plugins/<theme>/skills/<skill-name>/SKILL.md

There are two themes today: `plugins/audit/` holds `13-app-audit`, and
`plugins/build/` holds `appsotech-stack`. A second skill in either theme sits
alongside the first as `plugins/<theme>/skills/<new-skill>/`, sharing that
plugin's version.

### Adding a skill

- **New skill in an existing theme:** add a folder under
  `plugins/<theme>/skills/`. No marketplace change needed.
- **New theme:** add `plugins/<theme>/` with its own
  `.claude-plugin/plugin.json`, plus an entry for it in
  `.claude-plugin/marketplace.json`.

## Contributing

Issues and pull requests welcome. Skills live under `plugins/<plugin>/skills/`.
Run tests with:

    node --test plugins/audit/skills/13-app-audit/tests/*.test.mjs
    node --test plugins/build/skills/appsotech-stack/tests/*.test.mjs

Requires **Node 22 or later** — the code uses `import.meta.dirname` and the
tests rely on `node --test`'s glob-argument support, neither of which exist
on older Node versions.

Three tests shell out to real `npm` and `go` on PATH — deliberate
integration tests with no mocking, under this project's zero-dependency
constraint: `npm audit is actually invoked (no swallowed EINVAL) and reports
a real result`, `go list runs and reports a real result for the go root`,
and `a partial npm audit failure across roots reconciles to one outcome per
probe`. Contributors without Go installed will see those three fail — that's
expected, not a regression.

## Licence

MIT © Appsotech Limited
