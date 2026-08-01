// Coolify deployment scaffolding.
//
// Coolify runs Docker Compose behind Traefik. Two things follow from that and
// they are the two things people get wrong:
//
//   1. The `coolify` network is EXTERNAL. Every service that Traefik must
//      reach has to join it explicitly. A service on the default bridge
//      network gets a 504 from Traefik with no other symptom — the container
//      is healthy, the labels are right, and it is simply unreachable.
//
//   2. Traefik routes by LABEL, not by `ports:`. Publishing a host port is
//      not how a service becomes reachable here, and doing it anyway exposes
//      the container directly on the host, bypassing TLS.
//
// Both are load-bearing. Neither is discoverable from a failure message.

import { surface } from './surfaces.mjs';

// Traefik router names must be unique across every stack on the box — they
// are keys in one shared configuration, not scoped per project. Prefixing
// with the product slug is what stops two products' `web` routers from
// silently overwriting each other.
// The router is named after the SERVICE it routes to, not the surface key —
// a router called `demo-backend` pointing at a container called `demo-api`
// makes a Traefik dashboard read as two unrelated things.
function routerName(serviceName) {
  return serviceName.replace(/[^a-z0-9-]/g, '-');
}

function traefikLabels({ serviceName, rule, priority, port }) {
  const r = routerName(serviceName);
  return [
    'traefik.enable=true',
    'traefik.docker.network=coolify',
    `traefik.http.routers.${r}.rule=${rule}`,
    `traefik.http.routers.${r}.priority=${priority}`,
    `traefik.http.routers.${r}.entrypoints=https`,
    `traefik.http.routers.${r}.tls=true`,
    `traefik.http.routers.${r}.tls.certresolver=letsencrypt`,
    `traefik.http.services.${r}.loadbalancer.server.port=${port}`,
    `traefik.http.routers.${r}-http.rule=${rule}`,
    `traefik.http.routers.${r}-http.priority=${priority}`,
    `traefik.http.routers.${r}-http.entrypoints=http`,
    `traefik.http.routers.${r}-http.middlewares=redirect-to-https@file`,
  ];
}

// The port a container LISTENS on, which is not always its development port.
// Vite surfaces are static bundles served by nginx on 80 in every
// environment; Next.js surfaces keep their allocated port so the container
// and `npm run dev` are the same number.
export function containerPort(key, alloc) {
  const kind = surface(key).kind;
  if (kind === 'vite') return 80;
  if (kind === 'go') return alloc.apiPort;
  return alloc.ports[key];
}

// Escapes a domain for use inside a Traefik HostRegexp rule.
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The Traefik rule for each surface, and the priority that resolves overlaps.
//
// Three surfaces share the organisation host: tenant-web at `/`, webapp at
// `/app`, the API at `/v1`. Traefik picks the highest-priority matching
// router, and default priority is rule length — which happens to favour the
// longer path rules here, but only by accident. Setting priority explicitly
// is what stops a rename of a hostname silently reordering them and sending
// every /v1 request to tenant-web.
//
// Tenant subdomains are created at runtime, so the organisation host is a
// regex rather than a literal.
export function ruleFor(key, { slug, rootDomain }) {
  const tenantHost = `HostRegexp(\`^[a-z0-9][a-z0-9-]*\\.${reEscape(`${slug}.${rootDomain}`)}$\`)`;

  switch (key) {
    case 'platform-web':
      return { rule: `Host(\`${slug}.${rootDomain}\`)`, priority: 100 };
    case 'admin-web':
      return { rule: `Host(\`admin.${slug}.${rootDomain}\`)`, priority: 100 };
    case 'backend':
      return { rule: `${tenantHost} && PathPrefix(\`/v1\`)`, priority: 50 };
    case 'webapp':
      return { rule: `${tenantHost} && PathPrefix(\`/app\`)`, priority: 50 };
    // Everything else on the organisation host is the organisation's own
    // public site. Lowest priority, so it is the fallback rather than a
    // competitor to the two path rules above.
    case 'tenant-web':
      return { rule: tenantHost, priority: 10 };
    default:
      return null;
  }
}

function indent(lines, spaces) {
  const pad = ' '.repeat(spaces);
  return lines.map((l) => `${pad}${l}`).join('\n');
}

// The worker shares the API's image context and its environment file — same
// module, same config, different entrypoint. It gets NO Traefik labels: it
// serves no HTTP, and a router would health-check a port nothing listens on.
function workerService(slug, dataRoot) {
  return [
    `${slug}-worker:`,
    `  build:`,
    `    context: ${dataRoot}/src/backend`,
    `    dockerfile: Dockerfile.worker`,
    `  image: ${slug}/worker:latest`,
    `  container_name: ${slug}-worker`,
    `  restart: unless-stopped`,
    `  env_file:`,
    `    - ${dataRoot}/env/backend.env`,
    `  environment:`,
    `    ENVIRONMENT: production`,
    `  networks:`,
    `    - coolify`,
    `  # Scaling this past one replica is safe: the queue claims with`,
    `  # FOR UPDATE SKIP LOCKED, so replicas take different jobs rather than`,
    `  # queueing behind each other.`,
  ];
}

// Redis sits beside the application rather than in the Postgres stack: it is
// a cache and a message bus, so losing it must be survivable, while losing
// Postgres is not. Keeping them separate makes that difference operational
// rather than aspirational.
function redisService(slug) {
  return [
    `${slug}-redis:`,
    `  image: redis:7-alpine`,
    `  container_name: ${slug}-redis`,
    `  restart: unless-stopped`,
    // maxmemory + an eviction policy, because a cache with neither is not a
    // cache — it is a memory leak that eventually takes the box down. allkeys-lru
    // is right for a read cache; if this Redis ever holds a queue or a lock,
    // that data needs its own instance with noeviction.
    `  command: >`,
    `    redis-server`,
    `    --maxmemory 256mb`,
    `    --maxmemory-policy allkeys-lru`,
    `    --appendonly no`,
    `  networks:`,
    `    - coolify`,
    `  healthcheck:`,
    `    test: ["CMD", "redis-cli", "ping"]`,
    `    interval: 10s`,
    `    timeout: 3s`,
    `    retries: 5`,
    `  # No ports: stanza. An unauthenticated Redis published on the host is`,
    `  # remote code execution, not just a data leak.`,
  ];
}

export function composeFile({ slug, alloc, rootDomain, dataRoot = `/data/${slug}` }) {
  const services = [];

  for (const key of alloc.surfaces) {
    const s = surface(key);
    if (s.kind === 'flutter') continue;

    const name = key === 'backend' ? `${slug}-api` : `${slug}-${key}`;
    const port = containerPort(key, alloc);
    const routing = ruleFor(key, { slug, rootDomain });

    const lines = [
      `${name}:`,
      `  build:`,
      `    context: ${dataRoot}/src/${s.dir}`,
      `  image: ${slug}/${key}:latest`,
      `  container_name: ${name}`,
      `  restart: unless-stopped`,
      `  env_file:`,
      `    - ${dataRoot}/env/${key}.env`,
    ];

    if (key === 'backend') {
      lines.push(
        `  environment:`,
        // SERVER_ADDR, not PORT — the server binds SERVER_ADDR and would
        // otherwise sit on its compiled-in default while PORT looked correct.
        `    SERVER_ADDR: ":${port}"`,
        `    PORT: "${port}"`,
        `    ENVIRONMENT: production`,
      );
    } else if (surface(key).kind === 'next') {
      lines.push(
        `  environment:`,
        `    PORT: "${port}"`,
        `    HOSTNAME: 0.0.0.0`,
      );
    }

    lines.push(`  networks:`, `    - coolify`);

    if (routing) {
      lines.push(`  labels:`);
      for (const l of traefikLabels({ serviceName: name, ...routing, port })) {
        lines.push(`    - ${l}`);
      }
    }

    services.push(indent(lines, 2));
  }

  if (alloc.worker) {
    services.push(indent(workerService(slug, dataRoot), 2));
  }

  if (alloc.redis) {
    services.push(indent(redisService(slug), 2));
  }

  return `# ${slug} — Coolify stack
#
#   docker compose -f ${slug}.compose.yml up -d --build
#
# The coolify network is external and Traefik routes by label. A service that
# joins neither is unreachable with no error anywhere: the container is
# healthy and Traefik simply has nothing to route to it.

name: ${slug}

networks:
  coolify:
    external: true

services:
${services.join('\n\n')}
`;
}

export function envExample({ slug, alloc, rootDomain, caps = {} }) {
  const { storage = false, mail = false, realtime = [] } = caps;
  let out = `# ${slug} — Coolify environment. One file per service under
# /data/${slug}/env/, referenced by env_file in the compose file.
#
# Nothing here has a default. A default database URL points somewhere real and
# a default signing secret is one an attacker also has.

# --- backend.env ---
DATABASE_URL=postgres://${slug}:CHANGE_ME@${slug}-postgres:5432/${alloc.database}?sslmode=disable
JWT_SECRET=
ALLOWED_ORIGINS=https://${slug}.${rootDomain},https://admin.${slug}.${rootDomain}
`;

  if (alloc.redis) {
    // Container name, not localhost: services reach each other across the
    // coolify network by name.
    out += `REDIS_URL=redis://${slug}-redis:6379/0\n`;
  }
  if (storage) {
    out += `
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=${slug}
R2_PUBLIC_BASE=
`;
  }
  if (mail) {
    out += `
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_FROM_NAME=${slug}
`;
  }
  if (realtime.includes('video')) {
    out += `
LIVEKIT_HOST=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
`;
  }

  out += `
# --- platform-web.env / tenant-web.env ---
APP_BASE_URL=https://${slug}.${rootDomain}

# --- shared ---
ROOT_DOMAIN=${rootDomain}
`;
  return out;
}

// Postgres is deliberately a separate stack from the application services. It
// outlives every one of them, and a compose file that rebuilds the app should
// not be able to take the database with it.
export function postgresCompose({ slug, alloc, dataRoot = `/data/${slug}` }) {
  return `# Shared Postgres for ${slug}.
#
# Separate stack from the application on purpose: the database outlives every
# deploy, and \`docker compose down\` on the app must not be able to reach it.

name: ${slug}-postgres

networks:
  coolify:
    external: true

services:
  postgres:
    image: postgres:17-alpine
    container_name: ${slug}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${alloc.database}
      POSTGRES_USER: ${slug}
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - ${dataRoot}/postgres:/var/lib/postgresql/data
    secrets:
      - postgres_password
    networks:
      - coolify
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${slug} -d ${alloc.database}"]
      interval: 10s
      timeout: 5s
      retries: 5
    # No ports: stanza. Publishing 5432 on the host puts the database on the
    # public internet behind nothing but a password.

secrets:
  postgres_password:
    file: ${dataRoot}/secrets/postgres_password
`;
}
