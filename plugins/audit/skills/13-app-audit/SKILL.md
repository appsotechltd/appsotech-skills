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
gates, and writes a scorecard, an executive summary, findings register and
remediation plan into `audit/<date>/` in the **target** repository (not this
skill's repository).

**Do not score from the README or from what anyone tells you.** Evidence class
decides the ceiling: `attested` answers are capped at 2 by the scorer, and the
cap is not negotiable. Collect first, score second.

## Paths

Two roots are in play. **`<targetDir>` and everything under
`<targetDir>/audit/`** belong to the system being audited. **`scripts/…` and
`references/…`** belong to this skill, wherever it is installed.

**Do not `cd` into the skill directory to run the collectors.** Doing that and
passing a relative target — `.`, say — silently audits *the skill itself* and
writes a complete-looking evidence file with 30-odd facts and no error. Resolve
the scripts once instead, and stay where the auditor is:

```bash
for base in \
  "$CLAUDE_PLUGIN_ROOT/skills/13-app-audit/scripts" \
  "$HOME/.claude/skills/13-app-audit/scripts" \
  ".claude/skills/13-app-audit/scripts"; do
  [ -f "$base/score.mjs" ] && SCRIPTS="$base" && break
done
echo "${SCRIPTS:-NOT FOUND}"
```

Every `node "$SCRIPTS"/…` below means the directory resolved above. If it did
not resolve, say so and stop — the collectors are the evidence, and an audit
that skips them is Phase 4 interview with extra steps.

Load each reference file only when its phase says to; a run that stops after
Layer 4 must never load the Layer 5–13 rubric.

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
node "$SCRIPTS"/collect-static.mjs <targetDir> --out <targetDir>/audit/<date>/evidence/static.json
```

Run the live collector only if the auditor gave you a reachable URL:

```
node "$SCRIPTS"/collect-live.mjs --url <baseUrl> [--auth-path <p>] --out <targetDir>/audit/<date>/evidence/live.json
```

Add `--probe-rate-limit` to burst-test the auth endpoint (`--auth-path`, or
the base URL if none given) for probe 9.1, and `--i-own-this` to confirm you
are authorised to load-test that host. Without `--i-own-this`, any host that
isn't `localhost` / `127.0.0.1` / `[::1]` / `0.0.0.0` is refused — this is a
safety guard, not a bug: a 20-request burst at a stranger's `/login` is
DoS-adjacent. If the auditor doesn't own the target host, leave the flag off
and accept that 9.1 will be `unavailable`.

Tier 3 is direct inspection of whatever the target actually runs on — not a
fixed vendor list. It has two forms:

**Direct database inspection**, whenever a Postgres connection is available
(a `PGURL`, or the standard `PGHOST`/`PGDATABASE`/`PGUSER` variables `psql`
already reads — see the collector's own usage text for the full precedence
order). Requires `psql` 12 or later (for `--csv` output) on PATH. Prefer a
read-only database role for the connection; every query the collector runs
is also wrapped in its own read-only transaction with a statement timeout
and `-X`/`--no-psqlrc` (so a start-up file on the connecting account cannot
alter output or print anything), but a least-privilege role is still the
right input, not a substitute for one:

```
node "$SCRIPTS"/collect-db.mjs [--dsn <connstring>] --out <targetDir>/audit/<date>/evidence/db.json
```

This evidences 8.1 from `pg_class`/`pg_policies` as it actually stands on the
running database — not as migration files intend it to be — plus 3.2 (index
usage), 3.4 (constraint coverage) and 3.8 (connection headroom). A `--dsn`
value lands in your shell history (and is visible to other users on the same
machine via the process list); the environment does neither, so prefer it.

**`db.json`'s 8.2 rows are a policy inventory (cmd, roles, and whether USING
/ WITH CHECK meaningfully constrain each policy) — context to help judge 8.1,
not the "policy test suite, a demonstrated denial" the 8.2 rubric row itself
asks for.** No collector attempts an authenticated read/write as a specific
role and observes an actual denial; that's still Phase 4 interview or a real
test suite. Score 8.2 from `db.json` no higher than `inspected` class allows
for a config-inspection claim, and don't let it stand in for a demonstrated
negative-case test.

**Whatever MCP connectors happen to be authorised this session** — Supabase,
Vercel and Cloudflare are common examples, not the definition of this tier,
and the auditor may have none of them or a different one entirely. If one is
authorised, use it directly (table/RLS inspection, advisors, deployments,
logs) and write what you find as an evidence-shaped document — `{ tier,
collectedAt, facts, unavailable }`, with a `class` on every fact — to
`<targetDir>/audit/<date>/evidence/mcp-<provider>.json`. There is no CLI for
this half of the tier; it's you, reading tool output and recording facts,
never scores.

Record what ran in `<targetDir>/audit/<date>/evidence/tiers.json`:

```json
{
  "static": { "available": true },
  "live":   { "available": false, "reason": "no URL supplied", "affects": ["8.5", "8.7", "9.1", "10.3"] },
  "db":     { "available": false, "reason": "no PGURL/--dsn given and no PG* environment set", "affects": ["8.1", "8.2", "3.2", "3.4", "3.8"] }
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
in this file: 101 probes, up to four evidence documents and the target's own
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
schema, severities, remediation sequencing, report structure, executive
summary template) — this is the only phase that needs it.

Run the scorer:

```
node "$SCRIPTS"/score.mjs <targetDir>/audit/<date>/scores.json --out <targetDir>/audit/<date>
```

This writes `scorecard.json` and `SCORECARD.md`, and prints coverage, the
overall, band, any fired gates, and the unverified count. **A gate firing caps
the overall at 49 regardless of how high the weighted average is — read the
cover block, not the layer table, for the real verdict.**

**A partial `scores.json` gets no band and exits 1.** The weighted overall
renormalises over the layers that are present, so four layers scored well read
as 100 — and Phase 3 writes `scores.json` after every layer group, which makes
a half-finished file the normal state on disk. The scorer refuses rather than
reporting it as a verdict, and the cover says `PARTIAL AUDIT` with the
coverage counts.

If you genuinely want an interim scorecard mid-audit, pass `--partial`. It
still writes the files and still reports no band — the flag acknowledges the
gap, it does not fill it. Do not reach for it to make a red exit go away at the
end of a run; finish the layer groups.

`scores.json` must carry the five Phase 1 `scope` keys. The scorer exits 2
without them: a scorecard with no `ref` can never be re-audited against, which
is the whole reason Phase 1 refuses to substitute "latest" for a real one.

Re-auditing against a prior baseline:

```
node "$SCRIPTS"/score.mjs <targetDir>/audit/<date>/scores.json --baseline <targetDir>/audit/<prior-date>/scorecard.json --out <targetDir>/audit/<date>
```

appends a per-layer movement table and a gates-opened/gates-closed section to
`SCORECARD.md`.

Then write, by hand, into `<targetDir>/audit/<date>/`:

- **`EXECUTIVE-SUMMARY.md`** — one page, no jargon: no probe IDs, no layer
  numbers, no evidence-class vocabulary. Written for a founder or client
  sponsor deciding whether to spend money, not the engineer who will do the
  work. Leads with any hard gates that fired and the P0 findings, each
  translated into what it means commercially (money, customers, legal
  exposure, downtime) rather than technically, then the band in plain
  language and what to do first. Use the executive summary template in
  `references/report-templates.md`, and write it last — after
  `FINDINGS.md` and `REMEDIATION.md` exist below, since it draws its content
  from both.
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
  evidence/  static.json  live.json  db.json  mcp-*.json  tiers.json
  scores.json
  scorecard.json  SCORECARD.md
  EXECUTIVE-SUMMARY.md
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
- **Several tests shell out to real `npm` and `go` on PATH** — deliberate
  integration tests, no mocking. Only two of them actually require `go`
  specifically (measured by stripping it from PATH and re-running):
  `go list runs and reports a real result for the go root`, and
  `govulncheck absence on a root where go list already succeeded reconciles
  into a fact, never unavailable (existing 8.4 contract)` (its fixture
  relies on `go list` succeeding so the govulncheck failure has other 8.4
  evidence to be reconciled against). `npm audit is actually invoked` and
  `a partial npm audit failure across roots reconciles` need `npm`, not
  `go`, and still pass with Go absent. Contributors without Go installed
  will see exactly those 2 failures; that's expected, not a regression in
  this skill.
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
