# Report templates

This file carries §3, §6 and §7 of the source methodology verbatim: the
layer ownership map, the findings-register field schema, the P0–P3 severity
definitions, the remediation-sequencing override rules, and the seven-part
report structure. The ownership map is included here (rather than left only
in the full source) so that arbitrating an overlapping finding never
requires loading the 26KB source document.

## Layer ownership map

Several tiers overlap in practice. Findings must land in exactly one layer or they get double-counted or dropped. Use this map to arbitrate.

| Concern | Owned by | Not by |
|---|---|---|
| Where the app runs and how it gets there | 5 Hosting/deployment | 6 Cloud/compute |
| Which resources exist, sized how, at what cost | 6 Cloud/compute | 5 Hosting/deployment |
| Abuse prevention and quota enforcement | 9 Rate limiting | 8 Security |
| Authorisation policy at the data layer | 8 Security/RLS | 4 Auth/permissions |
| Identity, sessions, and role model | 4 Auth/permissions | 8 Security/RLS |
| Capacity headroom and elasticity | 11 Load balancing/scaling | 6 Cloud/compute |
| Detection and diagnosis of failure | 12 Error tracking/logs | 13 Availability/recovery |
| Restoration after failure | 13 Availability/recovery | 12 Error tracking/logs |

## 6. Findings register

Every finding is a row. The register, not the narrative, is the deliverable engineers work from.

| Field | Content |
|---|---|
| **ID** | `F-001` |
| **Layer / Probe** | `8 / 8.3` |
| **Title** | One line, states the condition not the fix |
| **Severity** | P0–P3 (below) |
| **Hard gate** | `G2` or blank |
| **Evidence** | What was observed, where, when — reproducible |
| **Impact** | The realistic consequence if unaddressed |
| **Likelihood** | High / Medium / Low |
| **Effort** | S / M / L |
| **Recommendation** | Specific, actionable, technology-appropriate |
| **Owner** | Named individual |
| **Target date** | Date |
| **Status** | Open / Accepted risk / In progress / Closed / Verified |

### Severity definitions

| Severity | Definition | Expected response |
|---|---|---|
| **P0** | Active exposure of data, funds, or availability; or a hard gate triggered | Immediate — halt other work |
| **P1** | Material risk that will be realised under plausible conditions | Within the current cycle |
| **P2** | Weakness that degrades reliability, maintainability, or cost | Next planning cycle |
| **P3** | Improvement worth making; no near-term risk | Backlog |

### Remediation sequencing

Order by impact against effort, but override the ordering for two categories: anything triggering a hard gate goes first regardless of effort, and anything that is cheap and reduces blast radius (rotating an exposed key, adding a rate limit, enabling MFA) goes early because it buys time for the expensive work.

## 7. Report structure

1. **Cover** — system, commit, environment, date, auditor, overall score, band, hard gates triggered
2. **Executive summary** — one page, no jargon, leads with the P0s and what they mean commercially
3. **Scorecard** — the thirteen layers with scores, weights, and a one-line verdict each
4. **Findings register** — full table, sorted by severity
5. **Remediation plan** — sequenced, with owners and dates
6. **Evidence appendix** — everything needed to reproduce the assessment
7. **Re-audit date** — set it in the report, or it will not happen

## Executive summary template

This section is new to this file, not carried from the source methodology
document like §3, §6 and §7 above — the source's own §8 is "Re-audit
cadence", a different topic, so this section is deliberately left unnumbered
rather than reusing "§8" for something else. Reference it by name
("the executive summary template"), not by number.

This is the one page of the whole audit a founder, board member or client
sponsor actually reads. They are deciding whether to spend money — on
engineering time, on a delayed launch, on a security fix — not reviewing
engineering work. Write for that reader:

- **No probe IDs** (`8.3`), **no layer numbers** (`Layer 8`), **no evidence
  jargon** (`attested`, `inspected`, `demonstrated`, `class`, `gate`). If a
  sentence needs a probe ID to make sense, rewrite the sentence.
- Say what a finding **means**, not what is technically wrong. Not "no RLS
  policy on the `orders` table" — instead "any signed-in user can currently
  read every other customer's orders, including names and addresses."
- Every P0 gets a plain consequence: money, customers, legal exposure,
  downtime, reputation. If you can't state the consequence in one sentence,
  you haven't finished translating it yet.
- Length: one page. If the findings register has twelve P0s, group and
  summarise them by consequence ("customer data is exposed in three
  separate ways") rather than listing all twelve.

**If the scorecard says PARTIAL AUDIT, this page opens by saying so** — a
first line before the gates and before the findings, naming which layers were
not examined and stating that the figure is not comparable to a complete
audit. Everywhere else the reader can see the shortfall: the scorecard cover
carries it, `scorecard.json` records it, the terminal printed it. This page is
the one that travels on its own, to the reader least able to discover the gap
for themselves, and a clean-looking summary drawn from a partial scorecard is
the most misleading artefact this skill can produce.

> **This audit is incomplete.** We examined [n] of the 13 layers; [list what
> was not covered] were not assessed. The score below reflects only what was
> examined and should not be read as an overall verdict on the system.

Fill in every bracket below with real content — this is a structure to
write into, not a heading skeleton to leave blank.

```markdown
# Executive Summary — [System name]

**Date:** [YYYY-MM-DD]   **Prepared by:** [Auditor]   **Covers:** [environment, e.g. production]

## Bottom line

[2–4 sentences. Is this safe to launch / keep running / hand to a client,
right now, without changes? State the single biggest risk in plain terms —
what would actually go wrong, and for whom. Do not lead with the score;
lead with the consequence. Example: "This system should not go live yet. A
gap in how it checks permissions means any customer could read another
customer's private data by guessing a web address. That is a data-breach
risk, not a hardening nice-to-have."]

## What must be fixed before anything else

[One short paragraph or bullet per P0 / hard-gate finding, ordered by
consequence not by where it lives in the system. For each one:
  - what can go wrong, in plain language
  - who is affected and how (customers, the business, regulators)
  - roughly how urgent — "this could be exploited today by anyone with a
    browser" reads very differently from "this requires insider access"

If a hard gate fired (a small number of conditions serious enough to cap
the whole assessment regardless of everything else that's working well —
e.g. an unverified backup, exposed credentials, no rate limit on login),
say so here in one sentence per gate, in plain language, without naming it
as "G1" or "a gate": "We could not confirm backups have ever been
successfully restored — if the database were lost today, there is no
verified way to get customer data back." This is what caps the grade below
regardless of how good the rest of the system is, and the reader needs to
know that before they read the number.]

## Overall picture

[State the band in plain language, then the number, in that order — the
reader should understand the verdict before the score. Translate the band
name if it's still jargon-sounding for this audience:

- Production-hardened → "holds up well under failure and growth"
- Production-ready → "solid, with specific known gaps and owners"
- Serviceable → "works today but is fragile under load or an incident"
- At risk → "meaningful chance of data loss, a breach, or a long outage"
- Not production-viable → "not ready for real users yet"

One sentence on what drove the grade down, if anything did, in the same
plain language as above — not a repeat of the findings list.]

## What to do first

[The 1–3 actions that happen before anything else, in the order they
should happen — not the full remediation plan, just its head. Prefer
anything cheap that reduces exposure quickly (rotating a leaked key,
turning on two-factor login for admins, adding a login rate limit) ahead
of expensive work, because it buys time safely while the bigger fixes are
underway. State a rough size for each — days, weeks, or a quarter — so the
reader can weigh it against the risk above.]

## Next check-in

[The re-audit date, and in one sentence what "better" will look like by
then — this is a commitment, not a formality; a report with no date here
means no one is accountable for the fixes actually happening.]
```
