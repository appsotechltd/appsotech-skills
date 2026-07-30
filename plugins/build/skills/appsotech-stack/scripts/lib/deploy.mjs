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
function routerName(slug, key) {
  return `${slug}-${key}`.replace(/[^a-z0-9-]/g, '-');
}

function traefikLabels({ slug, key, host, port }) {
  const r = routerName(slug, key);
  return [
    'traefik.enable=true',
    'traefik.docker.network=coolify',
    `traefik.http.routers.${r}.rule=Host(\`${host}\`)`,
    `traefik.http.routers.${r}.entrypoints=https`,
    `traefik.http.routers.${r}.tls=true`,
    `traefik.http.routers.${r}.tls.certresolver=letsencrypt`,
    `traefik.http.services.${r}.loadbalancer.server.port=${port}`,
    `traefik.http.routers.${r}-http.rule=Host(\`${host}\`)`,
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

export function hostnameFor(key, { slug, rootDomain }) {
  switch (key) {
    case 'platform-web':
      return `${slug}.${rootDomain}`;
    case 'admin-web':
      return `admin.${slug}.${rootDomain}`;
    // tenant-web, webapp and the API all live on the organisation host, which
    // is created at runtime and is not knowable here. They are routed by the
    // gateway, not by a Traefik Host() rule, so they get no router of their
    // own — publishing them under a fixed hostname would contradict the one
    // origin per organisation rule.
    default:
      return null;
  }
}

function indent(lines, spaces) {
  const pad = ' '.repeat(spaces);
  return lines.map((l) => `${pad}${l}`).join('\n');
}

export function composeFile({ slug, alloc, rootDomain, dataRoot = `/data/${slug}` }) {
  const services = [];

  for (const key of alloc.surfaces) {
    if (key === 'gateway') continue;
    const s = surface(key);
    if (s.kind === 'flutter') continue;

    const name = key === 'backend' ? `${slug}-api` : `${slug}-${key}`;
    const port = containerPort(key, alloc);
    const host = hostnameFor(key, { slug, rootDomain });

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

    if (host) {
      lines.push(`  labels:`);
      for (const l of traefikLabels({ slug, key, host, port })) {
        lines.push(`    - ${l}`);
      }
    } else {
      lines.push(
        `  # No Traefik router: this surface is served on an organisation`,
        `  # hostname created at runtime, so the gateway routes it, not a`,
        `  # fixed Host() rule here.`,
      );
    }

    services.push(indent(lines, 2));
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

export function envExample({ slug, alloc, rootDomain }) {
  return `# ${slug} — Coolify environment. One file per service under
# /data/${slug}/env/, referenced by env_file in the compose file.
#
# Nothing here has a default. A default database URL points somewhere real and
# a default signing secret is one an attacker also has.

# --- backend.env ---
DATABASE_URL=postgres://${slug}:CHANGE_ME@postgres:5432/${alloc.database}?sslmode=disable
JWT_SECRET=
ALLOWED_ORIGINS=https://${slug}.${rootDomain},https://admin.${slug}.${rootDomain}

# --- platform-web.env / tenant-web.env ---
APP_BASE_URL=https://${slug}.${rootDomain}

# --- shared ---
ROOT_DOMAIN=${rootDomain}
`;
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
