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

The fourth route is **not this skill**. The description is deliberately pushy
about triggering, so it will fire on "let's build a marketplace" from someone
who wanted to think rather than to ship — and Phases 1–2 commit a slug that
becomes a DNS label, a Go module path and a database name, after which Phase 6
freezes a palette that only an explicit restyle unfreezes. When the open
question is *whether* or *what* to build, the run says so and stops rather than
scaffolding to avoid an awkward pause. A throwaway screen made to think against
is not that case — that is a prototype, and prototypes are instruments of
deciding.

### Design

Two authorities that do not overlap: [`ui-ux-pro-max`][promax] generates style,
palette and font pairing; the vendored `elite-frontend-ux` owns token
architecture, the type and spacing scales, responsive behaviour, light/dark and
the accessibility floor — and has the veto.

The load-bearing rule is persistence. Cloud sessions start fresh, so if
`design/design-system.md` exists it is **read, not regenerated**. Without that,
the same repo gets a different palette every session and the product drifts.

Motion is a third, narrower authority: `references/motion.md`, distilled from
[emilkowalski/skills][emil] (MIT). It owns one row of the precedence table and
touches no other — no colour, no type, no spacing. Its first question is whether
the thing should animate at all, which no contrast script can answer: something
the user sees a hundred times a day gets no animation, and the strongest fix is
often to delete one. Durations and curves stay in `design-tokens.md`; motion.md
says which to use where, because two timing tables is how a component ends up at
160ms while a token says 150ms.

`references/hero.md` covers the one place decorative motion and 3D are allowed:
a hero on a public surface. It picks between mouse-reactive particles, an
abstract 3D form, an image and type alone; derives the form from what the
product actually does and **freezes it beside the palette**, so the next
session inherits a shape rather than inventing one. The engine is decided
rather than chosen — a 2D canvas for particle fields, React Three Fiber only
where there is real geometry, since `three` is ~170KB gzipped and a field of
drifting dots needs no scene graph. Signed-in surfaces get no canvas at all;
ambient motion on a page someone opens every morning is a battery tax on
somebody who has already bought the thing.

Selection degrades in three tiers — query the script, invoke the skill by name,
or fall back to twelve curated directions in `references/style-directions.md`.
Only *style breadth* degrades: tokens, patterns, the accessibility floor and
the gate are vendored and identical in all three, so a chat session with no
filesystem still produces a compliant, tokenised interface.

### The gate

Seven scripts make it mechanical rather than aspirational; **26 checklist items
are marked `[auto]`**, and the rest stay human because they are judgement
calls, not leftovers.

`scripts/gate.mjs` is the one command that runs the rest. It discovers `design/`
and every `apps/*/src` from the conventions, so only a rendered target has to be
named. A step it could not run prints `SKIP` and is never folded into the pass
count — a partial run reported as a clean one is worse than no gate, because it
is believed.

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
correct code is one people learn to skip. Three of its eleven rules serve the
hero: `100vh` where `100svh` was meant, `three` imported into a Next route file
instead of behind `next/dynamic`, and a canvas animation with no
`prefers-reduced-motion` path — the last catching a hand-rolled 2D particle
loop as well as WebGL, since a rule that only knew about `three` would miss the
case the skill actually prescribes.

Flutter used to get one of those rules and pass everything else by default. It
now has its own four: a bare `Colors.blue` (the Dart hardcoded colour, and more
common than a hex because it reads like an API rather than a literal),
`MediaQuery.size` used as a breakpoint where `LayoutBuilder` belongs, an
`Image.*` with neither `semanticLabel` nor `excludeFromSemantics`, and a
`GestureDetector` tap handler that exposes no role to a screen reader.

`scripts/responsive-check.mjs` loads the page in Chromium at 320, 768 and 1280
in both colour schemes, plus **740×360 — a phone held sideways**, which is the
only probe short enough to catch a `height: 100vh` hero eating its own CTA. It
catches what reading a stylesheet cannot: a fixed-width element pushing the page
sideways at 320, tap targets under 44px as actually laid out, form controls
under 16px (below which iOS zooms on focus), and a dark block that was written
but never wired — detected by comparing the rendered body under each scheme.

It also checks **contrast as painted**, which is a different question from the
one `contrast.mjs` answers. That one checks token against token in the file; it
cannot see a token used against a background it was never paired with, a
foreground at reduced opacity, or a dark rule overridden by a later rule of
equal specificity. Backgrounds are composited through transparency to get the
real pair. Anything that cannot be resolved — text on a photograph or a
gradient — is reported for a human and **never fails the run**, because a
contrast checker that cries wolf over every gradient gets switched off in a
week.

Content inside an `overflow-x:auto` container and inline links in body copy are
exempt, because both are the prescribed pattern. Playwright is not bundled: the
script resolves it from the project or a global install and exits 3 with an
explanation when absent — which `gate.mjs` reports as a skip, not a pass.

`scripts/tokens-dart.mjs` generates the Flutter palette from the CSS master.
The skill always said `tokens.dart` was "generated, never hand-maintained
beside it"; until this existed nothing generated it, so the rule was violated in
the same breath it was stated. `--check` is in the gate, because a generator
nobody re-runs is the same as no generator. `.dark` normally lists only what it
*overrides*, so dark is layered onto light rather than emitted alone — the
alternative leaves holes where the CSS has none.

`scripts/freeze-check.mjs` makes the frozen design rule checkable. It records a
fingerprint of the palette inside `design-system.md`, then answers one question
on every run: does `tokens.css` still hold the palette that document describes?
Reordering and reformatting are not restyles and do not move the fingerprint; a
changed value does. A silent token edit otherwise leaves the written rationale
explaining colours that are no longer there, and the next session inherits an
argument for a design it cannot see.

There is no separate gateway. Coolify's Traefik is the only ingress — a proxy
doing on-demand TLS would have to own `:443`, which Traefik already does.

[promax]: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
[emil]: https://github.com/emilkowalski/skills

### `appsotech-audit`

Runs the [13-Layer App Audit](docs/app-audit.md) against a codebase.
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

    .claude-plugin/marketplace.json     what /plugin marketplace add reads
    .claude/skills/ui-ux-pro-max/       vendored third-party — see its VENDORED.md
    docs/app-audit.md                   the 13-Layer App Audit methodology
    plugins/<theme>/                    the published plugins
    LICENSE  README.md

Everything we publish lives under `plugins/`. The two directories beside it
are deliberately not skills: `docs/` is prose for a human to read, and
`.claude/` configures sessions working *in this repository* rather than
anything a user installs.

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

`.github/workflows/tests.yml` runs both suites on push and pull request across
Node 22 and 24, with Go and Playwright installed so nothing skips: the
browser-backed responsive tests skip silently when Playwright is absent, so the
workflow asserts it resolved before running anything. A weekly job runs the
whole suite five times over — a timing assertion with a thin margin passes most
of the time, and one green tick does not distinguish it from a sound one.

## Licence

MIT © Appsotech Limited
