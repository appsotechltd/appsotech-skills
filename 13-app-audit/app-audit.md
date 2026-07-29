# The 13-Layer App Audit

A reusable instrument for evaluating a production software stack across thirteen architectural tiers. Designed to produce a defensible score, a prioritised findings register, and a remediation plan — not a wall of observations.

---

## 1. How to run it

**Scope first.** Name the system under audit, its version/commit, the environment being examined (production, unless stated), and the date. An audit without a fixed reference point cannot be re-run for comparison.

**Evidence over assertion.** Every probe is scored from evidence, not from what someone says is true. Three evidence classes, in descending order of trust:

| Class | Example | Trust |
|---|---|---|
| **Demonstrated** | A restore performed in front of you; a rate limit tripped live | Highest |
| **Inspected** | Config file, IAM policy, dashboard, pipeline definition | High |
| **Attested** | "Yes, we have backups" | Lowest — score capped at 2 |

An attested-only answer cannot score above **2**. This single rule prevents most audit theatre.

**Timeboxing.** A first pass on a small-to-medium stack runs 1.5–3 days: half a day of access setup and read-only inspection, a day of probing, half a day of write-up. Re-audits run in a third of the time once the register exists.

**Access needed.** Read-only production console access, repository read access, CI/CD history, observability dashboards, and one engineer available for a two-hour walkthrough. Request all of it before day one; access delays are the usual cause of a slipped audit.

---

## 2. Scoring model

### 2.1 Maturity scale (per probe)

| Score | Level | Meaning |
|---|---|---|
| **0** | Absent | No evidence the concern is addressed at all |
| **1** | Ad hoc | Handled manually and inconsistently; depends on specific individuals |
| **2** | Defined | Documented and mostly followed; breaks down under load or at edges |
| **3** | Managed | Enforced by tooling, measured, exceptions are visible |
| **4** | Optimised | Enforced, measured, *tested against failure*, and improved on a cadence |

`N/A` is permitted but must carry a justification. N/A probes are excluded from the denominator.

The gap between 2 and 3 is the one that matters most: it is the difference between a practice that exists and a practice that cannot silently lapse.

### 2.2 Layer score

`Layer score = (sum of probe scores ÷ (4 × number of applicable probes)) × 100`

### 2.3 Weighted overall score

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

The divisor is 100 whenever every layer applies, which is the common case. It shrinks when an entire layer is `N/A` — a static site with no database, an on-premises tool with no cloud tier. This extends the §2.1 rule to the layer level: an inapplicable layer is excluded from the denominator rather than scored as zero. Without it, a system that legitimately has no Layer 3 could never exceed 90, which would penalise it for a tier it was never meant to have.

### 2.4 Hard gates

Averages hide catastrophes. A stack with an unverified backup can still average 78%, which is a lie. The following findings **cap the overall score at 49 regardless of the weighted average**, and must be stated on the cover page:

- **G1** — No restore from backup successfully performed in the last 90 days
- **G2** — Client-reachable tables holding user data with no row-level security or equivalent server-side authorisation
- **G3** — Secrets present in version control history, build logs, or client bundles
- **G4** — No tested rollback path for a production deployment
- **G5** — Unredacted PII or credentials flowing into logs or the error tracker
- **G6** — Any administrative account without MFA, or a shared admin credential
- **G7** — No rate limiting on authentication or password-reset endpoints
- **G8** — A production dependency with a known critical CVE and no compensating control

### 2.5 Readiness bands

| Band | Score | Interpretation |
|---|---|---|
| **Production-hardened** | 85–100 | Withstands failure and growth; audit for drift annually |
| **Production-ready** | 70–84 | Sound; specific gaps documented with owners |
| **Serviceable** | 55–69 | Works today, fragile under load or incident |
| **At risk** | 40–54 | Material likelihood of data loss, breach, or extended outage |
| **Not production-viable** | <40 | Remediate before onboarding further users |

---

## 3. Layer ownership map

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

---

## 4. The thirteen layers

Each probe is scored 0–4. `[G#]` marks a probe that triggers a hard gate at score 0.

---

### Layer 1 — Front-end foundations
*Owns: what ships to the browser or device and how it behaves there.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 1.1 | Bundle size is measured and budgeted; regressions are visible | Build output, bundle analyser, budget config |
| 1.2 | Rendering strategy (SSR/SSG/CSR) is deliberate and matches the content | Framework config, route-level rendering modes |
| 1.3 | State management is coherent; no competing sources of truth for the same data | Store definitions, a traced data flow |
| 1.4 | No secrets, API keys, or privileged config in the client bundle `[G3]` | Grep of built assets, env var prefixing rules |
| 1.5 | Accessibility meets a stated standard; keyboard and screen-reader paths work | Axe/Lighthouse run, manual tab-through of a core flow |
| 1.6 | Core Web Vitals measured against real users, not just lab runs | RUM dashboard, field data |
| 1.7 | Dependencies are current; no unmaintained or duplicated libraries | Lockfile audit, dependency tree |
| 1.8 | Error and empty states exist for every async surface | Walkthrough with network throttled and failing |

**Common findings:** secrets prefixed for public exposure by accident; two state libraries doing the same job; loading spinners with no timeout or failure branch; a 4MB bundle nobody has looked at since launch.

---

### Layer 2 — APIs / back-end logic
*Owns: the contract between clients and the system, and the business logic behind it.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 2.1 | API contract is specified and the specification matches reality | OpenAPI/schema file, diff against live responses |
| 2.2 | All input is validated at the boundary, server-side, with a typed schema | Validation middleware, a rejected malformed request |
| 2.3 | Error responses are consistent in shape and leak no internals | Sample of 4xx/5xx bodies |
| 2.4 | Business logic is separable from transport; controllers stay thin | Module structure, one traced endpoint |
| 2.5 | No N+1 query patterns on hot paths | Query logs under a representative request |
| 2.6 | Idempotency is handled for retryable mutations (payments, submissions) | Idempotency key handling, duplicate-request test |
| 2.7 | Versioning or deprecation strategy exists for breaking changes | Version scheme, deprecation notices |
| 2.8 | Long-running work is queued rather than held in a request | Job/queue definitions, timeout config |

**Common findings:** validation performed only in the client; a payment endpoint that double-charges on retry; 500s returning stack traces; a report endpoint that holds a connection for 40 seconds.

---

### Layer 3 — Database / storage
*Owns: the persistent data, its shape, its indexes, and its recoverability as an artefact.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 3.1 | Schema is normalised to a defensible degree; denormalisation is intentional | ERD, table definitions |
| 3.2 | Indexes exist for actual query patterns; unused indexes removed | Query plans for top queries, index usage stats |
| 3.3 | Migrations are versioned, reversible, and applied identically across environments | Migration directory, CI migration step |
| 3.4 | Foreign keys and constraints enforce integrity at the database, not only in code | Constraint definitions |
| 3.5 | Backups run on a defined schedule with defined retention | Backup config, retention policy |
| 3.6 | A restore has been performed and verified within 90 days `[G1]` | Restore log, timing record, sign-off |
| 3.7 | Large or binary objects are in object storage, not table columns | Storage bucket config, column types |
| 3.8 | Connection pooling is configured against the database's actual ceiling | Pool size vs. max connections, saturation graph |
| 3.9 | Data retention and deletion honour stated policy and applicable law | Retention jobs, deletion flow for a user request |

**Common findings:** backups configured and never once restored; a foreign key relationship enforced only by application convention; the pool sized larger than the database will accept; base64 images in a text column.

---

### Layer 4 — Auth / permissions
*Owns: identity, sessions, and the role model. (Data-level policy enforcement belongs to Layer 8.)*

| ID | Probe | Evidence to collect |
|---|---|---|
| 4.1 | Password storage uses a current adaptive hash with per-user salt | Hash algorithm and parameters |
| 4.2 | Session/token lifetimes are bounded; refresh and revocation both work | Token config, a demonstrated revocation |
| 4.3 | MFA available for users, mandatory for administrators `[G6]` | MFA enrolment policy, admin account settings |
| 4.4 | Role model is explicit and enumerable; no implicit privilege | Role definitions, permission matrix |
| 4.5 | Privilege escalation paths tested — can a user reach another user's data by ID? | IDOR probe results across key endpoints |
| 4.6 | Password reset and email change flows resist takeover | Token entropy, expiry, single-use, notification on change |
| 4.7 | Authorisation is checked server-side on every protected route, not inferred from UI | Route middleware coverage, one bypass attempt |
| 4.8 | Account lockout or progressive delay on repeated auth failure | Lockout config, demonstrated trigger |
| 4.9 | Service accounts and API keys are scoped, rotatable, and inventoried | Key inventory with owners and last rotation |

**Common findings:** a role check performed only when rendering the menu; reset tokens that never expire; an admin bypass left in from development; API keys with no rotation record and no named owner.

---

### Layer 5 — Hosting / deployment
*Owns: how code reaches production and how it comes back.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 5.1 | Infrastructure is declared as code; console changes are the exception and logged | IaC repository, drift detection output |
| 5.2 | Deployments are reproducible from a commit with no manual steps | Deploy definition, a replayed deploy |
| 5.3 | A rollback path exists and has been exercised `[G4]` | Rollback procedure, evidence of a real rollback |
| 5.4 | Environment parity: staging resembles production in topology and config | Environment comparison |
| 5.5 | Configuration and secrets are injected at runtime, never baked into images | Secret manager references, image inspection |
| 5.6 | Zero-downtime deployment or an accepted, communicated maintenance window | Deploy strategy, observed downtime |
| 5.7 | Domain, TLS, and certificate renewal are automated and monitored | Certificate expiry monitoring, renewal automation |

**Common findings:** production configured by hand eighteen months ago and never reproduced; rollback documented but never attempted; staging on a different database engine version; a certificate renewed manually by whoever remembers.

---

### Layer 6 — Cloud / compute
*Owns: the resources that exist, their sizing, their permissions, and their cost.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 6.1 | Compute is right-sized against observed utilisation | Utilisation graphs vs. provisioned capacity |
| 6.2 | IAM follows least privilege; blast radius of any single credential is bounded | Policy review, over-permissive role list |
| 6.3 | Region and data-residency choices are deliberate and documented | Region config against user geography and legal requirements |
| 6.4 | Resource inventory is complete; no orphaned or unattributed resources | Full inventory with owner tags |
| 6.5 | Cost is attributed per service and tracked against a budget | Cost breakdown, budget alerts |
| 6.6 | Network boundaries enforced; databases and internal services not publicly reachable | Security group / firewall rules, an external reachability test |
| 6.7 | Cold-start and warm-up behaviour understood for serverless components | Latency distribution including cold starts |

**Common findings:** a wildcard admin policy attached to the application role; three abandoned environments still billing; a database with a public IP and a password as its only defence; p99 latency dominated by cold starts nobody has measured.

---

### Layer 7 — CI/CD
*Owns: the pipeline from commit to artefact, and what it refuses to let through.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 7.1 | Tests run on every change and **block** merge on failure | Branch protection rules, a blocked PR |
| 7.2 | Test coverage is meaningful on critical paths, not merely high overall | Coverage report segmented by module |
| 7.3 | Static analysis and linting enforced in pipeline, not left to local discipline | Pipeline definition, a failed lint gate |
| 7.4 | Dependency and secret scanning run automatically `[G3]` | Scanner configuration, recent findings and dispositions |
| 7.5 | Builds are reproducible; the same commit yields the same artefact | Lockfile discipline, pinned base images |
| 7.6 | Pipeline secrets are scoped, masked in logs, and not available to fork builds | Secret configuration, log inspection |
| 7.7 | Pipeline duration is short enough that engineers don't route around it | Median pipeline time, bypass frequency |

**Common findings:** tests that run but don't block; coverage of 82% with the payment module at 11%; secrets echoed in a debug step; a 45-minute pipeline that people skip with an emergency flag.

---

### Layer 8 — Security / row-level security
*Owns: authorisation policy at the data layer, and the security posture of the software supply chain.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 8.1 | RLS or equivalent server-side policy enabled on every table holding user data `[G2]` | Per-table policy listing |
| 8.2 | Policies tested per role, including the negative cases | Policy test suite, a demonstrated denial |
| 8.3 | Service/admin keys cannot reach the client and bypass policy `[G2]` | Key distribution audit, client bundle grep |
| 8.4 | No critical or high CVEs in production dependencies without compensating control `[G8]` | Vulnerability scan with dispositions |
| 8.5 | Transport encryption enforced end to end; no plaintext internal hops | TLS config, internal traffic inspection |
| 8.6 | Sensitive fields encrypted at rest beyond disk-level encryption where warranted | Column-level encryption, key management |
| 8.7 | Security headers set (CSP, HSTS, frame options, referrer policy) | Response header inspection |
| 8.8 | Penetration test or equivalent adversarial review within 12 months | Report and remediation status |
| 8.9 | A disclosure route exists for externally reported vulnerabilities | Published contact, triage process |

**Common findings:** RLS enabled on eight tables and forgotten on the ninth; the service-role key shipped to the client "temporarily"; a policy that permits reads correctly but leaves writes wide open; no CSP at all.

---

### Layer 9 — Rate limiting
*Owns: abuse prevention, quota enforcement, and fair resource allocation.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 9.1 | Authentication and password-reset endpoints rate-limited `[G7]` | Limit config, demonstrated trip |
| 9.2 | Limits keyed appropriately — per user and per IP, not one or the other | Key strategy, behaviour behind a shared NAT |
| 9.3 | Enforcement happens at a layer an attacker cannot skip | Enforcement point relative to entry points |
| 9.4 | Expensive endpoints (search, export, report, upload) have their own limits | Per-endpoint configuration |
| 9.5 | Limit state is shared across instances, not held per process | Backing store for counters |
| 9.6 | Trip behaviour is correct: 429, `Retry-After`, no data leaked, client handles it | Response inspection, client behaviour on 429 |
| 9.7 | Limits are observable — trips are logged and alertable | Dashboard or log query for 429 rate |

**Common findings:** limits enforced in application code that a direct API call bypasses; in-memory counters that reset on every deploy and don't apply across three instances; an export endpoint with no limit at all; a 429 the mobile client treats as a generic failure.

---

### Layer 10 — Caching / CDN
*Owns: what is stored closer to the user, and how it is invalidated.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 10.1 | Cache layers are enumerated: browser, CDN, application, database | Cache topology diagram |
| 10.2 | Cache keys include every dimension that varies the response — especially identity | Key composition, a cross-user probe |
| 10.3 | No authenticated or personalised response is cacheable by shared caches | `Cache-Control` on authenticated routes |
| 10.4 | Invalidation strategy is explicit; TTLs are chosen, not defaulted | TTL configuration with rationale |
| 10.5 | Static assets are fingerprinted and served with long-lived immutable caching | Asset URLs and headers |
| 10.6 | Cache hit ratio is measured; a cold cache does not take the origin down | Hit ratio dashboard, origin load on purge |
| 10.7 | Stampede protection exists on expensive cached computations | Lock/single-flight implementation |

**Common findings:** a CDN caching a page containing another user's name; TTLs left at provider defaults; a full purge that immediately overwhelms the origin; assets without fingerprints served with a one-year cache.

---

### Layer 11 — Load balancing / scaling
*Owns: distributing traffic and absorbing growth.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 11.1 | Health checks are meaningful — they test dependencies, not just process liveness | Health endpoint implementation |
| 11.2 | Application instances are stateless; no session or file state held locally | Session store, uploaded-file handling |
| 11.3 | Autoscaling triggers on the metric that actually saturates first | Scaling policy vs. observed bottleneck |
| 11.4 | Scale-up latency is known and acceptable for the traffic shape | Time from trigger to serving capacity |
| 11.5 | The database or a downstream service is not a silent ceiling on scaling | Connection limits, downstream quotas |
| 11.6 | Load tested at a realistic multiple of peak; the breaking point is known | Load test report with a stated breaking point |
| 11.7 | Graceful degradation defined — what is shed first under pressure | Circuit breakers, feature flags, queue behaviour |

**Common findings:** a health check returning 200 while the database is unreachable; sessions in local memory so a scale-out logs people out; the app scaling to twenty instances against a database that accepts sixty connections; no load test ever run.

---

### Layer 12 — Error tracking / logs
*Owns: detection and diagnosis. (Restoration belongs to Layer 13.)*

| ID | Probe | Evidence to collect |
|---|---|---|
| 12.1 | Logs are structured and queryable, not free text | Log samples, a completed query |
| 12.2 | Requests are traceable end to end via a correlation ID | Trace of one request across services |
| 12.3 | No PII, credentials, or tokens in logs or error payloads `[G5]` | Redaction config, log sample search |
| 12.4 | Errors are captured centrally with release and user context attached | Error tracker configuration |
| 12.5 | Alerts route to a person who is on duty and expected to act | Alert routing, on-call rota |
| 12.6 | Alert quality is managed — no chronically ignored noise | Alert volume and acknowledgement rate |
| 12.7 | Mean time to detection is measured for recent incidents | Incident records with detection timestamps |
| 12.8 | Log retention meets both operational and regulatory needs | Retention configuration |

**Common findings:** the last outage discovered by a customer message; an error channel with 4,000 unread alerts; full request bodies including passwords logged at debug level in production; logs retained seven days when the compliance requirement is twelve months.

---

### Layer 13 — Availability / recovery
*Owns: staying up, and coming back.*

| ID | Probe | Evidence to collect |
|---|---|---|
| 13.1 | Availability target is stated and measured against real user experience | SLO definition, current attainment |
| 13.2 | RTO and RPO are defined **and tested**, not merely declared `[G1]` | Recovery drill record with achieved timings |
| 13.3 | Single points of failure are identified and either removed or accepted in writing | SPOF register with decisions |
| 13.4 | Backups are stored separately from primary infrastructure and are immutable | Backup location, immutability/lock settings |
| 13.5 | Runbooks exist for the most probable failure modes and are current | Runbook set, last-reviewed dates |
| 13.6 | Incident process defined: roles, communication, customer notification | Incident policy, a recent incident record |
| 13.7 | Post-incident reviews produce tracked actions that get completed | Review documents, action completion rate |
| 13.8 | Dependency failure is survivable — third-party outages degrade rather than break | Fallback behaviour for each critical vendor |

**Common findings:** an RPO of one hour with backups running nightly; backups in the same account as the resource they protect; runbooks written at launch and never revisited; post-mortem actions that are never closed.

---

## 5. Optional extension layers

These sit outside the thirteen but frequently produce the most consequential findings. Include them as layers 14–16 where relevant, with weights taken proportionally from the core thirteen.

**14 — Supply chain and third-party risk.** Provenance of dependencies, lockfile integrity, build-time script execution, vendor concentration, contractual and SLA exposure, exit path from each critical vendor.

**15 — Data governance and compliance.** Lawful basis for processing, data inventory and classification, cross-border transfer, subject access and deletion mechanics, breach notification obligations and timelines. For systems handling Nigerian personal or financial data, NDPR obligations and CBN guidance apply and carry defined timelines; for EU data subjects, GDPR. Confirm current requirements with counsel — this layer identifies exposure, it does not constitute legal advice.

**16 — Cost and efficiency.** Unit economics per active user and per transaction, cost trajectory against growth, waste inventory, commitment coverage. Worth separating out because cost failures are slow, silent, and rarely surfaced by any other layer.

---

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

---

## 7. Report structure

1. **Cover** — system, commit, environment, date, auditor, overall score, band, hard gates triggered
2. **Executive summary** — one page, no jargon, leads with the P0s and what they mean commercially
3. **Scorecard** — the thirteen layers with scores, weights, and a one-line verdict each
4. **Findings register** — full table, sorted by severity
5. **Remediation plan** — sequenced, with owners and dates
6. **Evidence appendix** — everything needed to reproduce the assessment
7. **Re-audit date** — set it in the report, or it will not happen

---

## 8. Re-audit cadence

- **Quarterly** — layers 4, 8, 9, 12 (the ones that decay fastest and fail hardest)
- **Semi-annually** — layers 3, 13 (restore drill included, not optional)
- **Annually** — full thirteen
- **Event-triggered** — after any P0 incident, major architectural change, or a compliance scope change

A score is only meaningful as a series. The first run establishes a baseline; the value arrives on the second.
