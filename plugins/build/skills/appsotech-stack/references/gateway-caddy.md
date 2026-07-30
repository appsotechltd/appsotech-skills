# The Caddy gateway

One gateway owns every hostname in a suite. Products have no domains of their
own; each is a fixed subdomain derived from one root-domain setting plus the
product's own label, so a product cannot be pointed somewhere nobody serves.

There are exactly two kinds of hostname, and the difference decides everything
else.

**Suite-owned** — the root site, each product's marketing site, each operator
console. Fixed, listed in the Caddyfile, covered by a wildcard certificate.

**Organisation-owned** — a school's own domain. Not listed anywhere and not
knowable at deploy time. Resolved per request against the platform API, with
its certificate issued on demand.

## What an organisation host serves

Both forms of organisation host — the suite subdomain
`<tenant>.<product>.<root>` and the organisation's own verified domain — route
**identically**:

| Path | Serves |
|---|---|
| `/v1/*` | the product's Go API, same origin |
| `/app/*` | `webapp`, prefix passed through, not stripped |
| everything else | `tenant-web`, with the `Host` header intact |

Order matters. `/v1` and `/app` are the only reserved prefixes; reserving more
would start colliding with page URLs an organisation chose for itself.

Same-origin `/v1` is why the consoles call a relative path: no API location is
baked into a bundle, and one build runs everywhere.

`/app/*` passes the prefix through rather than stripping it, because the
webapp's own routes already all live under `/app`. That is also why its Vite
`base` is `/app/`.

## On-demand TLS, and why `ask` is not optional

Organisation domains are other people's zones, so a wildcard cannot cover them.
Each is issued individually, the first time a request for it arrives.

```
on_demand_tls {
  ask {$PLATFORM_API_URL}/internal/gateway/ask?key={$GATEWAY_KEY}
}
```

Without `ask`, anyone who points DNS at the box makes Caddy request a
certificate on their behalf. That is two problems at once: a way to exhaust the
issuer's rate limit for the entire suite, and a way to make the suite appear to
serve a site nobody authorised. The platform API answers 200 only for a domain
some organisation has actually proved it owns.

The key rides in the query string because Caddy's `ask` cannot send headers —
it issues a bare `GET` with `&domain=` appended.

## Wildcards need DNS-01

`*.<product>.<root>` is required because tenant subdomains are created at
runtime. Wildcards are issued over DNS-01 **only**, which needs a DNS-provider
module compiled into Caddy and a token for the zone.

The failure mode is a silent TLS handshake error at request time, not an error
at deploy time. If tenant subdomains work in development and fail in production
with nothing in the logs, this is why.

```
# acme_dns cloudflare {$CLOUDFLARE_API_TOKEN}
```

## Resolving an unknown host

Anything that matched no listed block is an organisation domain. There is no
list to match against, so the product is resolved per request:

```
forward_auth {$PLATFORM_API_URL} {
  uri /internal/gateway/resolve?host={http.request.host}
  copy_headers X-Akadesk-Product X-Akadesk-Tenant
  header_up X-Gateway-Key {$GATEWAY_KEY}
}
```

A 2xx continues and copies the two headers onto the request; anything else is
returned to the client as-is. So an unknown host gets the API's 404 and never
reaches a backend — **fail-closed falls out of the mechanism** rather than
being something anyone has to remember.

Those copied headers are what the API's tenant middleware reads. Trusting them
is only safe because the gateway is the sole ingress and strips any
client-supplied copy. If a product's API is ever exposed directly, that trust
becomes a tenant-impersonation hole and the middleware must switch to a claim
read from the verified JWT.

There is deliberately **no default backend**. A product resolved but not listed
gets an explicit 404, not whichever block happens to be first — a stale name
cannot silently land on the wrong product.

## Adding a product

Two lines, and both must move together:

```
import product_hosts <slug> <api-port> <tenant-web-port> <marketing-port>
```

plus a matching `@<slug>` block in the organisation-domain section. A product
added to the registry but not to the Caddyfile resolves and then 404s, which
reads like a DNS problem and is not one.
