# Deploying on Coolify

Coolify runs Docker Compose behind Traefik. One compose file per stack, under
`deploy/`, applied on the box.

```bash
docker compose -f deploy/<slug>.compose.yml up -d --build
```

## The two things that fail silently

Both produce a healthy container, clean logs, and no error anywhere.

**1. The `coolify` network is external.** Every service Traefik must reach has
to join it explicitly. A service left on the default bridge network gets a 504
from Traefik and nothing else — nothing in the container's logs is wrong,
because nothing reached the container.

```yaml
networks:
  coolify:
    external: true

services:
  my-api:
    networks:
      - coolify
```

**2. Traefik routes by label, not by `ports:`.** Publishing a host port does
not make a service reachable through Traefik, and it does expose the container
directly on the host — beside TLS rather than behind it. Do not add a `ports:`
stanza to an application service.

## Router labels

```yaml
labels:
  - traefik.enable=true
  - traefik.docker.network=coolify
  - traefik.http.routers.<name>.rule=Host(`case.example.com`)
  - traefik.http.routers.<name>.entrypoints=https
  - traefik.http.routers.<name>.tls=true
  - traefik.http.routers.<name>.tls.certresolver=letsencrypt
  - traefik.http.services.<name>.loadbalancer.server.port=4000
  - traefik.http.routers.<name>-http.rule=Host(`case.example.com`)
  - traefik.http.routers.<name>-http.entrypoints=http
  - traefik.http.routers.<name>-http.middlewares=redirect-to-https@file
```

**Router names must be unique across every stack on the box.** They are keys in
one shared Traefik configuration, not scoped per compose project. Two products
that both name a router `web` silently overwrite each other, and which one wins
depends on start order. Prefix every router with the product slug.

`loadbalancer.server.port` is the port the container **listens on**, which is
not always the app's development port — a Vite surface is a static bundle
served by nginx on 80 in every environment.

The `-http` router plus the redirect middleware is what makes plain HTTP reach
HTTPS. Without it, `http://` simply does not resolve to anything.

## Which surfaces get a router

All of them. Traefik is the only ingress — there is no separate gateway.

| Surface | Rule | Priority |
|---|---|---|
| `platform-web` | ``Host(`<product>.<root>`)`` | 100 |
| `admin-web` | ``Host(`admin.<product>.<root>`)`` | 100 |
| API | organisation host **&&** ``PathPrefix(`/v1`)`` | 50 |
| `webapp` | organisation host **&&** ``PathPrefix(`/app`)`` | 50 |
| `tenant-web` | organisation host | 10 |

The organisation host is a **regex**, because tenant subdomains are created at
runtime and no literal `Host()` rule can enumerate them:

```
HostRegexp(`^[a-z0-9][a-z0-9-]*\.acme\.example\.com$`)
```

Dots are escaped. Unescaped, `acme.example.com` also matches
`acmeXexample.com`, which is a hostname someone else can register.

This is **Traefik v3 syntax** — a bare Go regex. Traefik v2 used named-group
syntax (`` HostRegexp(`{sub:[a-z0-9-]+}.acme.example.com`) ``) and silently
fails to match if you feed it a v3 rule. Check which version the Coolify
install runs before debugging a 404.

**Priorities are set explicitly.** All three organisation-host routers match
the same hostname, and Traefik's default priority is rule length — which
happens to favour the longer path rules today, but only by accident. Rename a
hostname and the ordering can flip, sending every `/v1` request to
`tenant-web`. The explicit values make that impossible.

## A tenant's own domain

An organisation's own verified domain is not knowable at deploy time, so no
compose label can cover it. Two options, and the choice is architectural:

**Traefik dynamic configuration.** When a tenant verifies a domain, write a
router into Traefik's file provider (or its API) and let its `certresolver`
issue the certificate. This is the option that fits Coolify, and it is a small
service, not a proxy.

**A Caddy gateway with on-demand TLS.** Caddy issues per-domain certificates
at first request, gated by an `ask` endpoint so pointing DNS at the box is not
enough to get a certificate. It is genuinely less work than the above — but it
must own `:443`, and **Coolify's Traefik already does**. Running both means one
of them receives nothing. Only reach for this on a box Coolify does not manage.

Whichever is chosen, a certificate for an arbitrary customer domain has to be
issued per domain. Wildcards cannot cover other people's zones.

## Wildcard certificates

`*.<product>.<root>` needs a wildcard certificate, because tenant subdomains
are created at runtime. **Wildcards are issued over DNS-01 only**, which needs
a DNS-provider credential for the zone configured on Traefik's certresolver.

The failure mode is a silent TLS handshake error at request time, not an error
at deploy time. If tenant subdomains work locally and fail in production with
nothing in the logs, this is why. Dropping the Caddy gateway does not avoid
this — it is a property of ACME, not of the proxy.

## Environment

One `.env` per service under `/data/<product>/env/`, referenced by `env_file:`.
Never inline a secret in the compose file — it is committed, and it is readable
by anything that can run `docker inspect`.

```yaml
env_file:
  - /data/<product>/env/backend.env
```

Nothing gets a default. A default `DATABASE_URL` points somewhere real, and a
default `JWT_SECRET` is one an attacker also has.

For the Go API set **`SERVER_ADDR`**, not just `PORT`. The server binds
`SERVER_ADDR`; `PORT` is parsed into config but never reaches
`ListenAndServe`, so a stack that sets only `PORT` runs on the compiled-in
default and every config file looks correct.

## Persistent data

Bind-mount anything that must survive an image rebuild, and back it up
independently of the container:

```yaml
volumes:
  - /data/<product>/uploads:/app/public
```

Uploaded media inside an image layer is media that vanishes on the next
`--build`.

## Postgres

A separate stack from the application, always. The database outlives every
deploy, and `docker compose down` on the app must not be able to reach it.

No `ports:` stanza — publishing 5432 on the host puts the database on the
public internet behind nothing but a password. Application services reach it
over the `coolify` network by container name.

The password comes from a Docker secret rather than an environment variable, so
it is not visible to `docker inspect` or to anything that can read the
process's environment.

## Redis

In the application stack rather than the Postgres one: it is a cache and a
message bus, so losing it must be survivable, while losing Postgres is not.
Keeping them in separate stacks makes that difference operational rather than
aspirational.

Also no `ports:` stanza. An unauthenticated Redis published on a host port is
remote code execution, not merely a data leak — `CONFIG SET dir` plus a write
is a well-worn path to a shell.

It runs with `--maxmemory 256mb --maxmemory-policy allkeys-lru`. Raise the
memory before assuming a cache miss rate is a code problem. If this Redis ever
holds a job queue or a lock, that data needs its **own instance** with
`noeviction` — LRU will silently evict a queued job.

## Migrations

Applied out-of-band against the shared Postgres, not by the API container. The
distroless runtime image has no shell and no `psql` on purpose — it carries
`/migrations` for parity with the repo layout, and nothing that could run them.

Running migrations from the app's entrypoint means every replica races to apply
the same migration on every deploy.

## Verifying before deploying

```bash
docker compose -f deploy/<slug>.compose.yml config
```

This resolves the file and catches an undefined variable, a bad indent or a
missing external network before anything is built.
