# Rubric — Layers 5–9 (37 probes)

Score each probe 0–4 using `scoring.md`. Record an evidence class for every
probe: `demonstrated`, `inspected`, or `attested`. An attested-only answer is
capped at 2 by the scorer — do not argue with the cap, record the class honestly.

`[G#]` marks a probe that fires a hard gate at score 0.

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
| 7.4 | Dependency and secret scanning run automatically | Scanner configuration, recent findings and dispositions |
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
