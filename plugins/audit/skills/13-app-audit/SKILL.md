---
name: 13-app-audit
description: >
  Audit a software stack across 13 architectural layers — frontend, API,
  database, auth, hosting, cloud, CI/CD, security/RLS, rate limiting,
  caching, scaling, observability, availability. Use when asked to audit,
  assess, score, or review a codebase or app; to check production-readiness
  or hardening; to find security, reliability or cost gaps; or to re-audit
  against a previous baseline. Produces a weighted score, hard-gate verdict,
  findings register and sequenced remediation plan.
---

# 13-Layer App Audit

Scores 101 probes across 13 layers from collected evidence, applies eight hard
gates, and writes a scorecard, findings register and remediation plan into
`audit/<date>/` in the **target** repository (not this skill's repository).

**Do not score from the README or from what anyone tells you.** Evidence class
decides the ceiling: `attested` answers are capped at 2 by the scorer, and the
cap is not negotiable. Collect first, score second.

All paths below are relative to this skill's own directory — wherever it is
installed (`plugins/audit/skills/13-app-audit/` inside this repository
when run as a plugin, or `~/.claude/skills/13-app-audit/` when copy-installed
per the README) — run commands from there. Load each reference file only
when its phase says to; a run that stops after Layer 4 must never load the
Layer 5–13 rubric.

## Phase 1 — Scope

**The run does not proceed without a reference point.** If the target is a
git repository:

```
git -C <targetDir> rev-parse --short HEAD
```

and record the output as `ref`. If it is not a git repository, or that command
fails, ask the auditor for an explicit `ref` string — a build number, release
tag, or dated snapshot identifier — and record it verbatim. An audit with no
fixed reference point can never be re-run for comparison; do not substitute
"today's date" or "latest" for a real one.

Also pin: **system** name, **environment** (production/staging/…), **date**
(`YYYY-MM-DD`, also the artifact directory name), and **auditor**. Confirm the
default layer weights below or ask the auditor to re-weight for context (a
fintech pushes auth/security/availability higher; an internal tool can drop
them) — they must sum to 100. If you re-weight, carry the custom map forward
into `scores.json`'s top-level `weights` key in Phase 3 — that is what
`score.mjs` actually reads; the table below is only the default it falls back
to when that key is absent.

| Layer | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Weight | 6 | 10 | 10 | 12 | 7 | 6 | 7 | 12 | 5 | 5 | 6 | 7 | 7 |

Write `<targetDir>/audit/<date>/scope.json`:

```json
{
  "system": "acme-app",
  "ref": "d220421",
  "environment": "production",
  "date": "2026-07-29",
  "auditor": "Jane Doe"
}
```

These five keys are exact. The scorecard renderer reads `system`, `ref`,
`environment`, `date`, `auditor` from `scope` and nothing else — `commit`
instead of `ref`, or `env` instead of `environment`, renders that field blank
on the cover with no error.

## Phase 2 — Collect

Run the static collector always:

```
node scripts/collect-static.mjs <targetDir> --out <targetDir>/audit/<date>/evidence/static.json
```

Run the live collector only if the auditor gave you a reachable URL:

```
node scripts/collect-live.mjs --url <baseUrl> [--auth-path <p>] --out <targetDir>/audit/<date>/evidence/live.json
```

Add `--probe-rate-limit` to burst-test the auth endpoint (`--auth-path`, or
the base URL if none given) for probe 9.1, and `--i-own-this` to confirm you
are authorised to load-test that host. Without `--i-own-this`, any host that
isn't `localhost` / `127.0.0.1` / `[::1]` / `0.0.0.0` is refused — this is a
safety guard, not a bug: a 20-request burst at a stranger's `/login` is
DoS-adjacent. If the auditor doesn't own the target host, leave the flag off
and accept that 9.1 will be `unavailable`.

If Supabase / Vercel / Cloudflare MCP connectors are authorised this session,
use them directly (table/RLS inspection, advisors, deployments, logs) and
write what you find as an evidence-shaped document — `{ tier, collectedAt,
facts, unavailable }`, with a `class` on every fact — to
`<targetDir>/audit/<date>/evidence/mcp-<provider>.json`. There is no CLI for
this tier; it's you, reading tool output and recording facts, never scores.

Record what ran in `<targetDir>/audit/<date>/evidence/tiers.json`:

```json
{
  "static": { "available": true },
  "live":   { "available": false, "reason": "no URL supplied", "affects": ["8.5", "8.7", "9.1", "10.3"] }
}
```

A probe named in an unavailable tier's `affects[]` has no evidence to be
scored above `attested` — treat it the same as any other unevidenced probe in
Phase 3.

**On the first write under `<targetDir>/audit/`,** check the target's
`.gitignore` for an `audit/` entry and offer to add one if it's missing. A
findings register is a map of exactly how to attack the system — the default
must not be "commit it."

## Phase 3 — Judge

**Score one layer group at a time, and write `scores.json` after each
group.** This is not optional and it is the single most important instruction
in this file: 101 probes, three evidence documents and the target's own
source is too much to hold reliably in one pass — pushed through in one go,
scoring degrades quietly into plausible numbers backed by thin evidence, with
no error to flag it. The per-group flush resets context between groups and
means partial progress survives if the run is interrupted.

1. Read `references/rubric-layers-01-04.md` and `references/scoring.md`.
   Score every probe in Layers 1–4 against the collected evidence. Write
   `<targetDir>/audit/<date>/scores.json`.
2. Read `references/rubric-layers-05-09.md` (you already have `scoring.md`).
   Score Layers 5–9. Merge into `scores.json` — rewrite the whole file with
   the new probes added, don't leave Layers 1–4 behind.
3. Read `references/rubric-layers-10-13.md`. Score Layers 10–13. Merge into
   `scores.json` again.

`scores.json` needs a top-level `scope` (copied verbatim from Phase 1 —
`score.mjs` reads it straight from this file, not from `scope.json`) and a
top-level `probes` object. If Phase 1 re-weighted the layers, also add a
top-level `weights` object — one entry per layer number, summing to 100, same
shape as the Phase 1 table (`{"1": 6, "2": 10, ...}`) — and `score.mjs` will
score against it instead of the default table. Omit the key entirely to use
the default weights unchanged. Every probe entry:

```json
"8.3": {
  "score": 0,
  "class": "inspected",
  "evidence": ["dist/assets/index-a3f2.js:1:41207"],
  "note": "Service-role key reachable in client bundle.",
  "gate": "G2"
}
```

- `class` is `demonstrated`, `inspected`, or `attested`, in descending order
  of trust. **`attested` clamps the score to 2 in the scorer, and the clamp
  is not negotiable.** If all you have is someone's word, record `class:
  "attested"` honestly — do not round the class up to get the number you want.
- A probe with no supporting evidence at all gets `class: "attested"` and
  `unverified: true` — not a generous guess dressed up as `inspected`.
- `N/A` is permitted but requires `naJustification`; an unjustified `N/A` is a
  scorer error, not a skip.
- Carry the `gate` field (`G1`…`G8`) on every probe the gate table in
  `scoring.md` marks — the scorer reads it to decide which gates fired.

## Phase 4 — Interview

One consolidated round, after all three layer groups are scored — not one
round per group.

Collect every probe that is `attested`-class or has no evidence, **and** is
either capped by the class rule or gate-bearing. Present them together to the
auditor, each showing: the probe ID and text, the assumed answer / current
score, and the score consequence of confirming vs. not — e.g. "currently 2
(attested cap); a demonstrated restore in the last 90 days allows up to 4, and
if you can't produce one this also fires gate G1."

Update `scores.json` with whatever the auditor confirms. Anything left
unanswered stays `unverified: true` and held at 2 — do not chase a "yes" just
to clear a probe.

## Phase 5 — Report

Read `references/report-templates.md` (layer ownership map, findings-register
schema, severities, remediation sequencing, report structure) — this is the
only phase that needs it.

Run the scorer:

```
node scripts/score.mjs <targetDir>/audit/<date>/scores.json --out <targetDir>/audit/<date>
```

This writes `scorecard.json` and `SCORECARD.md`, and prints the overall,
band, any fired gates, and the unverified count. **A gate firing caps the
overall at 49 regardless of how high the weighted average is — read the
cover block, not the layer table, for the real verdict.**

Re-auditing against a prior baseline:

```
node scripts/score.mjs <targetDir>/audit/<date>/scores.json --baseline <targetDir>/audit/<prior-date>/scorecard.json --out <targetDir>/audit/<date>
```

appends a per-layer movement table and a gates-opened/gates-closed section to
`SCORECARD.md`.

Then write, by hand, into `<targetDir>/audit/<date>/`:

- **`FINDINGS.md`** — the findings register: one row per finding (ID,
  layer/probe, title, severity P0–P3, hard gate or blank, evidence, impact,
  likelihood, effort, recommendation, owner, target date, status), sorted by
  severity.
- **`REMEDIATION.md`** — sequenced by impact against effort, except: anything
  triggering a hard gate goes first regardless of effort, and anything cheap
  that reduces blast radius (rotate an exposed key, add a rate limit, enable
  MFA) goes early because it buys time for the expensive work. Set a re-audit
  date, or it won't happen.

The finished directory:

```
audit/<date>/
  scope.json
  evidence/  static.json  live.json  mcp-*.json  tiers.json
  scores.json
  scorecard.json  SCORECARD.md
  FINDINGS.md  REMEDIATION.md
```

## Gotchas

- **A fired gate caps the overall at 49 however high the weighted average
  is.** A stack can hold a weighted average above 90 and still report 49.
  Read the cover block, not the layer table.
- **No build output means no Layer 1 bundle evidence at all.** If the target
  has no `dist`/`build`/`.next`/`out` directory anywhere, probes 1.4 and 8.3
  land in `unavailable`, not scored zero. Run the target's build before
  auditing, or score both at 2 for lack of anything to inspect.
- **`collect-static.mjs` discovers project roots by marker file**
  (`package.json`, `go.mod`, a `Dockerfile`, or a build-output directory),
  walking up to 4 levels and never descending into `node_modules`/`.git`/
  `vendor`/build-output dirs. Pointing it at a monorepo root works — check
  the `meta.roots` fact in `static.json` to see what it actually covered,
  not just how many facts came back.
- **`npm audit` exits non-zero when it finds vulnerabilities.** The collector
  reads its stdout unconditionally regardless of exit code — that's data, not
  a failed run. Don't "fix" a non-zero exit you notice in a transcript.
- **`collect-live.mjs --probe-rate-limit` refuses non-localhost hosts without
  `--i-own-this`,** and the refusal costs the target its 9.1 evidence rather
  than being silent — it lands in `unavailable`, not `facts`. It also refuses
  to follow any cross-origin redirect during the burst at all (same-origin
  redirects are still followed): a decoy the guard approved cannot carry the
  burst onto a host it would have refused.
- **Probe 9.1 will not claim absent rate limiting from a thin sample.** Fewer
  than 10 conclusive responses out of the 20-request burst, and it records a
  gap instead of an absence claim — a limiter tripping within its normal
  range could simply never have been reached by a burst that mostly died as
  timeouts or refused redirects. A single 429 is still reported as fact at
  any sample size; only the *absence* claim needs the larger sample.
- **A leading-slash `--auth-path` (e.g. `/login`) run from Git Bash on
  Windows gets MSYS-mangled** into a Windows path (`C:/Program Files/Git/
  login`) before Node ever sees it, and the request silently fails. Use
  PowerShell, set `MSYS_NO_PATHCONV=1`, or double the leading slash.
- **`node --test <directory>` throws `MODULE_NOT_FOUND` on Node 24.** Always
  glob the files explicitly:
  `node --test plugins/audit/skills/13-app-audit/tests/*.test.mjs`.
- **Three tests shell out to real `npm` and `go` on PATH** (`npm audit is
  actually invoked`, `go list runs`, `a partial npm audit failure across
  roots reconciles`) — deliberate integration tests, no mocking. Contributors
  without Go installed will see 3 failures; that's expected, not a
  regression in this skill.
- **`card.scope` keys are exact:** `system`, `ref`, `environment`, `date`,
  `auditor`. Anything else renders that cover field blank, with no error to
  catch the typo.

**Gotchas from the first real-target run (a self-hosted Go/Postgres stack
behind an edge proxy):**

- **An unevidenced probe defaults to 0, not to the attested cap of 2.** Phase
  3's "attested clamps to 2" language is easy to over-read as "unevidenced
  probes are worth 2" — they are not. §2.1's own maturity scale defines 0 as
  "no evidence the concern is addressed at all," which is exactly the state
  of a probe you found nothing for. The 2-cap is a *ceiling* for a real but
  weak claim (a README saying "yes, we do backups"); it is not a floor or a
  default for silence. Score genuine silence at 0 (`class: "attested"`,
  `unverified: true`) and reserve 1–2 for an actual weak claim you can point
  to. Defaulting every gap to 2 "because that's what attested allows" is the
  exact audit-theatre failure the class system exists to prevent, and it is
  the single easiest way to fail this skill's own dogfood test.
- **`score.mjs` used to have no working path to re-weight layers, despite
  Phase 1 asking for one.** It called `scoreAudit(JSON.parse(...))` with no
  second argument, so `opts.weights` was always `undefined` and the scorer
  silently fell back to the hardcoded default `WEIGHTS` table regardless of
  what an auditor was told. Fixed: `score.mjs` now reads an optional
  top-level `weights` object from `scores.json` (see Phase 3) and passes it
  through to the scorer. Omit the key to use the default table; if you add
  it, still check the reported `weightedOverall` actually moved before
  promising an auditor their re-weighting took effect — a habit worth keeping
  regardless of which version of `scoring.mjs` is running.
- **The `gate` field you write on a probe in `scores.json` is decorative.**
  `firedGates()` and `scoreAudit()`'s per-probe output both derive the gate
  purely from the hardcoded `GATE_PROBES` map keyed by probe ID, keyed off
  `score !== 0` — neither ever reads `entry.gate` from your input. Carrying
  the field is harmless and matches the documented format, but don't spend
  effort double-checking it against `scoring.md`'s gate table for the
  scorer's sake; it changes nothing about which gates fire.
- **`collect-static.mjs`'s own "N facts, 0 gaps" line only covers the ~10
  probes it's wired to populate** (currently 1.4, 1.7, 3.3, 5.5, 7.1, 7.3,
  7.4, 7.5, 8.3, 8.4, plus the `meta.roots` coverage note) — it says nothing
  about the other ~90 probes in the 101-probe rubric, which have no
  collector at all and depend entirely on you reading the target's own
  source against each rubric row's "Evidence to collect" column. "0 gaps"
  reads like "fully covered"; it means "fully covered for the handful of
  probes this script knows about." Don't let a clean collector run lower
  your guard on Phase 3.
- **A meaningful slice of the rubric is structurally interview-only and no
  CLI or MCP connector will ever answer it**, live tier or not: whether a
  restore has actually been run in the last 90 days, RTO/RPO figures,
  pen-test history, on-call routing, cost tracking, a SPOF register,
  post-incident reviews. Neither collector queries a ticketing system, a
  calendar, or a person's memory. Recognise these early in Phase 2 rather
  than hunting for a static or live signal that structurally cannot exist,
  and route them straight to the Phase 4 interview list.
- **Verify the target's actual platform before writing `tiers.json` — don't
  trust what the audit brief says it runs on.** This run was briefed as
  Supabase-backed; the codebase showed a self-hosted Postgres+Go backend.
  `tiers.json` has no documented way to say "this connector doesn't apply to
  this stack" as distinct from "not authorised this session" or "unavailable,
  no URL" — pick a `reason` string that says which one it actually is, and
  confirm the platform from evidence, not from the brief, before you do.
- **Phase 1's `ref` capture doesn't ask you to check working-tree
  cleanliness or branch, but `collect-static.mjs` scans the live filesystem,
  not git objects.** A dirty tree (untracked files, an unmerged feature
  branch as HEAD) means the recorded `ref` and what was actually scanned can
  silently diverge — the collector will happily pick up files that aren't
  part of that commit. Run `git status --short` alongside the `rev-parse`
  and note any divergence (dirty tree, non-`main`/`master` HEAD) next to
  `ref` in your own commentary; the schema doesn't have a field for it, but
  a reader comparing this audit to a future one needs to know.
- **A static-only audit of rate limiting / TLS / security headers has a
  structural blind spot when the edge proxy's config isn't in the repo.**
  On a VPS stack, HAProxy or nginx often terminates TLS and could carry a
  rate limiter, but if its config lives only on the host, static evidence
  can confirm absence in the app layer and in whatever proxy config *is*
  versioned, but can't fully rule out something configured out-of-repo. Say
  so explicitly in the probe's note rather than reporting a flat "no rate
  limiting" as if it were exhaustive — and treat the config not being in the
  repo as its own IaC finding (Layer 5).
- **`SCORECARD.md`'s unverified-probes table used to say "held at 2"
  unconditionally for every row, regardless of the probe's actual score** —
  false whenever an unevidenced probe was correctly scored at 0 (per the
  first bullet above), which is the common case. Fixed in `render.mjs`: the
  table now has a Score column with each probe's own real, already-clamped
  value, and the prose no longer asserts a fixed number. Covered by a
  regression test (`tests/render.test.mjs`, "unverified table reports each
  probe's real score, not a hardcoded 'held at 2' claim").
- **Evidence `source` strings from `collect-static.mjs` use the host's path
  separator, which is a backslash on Windows** (e.g.
  `"backend\\migrations\\000009_add_reports.up.sql"` in `static.json`), while a
  citation written by hand elsewhere — in `scores.json`'s own `evidence[]`
  arrays, in `FINDINGS.md` — more naturally uses forward slashes. A reader
  who copies a citation from the findings register and greps `static.json`
  for it on Windows-collected evidence gets no match even though the fact is
  right there. Either normalise separators when citing collector-sourced
  evidence, or note the mismatch is expected.
