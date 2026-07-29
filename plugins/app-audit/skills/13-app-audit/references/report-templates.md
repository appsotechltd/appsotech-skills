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
