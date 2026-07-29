# Scoring model

This file carries §2 of the source methodology verbatim: the maturity scale,
the evidence-class rule, the layer-score and weighted-overall formulas, the
default weight table, the eight hard gates, and the five readiness bands.
Use it alongside whichever `rubric-layers-*.md` file covers the layers in
scope for this pass.

## Evidence classes

**Evidence over assertion.** Every probe is scored from evidence, not from
what someone says is true. Three evidence classes, in descending order of
trust:

| Class | Example | Trust |
|---|---|---|
| **Demonstrated** | A restore performed in front of you; a rate limit tripped live | Highest |
| **Inspected** | Config file, IAM policy, dashboard, pipeline definition | High |
| **Attested** | "Yes, we have backups" | Lowest — score capped at 2 |

An attested-only answer cannot score above **2**. This single rule prevents most audit theatre.

## 2.1 Maturity scale (per probe)

| Score | Level | Meaning |
|---|---|---|
| **0** | Absent | No evidence the concern is addressed at all |
| **1** | Ad hoc | Handled manually and inconsistently; depends on specific individuals |
| **2** | Defined | Documented and mostly followed; breaks down under load or at edges |
| **3** | Managed | Enforced by tooling, measured, exceptions are visible |
| **4** | Optimised | Enforced, measured, *tested against failure*, and improved on a cadence |

`N/A` is permitted but must carry a justification. N/A probes are excluded from the denominator.

The gap between 2 and 3 is the one that matters most: it is the difference between a practice that exists and a practice that cannot silently lapse.

## 2.2 Layer score

`Layer score = (sum of probe scores ÷ (4 × number of applicable probes)) × 100`

## 2.3 Weighted overall score

Default weights below. **Re-weight for context** — a fintech handling customer funds should push auth, security and availability higher; an internal admin tool can drop them.

| # | Layer | Default weight |
|---|---|---|
| 1 | Front-end foundations | 6 |
| 2 | APIs / back-end logic | 10 |
| 3 | Database / storage | 10 |
| 4 | Auth / permissions | 12 |
| 5 | Hosting / deployment | 7 |
| 6 | Cloud / compute | 6 |
| 7 | CI/CD | 7 |
| 8 | Security / RLS | 12 |
| 9 | Rate limiting | 5 |
| 10 | Caching / CDN | 5 |
| 11 | Load balancing / scaling | 6 |
| 12 | Error tracking / logs | 7 |
| 13 | Availability / recovery | 7 |
| | **Total** | **100** |

`Overall = Σ (layer score × weight) ÷ Σ (weight of layers with at least one applicable probe)`

The divisor is 100 whenever every layer applies, which is the common case. It shrinks when an entire layer is `N/A` — a static site with no database, an on-premises tool with no cloud tier. This extends the `N/A` rule above to the layer level: an inapplicable layer is excluded from the denominator rather than scored as zero. Without it, a system that legitimately has no Layer 3 could never exceed 90, which would penalise it for a tier it was never meant to have.

## 2.4 Hard gates

Averages hide catastrophes. A stack with an unverified backup can still average 78%, which is a lie. The following findings **cap the overall score at 49 regardless of the weighted average**, and must be stated on the cover page:

- **G1** — No restore from backup successfully performed in the last 90 days
- **G2** — Client-reachable tables holding user data with no row-level security or equivalent server-side authorisation
- **G3** — Secrets present in version control history, build logs, or client bundles
- **G4** — No tested rollback path for a production deployment
- **G5** — Unredacted PII or credentials flowing into logs or the error tracker
- **G6** — Any administrative account without MFA, or a shared admin credential
- **G7** — No rate limiting on authentication or password-reset endpoints
- **G8** — A production dependency with a known critical CVE and no compensating control

**G3 fires on found secrets, not on absent scanning.** It is evidence-based: probe 1.4 fires it when a secret is actually inspected in history, build logs, or a built bundle. A missing or absent dependency/secret scanner (probe 7.4) is a detection gap — it makes exposure *undetected*, not demonstrated — so it is scored at 7.4 and does not itself gate.

## 2.5 Readiness bands

| Band | Score | Interpretation |
|---|---|---|
| **Production-hardened** | 85–100 | Withstands failure and growth; audit for drift annually |
| **Production-ready** | 70–84 | Sound; specific gaps documented with owners |
| **Serviceable** | 55–69 | Works today, fragile under load or incident |
| **At risk** | 40–54 | Material likelihood of data loss, breach, or extended outage |
| **Not production-viable** | <40 | Remediate before onboarding further users |
