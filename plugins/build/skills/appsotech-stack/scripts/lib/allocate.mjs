// Port and database allocation.
//
// Every app in every product gets its own development port so the whole suite
// can run at once. That is not a style preference — the arrangement before the
// allocation table had three collisions and physically could not run.
//
// The rule is one block of ten web ports per product, assigned in canonical
// `apps/` order, plus one API port from the 80xx range. Blocks of ten rather
// than packed ranges so that adding a fifth web surface to an existing product
// never renumbers a product that already exists.

import { PORTED_SURFACES, normaliseSelection, surface } from './surfaces.mjs';

export const WEB_BLOCK_START = 3200;
export const WEB_BLOCK_SIZE = 10;
export const WEB_BLOCK_MAX = 3990;
export const API_PORT_START = 8080;
export const API_PORT_MAX = 8099;

// 3100 is the suite site's block and 8100 its API. They sit outside the
// product ranges because the suite site is not a product: it has no tenants
// of its own, so it can never be allocated to one.
export const SUITE_WEB_BLOCK = 3100;
export const SUITE_API_PORT = 8100;

const SLUG_RE = /^[a-z][a-z0-9]*$/;

// `app`, `admin`, `api` and `www` can never be tenant slugs, and a product
// slug becomes a hostname label too — so a product may not take one either.
export const RESERVED_LABELS = new Set(['app', 'admin', 'api', 'www']);

export function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(
      `invalid product slug "${slug}" — must match ${SLUG_RE} (a DNS label, ` +
        'lowercase, no hyphens: it becomes <slug>.<root-domain> and a Go ' +
        'package path)',
    );
  }
  if (RESERVED_LABELS.has(slug)) {
    throw new Error(
      `product slug "${slug}" is a reserved label (${[...RESERVED_LABELS].join(', ')})`,
    );
  }
  return slug;
}

// Pulls existing allocations out of a ports-and-databases.md. Deliberately
// tolerant: it reads every number in the web and API ranges anywhere in the
// document rather than parsing the table's shape, because the table has
// picked up footnote markers (`8100 *(plan 2)*`), em-dashes for absent
// surfaces, and a stray prose paragraph spliced mid-table. A parser that
// insisted on well-formed rows would have silently returned nothing for the
// real file and handed out a colliding block.
export function parseAllocations(markdown) {
  const text = String(markdown ?? '');
  const webPorts = new Set();
  const apiPorts = new Set();
  for (const m of text.matchAll(/\b(\d{4})\b/g)) {
    const n = Number(m[1]);
    if (n >= 3000 && n <= 3999) webPorts.add(n);
    else if (n >= 8000 && n <= 8999) apiPorts.add(n);
  }
  const databases = new Set();
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g)) {
    databases.add(m[1]);
  }
  return {
    webBlocks: [...new Set([...webPorts].map(blockOf))].sort((a, b) => a - b),
    apiPorts: [...apiPorts].sort((a, b) => a - b),
    databases: [...databases].sort(),
  };
}

export function blockOf(port) {
  return Math.floor(port / WEB_BLOCK_SIZE) * WEB_BLOCK_SIZE;
}

export function nextWebBlock(usedBlocks = []) {
  const taken = new Set([SUITE_WEB_BLOCK, ...usedBlocks.map(blockOf)]);
  for (let b = WEB_BLOCK_START; b <= WEB_BLOCK_MAX; b += WEB_BLOCK_SIZE) {
    if (!taken.has(b)) return b;
  }
  throw new Error(
    `no free web port block between ${WEB_BLOCK_START} and ${WEB_BLOCK_MAX}`,
  );
}

export function nextApiPort(usedPorts = []) {
  const taken = new Set([SUITE_API_PORT, ...usedPorts]);
  for (let p = API_PORT_START; p <= API_PORT_MAX; p += 1) {
    if (!taken.has(p)) return p;
  }
  throw new Error(
    `no free API port between ${API_PORT_START} and ${API_PORT_MAX}`,
  );
}

// Allocates a product's ports and database name.
//
// Ports are assigned by the surface's fixed `offset`, NOT by counting the
// selected surfaces. A product that skips tenant-web still leaves 3x1 empty
// and puts webapp on 3x2 — otherwise adding tenant-web later would shift
// every surface after it, and a port that moved is a port that is wrong in
// some Dockerfile nobody thought to grep.
export const REALTIME_MODES = ['chat', 'video'];

export function allocate({
  slug,
  surfaces,
  used = {},
  dbPrefix = 'akadesk',
  dbName = null,
  redis = null,
  realtime = [],
} = {}) {
  validateSlug(slug);
  const selected = normaliseSelection(surfaces);

  for (const mode of realtime) {
    if (!REALTIME_MODES.includes(mode)) {
      throw new Error(
        `unknown realtime mode "${mode}" — expected one of: ${REALTIME_MODES.join(', ')}`,
      );
    }
  }
  const hasBackend = selected.includes('backend');
  if (realtime.length > 0 && !hasBackend) {
    throw new Error(
      'realtime needs `backend` — websocket hubs and LiveKit tokens are both ' +
        'minted by the Go API, and neither can live in a static bundle',
    );
  }

  // Redis follows the API by default: caching, and the pub/sub that lets a
  // websocket message reach a client held open by a different replica.
  // Chat forces it on — a multi-replica hub without a bus silently delivers
  // messages to whichever replica happens to hold the sender.
  const wantRedis = redis === null ? hasBackend : Boolean(redis);
  if (realtime.includes('chat') && !wantRedis) {
    throw new Error(
      'realtime chat requires redis — without a shared bus, a message reaches ' +
        'only the clients connected to the same replica as the sender',
    );
  }

  const block = used.webBlock ?? nextWebBlock(used.webBlocks ?? []);
  const apiPort = selected.includes('backend')
    ? used.apiPort ?? nextApiPort(used.apiPorts ?? [])
    : null;

  const ports = {};
  for (const s of PORTED_SURFACES) {
    if (selected.includes(s.key)) ports[s.key] = block + s.offset;
  }

  const database = dbName ?? `${dbPrefix}_${slug}`;
  const takenDbs = new Set(used.databases ?? []);
  if (takenDbs.has(database)) {
    throw new Error(
      `database "${database}" is already allocated — no two products may ` +
        'share one; pass an explicit dbName',
    );
  }

  return {
    slug,
    surfaces: selected,
    block,
    ports,
    apiPort,
    database,
    redis: wantRedis,
    realtime: REALTIME_MODES.filter((m) => realtime.includes(m)),
  };
}

// Where a port has to be changed in lockstep when it changes at all. The
// allocation table and the app's own config must move in the same commit;
// this is the list that makes "the same commit" actionable.
export function portLocations(surfaceKey) {
  const kind = surface(surfaceKey).kind;
  switch (kind) {
    case 'next':
      return [
        'package.json → `dev` and `start` scripts',
        'Dockerfile → `ENV PORT` and `EXPOSE`',
      ];
    case 'vite':
      return ['vite.config.ts → `server.port`'];
    case 'go':
      return [
        'the `SERVER_ADDR` environment variable (NOT `PORT` — the server ' +
          'binds SERVER_ADDR; PORT is parsed into config but unused by ' +
          'ListenAndServe, so setting only PORT leaves it on its default)',
        'Dockerfile → `ENV SERVER_ADDR` / `ENV PORT` / `EXPOSE`',
      ];
    default:
      return [];
  }
}
