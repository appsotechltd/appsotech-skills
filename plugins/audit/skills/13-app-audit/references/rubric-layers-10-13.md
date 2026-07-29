# Rubric — Layers 10–13 (30 probes)

Score each probe 0–4 using `scoring.md`. Record an evidence class for every
probe: `demonstrated`, `inspected`, or `attested`. An attested-only answer is
capped at 2 by the scorer — do not argue with the cap, record the class honestly.

`[G#]` marks a probe that fires a hard gate at score 0.

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
