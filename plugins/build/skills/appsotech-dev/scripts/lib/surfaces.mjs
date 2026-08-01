// The canonical surface set. Every Appsotech product is assembled from these
// seven and nothing else — a product either has a surface or it does not, but
// a surface never changes shape between products. That is the whole point of
// the fixed `apps/` layout: a path means the same thing whichever product you
// are standing in.
//
// `offset` is the surface's position in a product's block of ten development
// ports, assigned in canonical `apps/` order. It is null for surfaces that do
// not take a web port (the Go API draws from its own 80xx range; the gateway
// and the Flutter app have no per-product port at all).
//
// Order here IS the canonical order — docs/ports-and-databases.md renders its
// columns from it, and the port block is assigned by it. Do not reorder
// without renumbering every existing product.

export const SURFACES = [
  {
    key: 'platform-web',
    dir: 'apps/platform-web',
    label: 'platform-web',
    kind: 'next',
    offset: 0,
    summary: 'Next.js — product marketing; a tenant signs up here',
    hostname: '<product>.<root>',
    // Public pages need SSR and structured data for crawlers and
    // link-preview bots. Decision D16.
    rationale: 'indexed by crawlers, so SSR earns its cost',
  },
  {
    key: 'tenant-web',
    dir: 'apps/tenant-web',
    label: 'tenant-web',
    kind: 'next',
    offset: 1,
    summary: "Next.js — each tenant's own public site; learner signup/login",
    hostname: '<tenant>.<product>.<root>/',
    rationale: 'indexed, and reads the Host header to decide which organisation',
  },
  {
    key: 'webapp',
    dir: 'apps/webapp',
    label: 'webapp',
    kind: 'vite',
    offset: 2,
    summary: 'React + Vite — the application itself, behind auth',
    hostname: '<tenant>.<product>.<root>/app',
    // Never indexed, so SSR is pure cost here. Decision D16.
    rationale: 'behind auth and never indexed, so SSR is pure cost',
  },
  {
    key: 'admin-web',
    dir: 'apps/admin-web',
    label: 'admin-web',
    kind: 'vite',
    offset: 3,
    summary: 'React + Vite — platform operator console across all tenants',
    hostname: 'admin.<product>.<root>',
    // Deliberately NOT on an organisation host: a console that spans every
    // tenant cannot live at one tenant's address. Decision D4.
    rationale: 'spans every tenant, so it cannot sit on one tenant host',
  },
  {
    key: 'mobile',
    dir: 'apps/mobile',
    label: 'mobile',
    kind: 'flutter',
    offset: null,
    summary: 'Flutter — learner mobile app',
    hostname: null,
    rationale: 'ships to stores, so it has no hostname and no dev port',
  },
  {
    key: 'backend',
    dir: 'backend',
    label: 'API',
    kind: 'go',
    offset: null,
    summary: 'Go — the product API (fasthttp, pgx/v5, zerolog)',
    hostname: '<tenant>.<product>.<root>/v1',
    // Same-origin under /v1 is why consoles call a relative path and one
    // build runs everywhere with no API URL baked into a bundle.
    rationale: 'same-origin under /v1, so no API URL is baked into any bundle',
  },
];

// There is deliberately no `gateway` surface. A separate Caddy gateway exists
// to do on-demand TLS for organisation-owned domains, and doing that requires
// owning :443 — which Coolify's Traefik already owns. The two cannot both be
// the public ingress on one box, so a scaffolded gateway would either never
// receive traffic or fight Traefik for the port.
//
// Traefik routes every surface here instead; see references/deploy-coolify.md
// for how a tenant's own domain is added, which is a dynamic-configuration
// problem rather than a second proxy.
//
// academicos still runs a Caddy gateway. That is a suite fronting six products
// on its own hosts, not a Coolify deployment, and this skill diverges from it
// on purpose rather than by oversight.

const BY_KEY = new Map(SURFACES.map((s) => [s.key, s]));

export const SURFACE_KEYS = SURFACES.map((s) => s.key);

// Surfaces that occupy a slot in the product's block of ten web ports, in
// canonical order. Used by the allocator and by the docs renderer.
export const PORTED_SURFACES = SURFACES.filter((s) => s.offset !== null);

export function surface(key) {
  const s = BY_KEY.get(key);
  if (!s) {
    throw new Error(
      `unknown surface "${key}" — expected one of: ${SURFACE_KEYS.join(', ')}`,
    );
  }
  return s;
}

// Returns the given keys in canonical `apps/` order, de-duplicated. Callers
// pass user selections in whatever order the checkboxes came back in; every
// downstream consumer (port table, compose file, docs) wants canonical order,
// so normalising once here keeps the ordering rule in exactly one place.
export function normaliseSelection(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('select at least one surface');
  }
  const wanted = new Set(keys.map((k) => surface(k).key));
  return SURFACE_KEYS.filter((k) => wanted.has(k));
}

// A selection is coherent if the things it implies are present. These are
// warnings rather than errors: scaffolding one surface at a time against an
// existing product is a normal thing to do, and the caller knows whether the
// missing piece already exists on disk.
export function selectionWarnings(keys) {
  const sel = new Set(normaliseSelection(keys));
  const warnings = [];

  const webSurfaces = ['platform-web', 'tenant-web', 'webapp', 'admin-web'];
  const hasWeb = webSurfaces.some((k) => sel.has(k));
  if (hasWeb && !sel.has('backend')) {
    warnings.push(
      'web surfaces selected without `backend` — they call /v1 on a relative ' +
        'path, so the product needs a Go API either here or already on disk',
    );
  }
  if (sel.has('mobile') && !sel.has('backend')) {
    warnings.push(
      'mobile selected without `backend` — the Flutter app has no same-origin ' +
        'trick available and needs an absolute API base URL to point at',
    );
  }
  if (sel.has('webapp') && !sel.has('tenant-web')) {
    warnings.push(
      'webapp selected without `tenant-web` — both live on the organisation ' +
        'host, and `/` would 404 with nothing serving it',
    );
  }
  return warnings;
}
