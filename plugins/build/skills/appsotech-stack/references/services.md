# Caching, realtime, storage and email

Four services sit beside the API. Each has one house answer, and each has a
rule about tenancy that is the thing most worth getting right.

| Concern | What we use |
|---|---|
| Background jobs | Postgres queue + a Go worker |
| Cache, rate limiting, pub/sub | Redis 7 |
| Live chat | fasthttp websocket + Redis pub/sub |
| Live voice and video | LiveKit |
| Object storage | Cloudflare R2 (S3 API) |
| Transactional email | Zoho SMTP |

## The rule that spans all four

**Everything is namespaced by tenant.** Cache keys, websocket rooms, LiveKit
room names, R2 object keys. Not one of them is protected by row-level
security, because none of them is a database row — RLS is the backstop for
Postgres and nothing else.

A cache key without a tenant serves one organisation's data to another, and it
does so *intermittently*, depending on who warmed the entry. A room name
without a tenant puts two schools' assemblies in the same call. An object key
without a tenant lets one organisation overwrite another's upload by choosing
the same filename.

This is why `cache.Key`, `realtime.RoomName` and `storage.Key` all take
`tenantID` as their first argument and there is no variant that does not.

## Background jobs

`backend/cmd/worker` — a second entrypoint in the API's own Go module, not a
service of its own. Same config, same packages, different `main`.

**The queue is Postgres, not Redis.** Two reasons. The cache Redis runs with
`allkeys-lru` and will silently evict a queued job under memory pressure — the
failure is a notification that never arrives, with nothing in any log. And a
job usually wants the same transaction as the row that caused it; only the
database it lives in can offer that.

```go
tx, _ := pool.Begin(ctx)
// ... write the row ...
queue.Enqueue(ctx, tx, &tenantID, "invoice.email", payload, time.Now(), 5)
tx.Commit(ctx)   // row and job commit together, or neither does
```

Enqueueing after the commit loses the job if the process dies in between.
Before it, a rollback leaves a job for a row that does not exist.

### Claiming

```sql
WHERE id = (
  SELECT id FROM job_queue
  WHERE status = 'pending' AND run_after <= now()
  ORDER BY run_after
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
```

`SKIP LOCKED` is the whole trick. Without it every worker queues behind the
same row and the replicas serialise; with it they take different jobs and scale
linearly. Scaling the worker past one replica is safe because of this line and
nothing else.

### Every handler must be idempotent

Delivery is **at-least-once**. A worker that dies after doing the work but
before marking it done will run the same job again when it is reaped. "Send the
welcome email" run twice is two emails; "charge the card" run twice is a
chargeback. Key the effect on something stable, or check before acting.

### Reaping

A process killed between claim and completion leaves a row stuck in `running`
forever — nothing picks it up again, because the claim only looks at `pending`.
The reaper requeues those after `claimTimeout`.

That timeout **must exceed the longest handler**. Set it too low and a slow job
is reaped while still running, and then runs twice concurrently.

### Tenancy

`job_queue` is the one table with **no RLS policy**, deliberately. The worker
claims across all tenants with no tenant set; a policy there would make the
claim return nothing and the queue would look permanently empty, with no error
anywhere.

Isolation moves one level in instead. For a job carrying a tenant, the runner
opens a transaction, sets `app.tenant_id` on it, and hands the handler that
transaction — so every query the handler makes through it is subject to the
same policies a request would be. A handler that reaches for the pool instead
escapes them.

**`SET LOCAL`, never a session-level `set_config`.** A session setting applies
to one pooled connection; the handler would draw a different one and run with
no tenant, so tenant-scoped queries return nothing — which reads as a missing
row, not a missing setting. Worse, that connection returns to the pool still
carrying the tenant, and the next caller inherits it. `SET LOCAL` is discarded
at commit or rollback and cannot outlive the job.

System jobs (no tenant) get a nil transaction and use the pool. That is what
keeps a slow external call — an SMTP handshake — from holding a transaction
open for its duration.

### Payloads

A payload is persisted `jsonb`, so it is a wire format. Struct fields need JSON
tags: renaming an untagged field strands every job already queued, and they
decode to zero values rather than failing. Carry ids rather than copied rows —
the row may have changed by the time the job runs, and the payload is the one
thing that crosses without an RLS policy.

Failures are kept, never deleted. A job that exhausts its attempts becomes
`dead` with its last error. A queue that discards failures cannot tell you what
stopped working.

## Redis

Read-through cache in front of Postgres, plus rate limiting and the pub/sub
bus that chat needs.

**Cache reads fail open.** A Redis error logs and reports a miss, so the
request falls through to Postgres. A cache that can take an endpoint down is
worse than no cache.

**Rate limiting fails closed.** A limiter that opens under failure disappears
exactly when something is hammering it. `Allow` returns false when Redis is
unreachable.

**Never cache without a TTL.** An entry with no expiry outlives the row it
describes. `SetJSON` refuses a non-positive TTL rather than defaulting to one.

**Invalidate by scan, never `KEYS`.** `KEYS` blocks the whole server for its
duration — on a shared Redis that is every product's latency, not just this
one's.

The container runs with `--maxmemory` and `allkeys-lru`. A cache with neither
is a memory leak that eventually takes the box down. If this Redis ever holds
a job queue or a lock, that data needs its own instance with `noeviction` —
LRU will silently evict a queued job.

### What is worth caching

Read-heavy, slow to compute, tolerant of being briefly stale: permission and
role lookups, tenant resolution by hostname, reference data, expensive
aggregates and report rollups. Invalidate on write in the same service method
that did the write.

Not worth caching: anything a user just changed and expects to see, and
anything cheap enough that the round trip to Redis is most of the cost.

## Live chat

fasthttp's websocket upgrader, **not gorilla** — the handler chain is
fasthttp, and mixing a `net/http` upgrade path in means running two servers on
one process.

**Delivery goes through Redis, always.** The hub's local map only holds
connections *this replica* is serving. Two users in one conversation routinely
land on different replicas, so `Publish` writes to the bus and every replica
delivers to its own connections. A hub that broadcasts locally works perfectly
with one replica and silently drops half the messages the moment a second
starts — and it will pass every test that runs one process.

That is also why `Publish` does not write locally as well: the subscription
echoes back to the sending replica, so doing both double-delivers.

**Inbound frames are not broadcast from the socket.** A message becomes real by
going through the service layer — validated, authorised, persisted — and
reaches the room via `Publish`. Echoing straight from the read loop skips all
three.

Ping/pong is configured and load-bearing: without it an idle socket is reaped
by an intermediary with no close frame and neither end notices until the next
send. `pingPeriod` must stay below `pongWait`.

Slow clients are dropped rather than allowed to block the room.

## Live voice and video

LiveKit. **The API mints tokens and nothing else** — clients connect to LiveKit
directly. Proxying media through the API would put sustained streaming load on
a service sized for JSON.

Tokens are short-lived (15 minutes). A token grants entry to a live call, so
one that leaks should stop working in minutes; clients refresh rather than
holding a long credential.

`CanPublish` is a parameter, not a constant — a viewer in a broadcast gets a
subscribe-only token.

## Object storage

Cloudflare R2 through the S3 API. There is no Cloudflare-specific SDK; this is
`aws-sdk-go-v2` pointed at an R2 endpoint.

Two differences from S3, both of which fail confusingly:

**Region must be `"auto"`.** R2 has no regions. Any other value produces a
signature mismatch, which reads as a credentials problem and is not one.

**No ACLs.** R2 rejects ACL parameters outright, so public access is a bucket
setting or a custom domain — never a per-object ACL on upload.

**Uploads and downloads are presigned; bytes never pass through the API.**
Proxying an upload ties up a request worker for the whole transfer and caps
file size at the server's body limit, for no benefit — the presigned URL
already carries the authorisation.

`PublicURL` returns `""` when no custom domain is configured, rather than
inventing an `r2.cloudflarestorage.com` URL that would 401 for anyone without
credentials.

## Transactional email

Zoho SMTP, over `net/smtp` from the standard library — no dependency.

**Send from a job, never from a handler.** Zoho throttles, a handshake plus
delivery routinely takes seconds, and a user waiting on a signup response
should not also be waiting on someone else's mail server. Selecting email
therefore selects the worker too — the `email.send` handler is registered for
you.

Enqueue `email.send` with a **nil tenant**, so the send does not hold a
transaction open across the SMTP handshake. That makes the payload
self-contained: render the message when enqueueing, not in the handler.

Zoho specifics that are not guessable from the error:

- The `From` address must be a real mailbox or verified alias on the
  authenticating account. A mismatch is a generic **553**, which reads like a
  malformed address.
- With two-factor auth on the account, the password must be an
  application-specific password. The account password fails with the same
  **535** as a wrong password.
- Port **587 is STARTTLS**. Port 465 is implicit TLS and needs a different
  dial — pointing this code at 465 hangs rather than erroring clearly.
- Regional hosts are not interchangeable: `smtp.zoho.com`, `smtp.zoho.eu` and
  `smtp.zoho.in` are different accounts' homes, and the wrong one fails
  authentication rather than routing.

STARTTLS is not optional — without it the credentials cross the network in
plain text.

Both a text and an HTML part are sent. An HTML-only message scores badly with
spam filters and is unreadable in clients that refuse HTML.
