# Rubric — Layers 1–4 (34 probes)

Score each probe 0–4 using `scoring.md`. Record an evidence class for every
probe: `demonstrated`, `inspected`, or `attested`. An attested-only answer is
capped at 2 by the scorer — do not argue with the cap, record the class honestly.

`[G#]` marks a probe that fires a hard gate at score 0.

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
