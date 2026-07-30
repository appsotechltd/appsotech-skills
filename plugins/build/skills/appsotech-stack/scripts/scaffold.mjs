#!/usr/bin/env node
// Scaffolds a product's selected surfaces to the Appsotech house layout.
//
//   scaffold.mjs <slug> --surfaces backend,webapp,tenant-web [--out DIR]
//                       [--root-domain akadesk.com] [--db-prefix akadesk]
//                       [--allocations path/to/ports-and-databases.md]
//                       [--dry-run]
//
// Writes only what the house conventions decide by themselves: manifests,
// configs, Dockerfiles, the process entrypoint, the response envelope, and a
// health route. Domain code is not generated here — that is the feature-build
// phase, and a script that guessed at it would produce tables nobody asked for.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { allocate, parseAllocations } from './lib/allocate.mjs';
import { normaliseSelection, selectionWarnings, surface, SURFACE_KEYS } from './lib/surfaces.mjs';
import { composeFile, postgresCompose, envExample } from './lib/deploy.mjs';
import * as t from './lib/templates.mjs';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set([
  '--surfaces',
  '--out',
  '--root-domain',
  '--db-prefix',
  '--db-name',
  '--allocations',
]);

function flagValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const v = args[idx + 1];
  // `--out --dry-run` means "no value given for --out", not "the value is the
  // literal string --dry-run".
  if (v === undefined || v.startsWith('--')) return null;
  return v;
}

function positionals() {
  return args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
}

const slug = positionals()[0] ?? null;
const surfacesArg = flagValue('--surfaces');

if (!slug || !surfacesArg) {
  console.error(
    'usage: scaffold.mjs <slug> --surfaces a,b,c [--out DIR] [--root-domain D]\n' +
      `       surfaces: ${SURFACE_KEYS.join(', ')}`,
  );
  process.exit(2);
}

const outDir = flagValue('--out') ?? slug;
const rootDomain = flagValue('--root-domain') ?? 'akadesk.com';
const dbPrefix = flagValue('--db-prefix') ?? 'akadesk';
const dbName = flagValue('--db-name');
const dryRun = args.includes('--dry-run');

let selected;
try {
  selected = normaliseSelection(surfacesArg.split(',').map((s) => s.trim()).filter(Boolean));
} catch (err) {
  console.error(String(err.message));
  process.exit(2);
}

// Read whatever is already allocated so a new product cannot be handed a
// block another product is on.
let used = {};
const allocationsPath = flagValue('--allocations');
if (allocationsPath) {
  if (!existsSync(allocationsPath)) {
    console.error(`--allocations: no such file: ${allocationsPath}`);
    process.exit(2);
  }
  used = parseAllocations(readFileSync(allocationsPath, 'utf8'));
}

let alloc;
try {
  alloc = allocate({ slug, surfaces: selected, used, dbPrefix, dbName });
} catch (err) {
  console.error(String(err.message));
  process.exit(2);
}

const written = [];
function write(relPath, content) {
  written.push(relPath);
  if (dryRun) return;
  const full = join(outDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  // Never clobber. Re-running the scaffold over a product that already exists
  // has to be safe, or nobody will run it a second time.
  if (existsSync(full)) {
    written[written.length - 1] = `${relPath} (exists, skipped)`;
    return;
  }
  writeFileSync(full, content);
}

for (const key of alloc.surfaces) {
  const s = surface(key);
  const dir = s.dir;

  if (s.kind === 'go') {
    const p = alloc.apiPort;
    write(`${dir}/go.mod`, t.goMod(slug));
    write(`${dir}/cmd/api/main.go`, t.goMain(slug, p));
    write(`${dir}/internal/config/config.go`, t.goConfig(slug, p));
    write(`${dir}/internal/db/db.go`, t.goDB(slug));
    write(`${dir}/internal/problems/problems.go`, t.goProblems(slug));
    write(`${dir}/internal/response/response.go`, t.goResponse(slug));
    write(`${dir}/internal/middleware/middleware.go`, t.goMiddleware(slug));
    write(`${dir}/internal/middleware/tenant.go`, t.goTenantMiddleware(slug));
    write(`${dir}/Dockerfile`, t.goDockerfile(slug, p));
    write(`${dir}/.air.toml`, t.goAirToml(p));
    write(`${dir}/.env.example`, t.goEnvExample(slug, p, alloc.database));
    write(
      `${dir}/migrations/.gitkeep`,
      '# Numbered pairs: 000001_name.up.sql and 000001_name.down.sql.\n',
    );
  }

  if (s.kind === 'next') {
    const port = alloc.ports[key];
    write(`${dir}/package.json`, t.nextPackageJson(slug, key, port));
    write(`${dir}/tsconfig.json`, t.nextTsConfig());
    write(`${dir}/next.config.ts`, t.nextConfig());
    write(`${dir}/postcss.config.mjs`, t.nextPostcssConfig());
    write(`${dir}/Dockerfile`, t.nextDockerfile(slug, key, port));
    write(`${dir}/src/app/layout.tsx`, t.nextLayout(slug, key));
    write(`${dir}/src/app/page.tsx`, t.nextPage(slug, key));
    write(`${dir}/src/app/globals.css`, t.nextGlobalsCss());
    // The Dockerfile does `COPY --from=build /app/public ./public`, which is a
    // hard failure when the directory does not exist. Next.js does not create
    // it, and a scaffold with no static assets yet would not have one — so the
    // image build breaks on the first deploy of an otherwise working app.
    write(`${dir}/public/.gitkeep`, '');
  }

  if (s.kind === 'vite') {
    const port = alloc.ports[key];
    write(`${dir}/package.json`, t.vitePackageJson(slug, key));
    write(`${dir}/tsconfig.json`, t.viteTsConfig());
    write(`${dir}/vite.config.ts`, t.viteConfig(key, port));
    write(`${dir}/index.html`, t.viteIndexHtml(slug, key));
    write(`${dir}/tailwind.config.js`, t.viteTailwindConfig());
    write(`${dir}/postcss.config.js`, t.vitePostcssConfig());
    write(`${dir}/Dockerfile`, t.viteDockerfile(slug, key));
    write(`${dir}/nginx.conf`, t.viteNginxConf(key));
    write(`${dir}/src/main.tsx`, t.viteMain(key));
    write(`${dir}/src/App.tsx`, t.viteApp(slug, key));
    write(`${dir}/src/index.css`, t.viteIndexCss());
    write(`${dir}/src/setupTests.ts`, t.viteSetupTests());
    write(`${dir}/src/vite-env.d.ts`, t.viteEnvDts());
    write(`${dir}/src/lib/api.ts`, t.viteApiClient());
  }

  if (s.kind === 'flutter') {
    write(`${dir}/pubspec.yaml`, t.pubspec(slug));
  }
}

// Deployment is scaffolded whenever there is anything to deploy.
const deployable = alloc.surfaces.filter(
  (k) => !['gateway', 'mobile'].includes(k),
);
if (deployable.length > 0) {
  write(`deploy/${slug}.compose.yml`, composeFile({ slug, alloc, rootDomain }));
  write(`deploy/postgres.compose.yml`, postgresCompose({ slug, alloc }));
  write(`deploy/.env.example`, envExample({ slug, alloc, rootDomain }));
}

write('.gitignore', t.gitignore());
write('README.md', t.readme(slug, alloc));

// ---------------------------------------------------------------------------

console.log(`product   ${slug}`);
console.log(`database  ${alloc.database}`);
console.log(`block     ${alloc.block}`);
for (const key of alloc.surfaces) {
  const port = key === 'backend' ? alloc.apiPort : alloc.ports[key];
  console.log(`  ${key.padEnd(14)} ${port ?? '—'}`);
}
console.log(`\n${written.length} file(s)${dryRun ? ' (dry run, nothing written)' : ` under ${outDir}/`}`);
for (const w of written) console.log(`  ${w}`);

for (const warning of selectionWarnings(alloc.surfaces)) {
  console.log(`\nwarning: ${warning}`);
}
