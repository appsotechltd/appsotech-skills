# Web surfaces

Two kinds, and which one a surface is follows from one question: **is it
indexed?**

| | Next.js | React + Vite |
|---|---|---|
| Surfaces | `platform-web`, `tenant-web` | `webapp`, `admin-web` |
| Why | Crawlers and link-preview bots need server-rendered HTML and structured data | Behind auth, never indexed, so SSR is pure cost |
| React | 19 | 18 |
| Tailwind | v4 (`@tailwindcss/postcss`) | v3 (`postcss` + `autoprefixer`) |
| Container port | its allocated port | always 80 — nginx serving a static bundle |

The React and Tailwind versions genuinely differ between the two. That is not
drift to tidy up: the Vite surfaces are pinned to React 18 because the testing
and component libraries they depend on are, and moving one surface moves all of
its dependencies with it.

## Next.js surfaces

App Router, TypeScript, `output: 'standalone'` — standalone is what lets the
runtime image copy a self-contained server instead of the whole `node_modules`
tree.

`tenant-web` reads the `Host` header to decide which organisation it is serving.
Traefik passes it through intact for exactly this reason, so read it from
`headers()` and never from a build-time environment variable — one build serves
every tenant.

```ts
import { headers } from 'next/headers';

export async function currentTenant() {
  const host = (await headers()).get('host') ?? '';
  // <tenant>.<product>.<root>, or an organisation's own verified domain.
  return resolveTenant(host);
}
```

Because a tenant's host is not known at build time, every tenant-dependent page
is dynamic. Do not reach for `generateStaticParams` on them.

## Vite surfaces

Static bundle, nginx, `:80` in every environment.

**`base` matters.** `webapp` is served at `/app` on the organisation host, so
its `vite.config.ts` sets `base: '/app/'`. A root-relative build works
perfectly on the development port and 404s on every asset once deployed —
the failure appears only after deploy, which is why it is set at scaffold time.

nginx needs the SPA fallback for the same reason: without `try_files`, a
refresh on any deep link is a 404 from nginx before React ever loads.

### The API client

`src/lib/api.ts`, `baseURL: '/v1'`, and **no host anywhere**.

Every surface is served same-origin with its API under `/v1` — Traefik
guarantees it in production, Vite's dev proxy mirrors it. So a relative path
means one build runs in every environment and there is no API URL to get wrong
at deploy time. Putting `VITE_API_URL` into a bundle undoes this: the value is
baked in at build, so staging and production need different builds of identical
code.

The client unwraps both envelopes — `{"data": ...}` on success, `problem+json`
on error — so no call site ever sees them.

### Data fetching

TanStack Query owns everything that comes from the server. zustand owns only
what does not: UI state, filters, a wizard's current step.

```ts
export function useStudents(params: StudentQuery) {
  return useQuery({
    queryKey: ['students', params],
    queryFn: () => studentService.list(params),
  });
}
```

Server state in a zustand store is the mistake this rule exists to prevent —
two sources of truth for the same row, no invalidation, and staleness that
shows up as a bug report about a number being wrong.

Query keys are `[feature, ...params]`. Mutations invalidate by prefix:

```ts
onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students'] }),
```

### Forms

react-hook-form with a zod resolver. The zod schema is the single definition of
what is valid on the client — and the API validates independently, because a
client-side check is a convenience, never a control.

Field errors from a 422 bind straight onto inputs by name, which is what the
`errors` map in the problem response is for:

```ts
catch (err) {
  const problem = (err as { problem?: Problem }).problem;
  for (const [field, message] of Object.entries(problem?.errors ?? {})) {
    setError(field as keyof FormValues, { message });
  }
}
```

### Structure

- `services/` — typed API clients, one file per feature. No React, no hooks.
  That is what lets a service be tested without rendering anything.
- `hooks/` — the TanStack Query hooks that wrap them.
- `pages/` — one per route.
- `components/` — presentational, no data fetching.
- `stores/` — zustand, client state only.
- `i18n/` — every user-facing string. Adding one in English inline is how the
  second locale becomes a rewrite.

### Testing

Vitest + Testing Library for components, Playwright for the workflow named in
the domain phase.

Query by role and label, not by test id: `getByRole('button', { name: 'Enrol' })`.
A test that can only find a control by test id cannot tell you the control is
reachable by a screen reader, and that is most of what a component test is for.

Sentry is initialised in `main.tsx` — DSN from the environment, and no
initialisation at all when it is absent, so local development is not reporting
into production.
