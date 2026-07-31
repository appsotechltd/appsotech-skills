# Vendored — not our code

This directory is a copy of a third-party skill. Do not edit anything in it;
edits are lost on the next update and there is nowhere upstream for them to go.

| | |
|---|---|
| Upstream | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| Version | 2.11.0 |
| Commit | `4857a2c5ef989794751a0f66b8545a4a49566286` |
| Licence | MIT © Next Level Builder — see `LICENSE` in this directory |
| Vendored | 2026-07-30 |

## What was taken, and what was not

Only the `ui-ux-pro-max` skill, which is the one `appsotech-stack` queries —
1.9 MB across 45 files, against 17 MB for the whole upstream repository.

The upstream plugin also ships six sibling skills — `design`, `design-system`,
`brand`, `banner-design`, `slides`, `ui-styling` — deliberately left behind.
They are not used here, `ui-styling` alone is 5.8 MB, and every extra skill in a
session is another description competing to trigger.

## Why vendored rather than installed as a plugin

The plugin route works — `git clone` of the upstream repository succeeds under
the cloud network policy, verified. What could not be verified from inside a
session is whether Claude Code's plugin loader takes that same path at session
start. Vendoring removes the question: the search script is on disk, so tier 1
is available with no fetch at all.

The cost is the one the original policy named: **a fork goes stale.** Upstream
is actively maintained, and this copy is frozen at 2.11.0 until someone updates
it deliberately.

## Updating

```bash
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill /tmp/promax
rm -rf .claude/skills/ui-ux-pro-max
cp -r /tmp/promax/.claude/skills/ui-ux-pro-max .claude/skills/
cp /tmp/promax/LICENSE .claude/skills/ui-ux-pro-max/LICENSE
# then update the version, commit and date in this file
```

Check the upstream CHANGELOG before updating: the `search.py` CLI is a contract
this repository depends on, and `appsotech-stack`'s Phase 5 encodes its exact
form — a positional query, `-d`, `-s`, `-n`, `--json`. A breaking change there
is a breaking change here.

## Where this copy does and does not help

It is on disk **in this repository**, so a session working here resolves tier 1
immediately. `appsotech-stack` runs against *other* projects, and its resolver
looks in the target project first — so a target project needs its own copy, or
the plugin installed, to reach tier 1. Without either, that project falls to
tier 3 and the twelve curated directions, which is a designed outcome rather
than a failure.
