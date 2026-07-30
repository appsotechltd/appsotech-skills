# Caching, realtime, storage and email

Four services sit beside the API. Each has one house answer, and each has a
rule about tenancy that is the thing most worth getting right.

| Concern | What we use |
|---|---|
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
should not also be waiting on someone else's mail server.

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
