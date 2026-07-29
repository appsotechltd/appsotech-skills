# Appsotech Skills

Skills for Claude Code, published by Appsotech Limited.

## Install as a plugin

    /plugin marketplace add appsotechltd/appsotech-skills
    /plugin install audit@appsotech

## Install by copying

    cp -r plugins/audit/skills/13-app-audit ~/.claude/skills/

On Windows (PowerShell):

    Copy-Item -Recurse plugins\audit\skills\13-app-audit $HOME\.claude\skills\

## Skills

### `13-app-audit`

Runs the [13-Layer App Audit](13-app-audit/app-audit.md) against a codebase.
101 probes across 13 layers, scored 0–4 from collected evidence, weighted to a
single figure, with eight hard gates that cap the score at 49 when triggered.

Produces `audit/<date>/` containing a scorecard, a findings register with
reproducible evidence references, and a sequenced remediation plan.

Evidence is collected in three tiers: the repository always, a live URL when
supplied, and Supabase / Vercel / Cloudflare MCP connectors when authorised.
Probes that cannot be evidenced are capped at 2 and marked UNVERIFIED rather
than guessed.

## Repository layout

The marketplace has two levels. `.claude-plugin/marketplace.json` lists
**themed plugins** — each one a coherent area of concern (`audit`, one day
maybe `security`, `perf`). Each plugin holds **related skills** as sibling
folders under its own `skills/`:

    plugins/<theme>/.claude-plugin/plugin.json
    plugins/<theme>/skills/<skill-name>/SKILL.md

`plugins/audit/` is the current example: the plugin is the theme, and
`skills/13-app-audit/` is one skill within it. A second audit-flavoured skill
(a security review, a dependency audit) would sit alongside it as
`plugins/audit/skills/<new-skill>/`, sharing the same plugin/version.

### Adding a skill

- **New skill in an existing theme:** add a folder under
  `plugins/<theme>/skills/`. No marketplace change needed.
- **New theme:** add `plugins/<theme>/` with its own
  `.claude-plugin/plugin.json`, plus an entry for it in
  `.claude-plugin/marketplace.json`.

## Contributing

Issues and pull requests welcome. Skills live under `plugins/<plugin>/skills/`.
Run tests with `node --test plugins/audit/skills/13-app-audit/tests/*.test.mjs`.

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
