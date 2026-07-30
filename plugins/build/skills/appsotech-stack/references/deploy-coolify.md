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

Only the ones with a hostname fixed at deploy time:

| Surface | Router |
|---|---|
| `platform-web` | `<product>.<root>` |
| `admin-web` | `admin.<product>.<root>` |
| `tenant-web` | none |
| `webapp` | none |
| API | none |

The last three live on an **organisation host**, created at runtime when a
tenant is onboarded. There is no `Host()` rule that could cover them — a
school's own domain is not knowable when the stack is written. The Caddy
gateway resolves those per request. Giving them a fixed Traefik hostname would
contradict the one-origin-per-organisation rule and put a second address on
surfaces that are supposed to have exactly one.

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
