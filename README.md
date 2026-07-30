# Appsotech Skills

Skills for Claude Code, published by Appsotech Limited.

## Install as a plugin

    /plugin marketplace add appsotechltd/appsotech-skills
    /plugin install audit@appsotech
    /plugin install build@appsotech

## Install by copying

    cp -r plugins/audit/skills/appsotech-audit ~/.claude/skills/
    cp -r plugins/build/skills/appsotech-stack ~/.claude/skills/

On Windows (PowerShell):

    Copy-Item -Recurse plugins\audit\skills\appsotech-audit $HOME\.claude\skills\
    Copy-Item -Recurse plugins\build\skills\appsotech-stack $HOME\.claude\skills\

## Skills

### `appsotech-stack`

**One skill for a whole project** — how it is wired, and how it looks. Load it
at the start and it covers the stack, the scaffold, the design system and the
gate.

The stack, directory layout, port allocation and deployment are already
decided; a run never asks what to build things with. It asks two things: which
surfaces to build (a checklist), and what the product does.

| Surface | What it is |
|---|---|
| `platform-web` | Next.js — product marketing |
| `tenant-web` | Next.js — a tenant's own public site |
| `webapp` | React + Vite — the application, behind auth at `/app` |
| `admin-web` | React + Vite — operator console across all tenants |
| `mobile` | Flutter — learner mobile app |
| `backend` | Go — the product API, same-origin at `/v1` |

Opted into per product: a **Go worker** over a Postgres job queue; **Redis**
for caching, rate limiting and pub/sub; **fasthttp websockets** for live chat;
**LiveKit** for voice and video; **Cloudflare R2**; **Zoho SMTP**.

Phase 0 routes the run, so the skill is not all-or-nothing: a new product walks
every phase, an existing one skips allocation, and a standalone screen or
single-file prototype skips the scaffolding entirely and goes straight to
design. Asking for a mockup never produces a port block and a Coolify stack.

### Design

Two authorities that do not overlap: [`ui-ux-pro-max`][promax] generates style,
palette and font pairing; the vendored `elite-frontend-ux` owns token
architecture, the type and spacing scales, responsive behaviour, light/dark and
the accessibility floor — and has the veto.

The load-bearing rule is persistence. Cloud sessions start fresh, so if
`design/design-system.md` exists it is **read, not regenerated**. Without that,
the same repo gets a different palette every session and the product drifts.

Selection degrades in three tiers — query the script, invoke the skill by name,
or fall back to twelve curated directions in `references/style-directions.md`.
Only *style breadth* degrades: tokens, patterns, the accessibility floor and
the gate are vendored and identical in all three, so a chat session with no
filesystem still produces a compliant, tokenised interface.

### The gate

Four scripts make it mechanical rather than aspirational; **14 checklist items
are marked `[auto]`**, and the rest stay human because they are judgement
calls, not leftovers.

`scripts/scaffold.mjs` allocates the product's block of ten development ports
and its own PostgreSQL database, then writes everything the conventions decide
by themselves — manifests, TypeScript configs, Dockerfiles, the RFC 7807 error
envelope, CORS and tenant middleware, health and readiness routes, and the
Coolify compose stack with every surface routed. It never overwrites an
existing file, so a second run over a product is safe. Domain code is not
scaffolded: that is the feature phase, built one vertical slice at a time.

`scripts/contrast.mjs` gates the palette at freeze time rather than at review.
pro-max palettes are not contrast-safe — its own CRM palette pairs `#FFFFFF` on
`#3B82F6` at 3.68:1, which passes the 3:1 UI threshold and fails body text. Low
contrast *borders* are reported but never fail the run: WCAG 1.4.11 covers
borders that identify a control, not decorative separators, and failing them
would fail every mainstream design system on its first run.

`scripts/audit-markup.mjs` reads the source and fails on colours declared
outside `design/`, dynamic Tailwind classes, click handlers on non-interactive
elements, images without `alt`, unlabelled inputs, banned display faces and
focus removed with nothing put back. That is the one that catches drift — a
component with a hardcoded `#3B82F6` passes a token check trivially, because
the token check never sees the component. Precision is the design constraint:
`hsl(var(--token))`, a labelled input, a `role`+`tabIndex`+key-handler div and
Arial as a fallback are all explicitly exempt, because a linter that fires on
correct code is one people learn to skip.

`scripts/responsive-check.mjs` loads the page in Chromium at 320, 768 and 1280
in both colour schemes. It catches what reading a stylesheet cannot: a
fixed-width element pushing the page sideways at 320, tap targets under 44px as
actually laid out, form controls under 16px (below which iOS zooms on focus),
and a dark block that was written but never wired — detected by comparing the
rendered body under each scheme. Content inside an `overflow-x:auto` container
and inline links in body copy are exempt, because both are the prescribed
pattern. Playwright is not bundled: the script resolves it from the project or
a global install and exits 3 with an explanation when absent.

There is no separate gateway. Coolify's Traefik is the only ingress — a proxy
doing on-demand TLS would have to own `:443`, which Traefik already does.

[promax]: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

### `appsotech-audit`

Runs the [13-Layer App Audit](appsotech-audit/app-audit.md) against a codebase.
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

There are two themes today: `plugins/audit/` holds `appsotech-audit`, and
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

    node --test plugins/audit/skills/appsotech-audit/tests/*.test.mjs
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
