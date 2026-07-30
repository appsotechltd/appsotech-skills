import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCAFFOLD = join(import.meta.dirname, '..', 'scripts', 'scaffold.mjs');

function run(args, opts = {}) {
  return execFileSync(process.execPath, [SCAFFOLD, ...args], {
    encoding: 'utf8',
    ...opts,
  });
}

function runExpectingFailure(args) {
  try {
    execFileSync(process.execPath, [SCAFFOLD, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { status: err.status, stderr: err.stderr };
  }
  throw new Error('expected a non-zero exit');
}

function tmp() {
  return mkdtempSync(join(tmpdir(), 'appsotech-scaffold-'));
}

test('a run with no surfaces exits 2 with usage', () => {
  const { status, stderr } = runExpectingFailure(['demo']);
  assert.equal(status, 2);
  assert.match(stderr, /usage/);
});

test('an unknown surface exits 2 and names the valid set', () => {
  const { status, stderr } = runExpectingFailure(['demo', '--surfaces', 'frontend']);
  assert.equal(status, 2);
  assert.match(stderr, /unknown surface/);
  assert.match(stderr, /platform-web/);
});

test('a reserved slug exits 2', () => {
  const { status, stderr } = runExpectingFailure(['admin', '--surfaces', 'backend']);
  assert.equal(status, 2);
  assert.match(stderr, /reserved label/);
});

test('--dry-run writes nothing but reports the plan', () => {
  const out = tmp();
  const stdout = run(['demo', '--surfaces', 'backend,webapp', '--out', out, '--dry-run']);
  assert.match(stdout, /dry run, nothing written/);
  assert.match(stdout, /akadesk_demo/);
  assert.equal(existsSync(join(out, 'backend', 'go.mod')), false);
  assert.equal(existsSync(join(out, 'README.md')), false);
});

test('a flag consuming the next flag as its value is not treated as a value', () => {
  const out = tmp();
  // `--out --dry-run` means "no value for --out", so --out falls back to the
  // slug. Without the guard this created a directory literally named
  // "--dry-run" and exited 0.
  run(['demo', '--surfaces', 'backend', '--out', out, '--dry-run']);
  assert.equal(existsSync('--dry-run'), false);
});

test('the Go surface scaffolds a buildable-looking module', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out]);

  const goMod = readFileSync(join(out, 'backend', 'go.mod'), 'utf8');
  assert.match(goMod, /^module github\.com\/appsotech\/demo\/api$/m);
  assert.match(goMod, /github\.com\/valyala\/fasthttp/);

  for (const f of [
    'cmd/api/main.go',
    'internal/config/config.go',
    'internal/db/db.go',
    'internal/problems/problems.go',
    'internal/response/response.go',
    'internal/middleware/middleware.go',
    'internal/middleware/tenant.go',
    'Dockerfile',
    '.env.example',
  ]) {
    assert.ok(existsSync(join(out, 'backend', f)), `missing backend/${f}`);
  }
});

test('the Go import paths in generated files match the generated module name', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out]);
  const main = readFileSync(join(out, 'backend', 'cmd', 'api', 'main.go'), 'utf8');
  const response = readFileSync(
    join(out, 'backend', 'internal', 'response', 'response.go'), 'utf8');
  // A module name and an import path that disagree is a scaffold that cannot
  // compile — and the failure is a wall of import errors, not one clear one.
  assert.match(main, /"github\.com\/appsotech\/demo\/api\/internal\/config"/);
  assert.match(response, /"github\.com\/appsotech\/demo\/api\/internal\/problems"/);
});

test('the Dockerfile sets SERVER_ADDR to the allocated port, not just PORT', () => {
  const out = tmp();
  const stdout = run(['demo', '--surfaces', 'backend', '--out', out]);
  const apiPort = stdout.match(/backend\s+(\d+)/)[1];
  const dockerfile = readFileSync(join(out, 'backend', 'Dockerfile'), 'utf8');
  // Setting only PORT leaves the listener on its compiled-in default while
  // every config file looks right.
  assert.match(dockerfile, new RegExp(`ENV SERVER_ADDR=:${apiPort}`));
  assert.match(dockerfile, new RegExp(`EXPOSE ${apiPort}`));
});

test('the webapp gets base /app and the matching nginx fallback', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,tenant-web,webapp', '--out', out]);
  const viteConfig = readFileSync(join(out, 'apps', 'webapp', 'vite.config.ts'), 'utf8');
  // A root-relative build works on the dev port and 404s on every asset
  // behind the gateway — a failure that appears only after deploy.
  assert.match(viteConfig, /base: '\/app\/'/);
  const nginx = readFileSync(join(out, 'apps', 'webapp', 'nginx.conf'), 'utf8');
  assert.match(nginx, /try_files \$uri \$uri\/ \/app\/index\.html/);
});

test('a non-webapp Vite surface is served from the root', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,admin-web', '--out', out]);
  const viteConfig = readFileSync(join(out, 'apps', 'admin-web', 'vite.config.ts'), 'utf8');
  assert.match(viteConfig, /base: '\/'/);
});

test('the API client is relative and bakes in no host', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,tenant-web,webapp', '--out', out]);
  const client = readFileSync(join(out, 'apps', 'webapp', 'src', 'lib', 'api.ts'), 'utf8');
  assert.match(client, /baseURL: '\/v1'/);
  // A host in the bundle means staging and production need different builds
  // of identical code.
  assert.doesNotMatch(client, /https?:\/\//);
});

test("the Next.js dev port matches the Dockerfile's", () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web', '--out', out]);
  const pkg = JSON.parse(
    readFileSync(join(out, 'apps', 'platform-web', 'package.json'), 'utf8'));
  const port = pkg.scripts.dev.match(/-p (\d+)/)[1];
  assert.equal(pkg.scripts.start.match(/-p (\d+)/)[1], port);
  const dockerfile = readFileSync(join(out, 'apps', 'platform-web', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, new RegExp(`ENV PORT=${port}`));
  assert.match(dockerfile, new RegExp(`EXPOSE ${port}`));
});

test('the compose file joins the external coolify network', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  // A service on the default bridge network is unreachable through Traefik
  // with no error message anywhere.
  assert.match(compose, /networks:\n {2}coolify:\n {4}external: true/);
  assert.match(compose, /traefik\.docker\.network=coolify/);
});

test('traefik router names are prefixed with the product slug', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web,admin-web', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  // Router names are keys in one shared Traefik config, not scoped per
  // compose project — two products naming a router `web` overwrite each other.
  assert.match(compose, /routers\.demo-platform-web\.rule/);
  assert.match(compose, /routers\.demo-admin-web\.rule/);
});

test('every routable surface actually gets a router', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,tenant-web,webapp,platform-web,admin-web', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  // The original version left these three with no router at all, on the
  // theory that a Caddy gateway would route them — while also generating no
  // gateway service. All three were unreachable.
  for (const r of ['platform-web', 'admin-web', 'tenant-web', 'webapp', 'api']) {
    assert.match(compose, new RegExp(`routers\\.demo-${r}\\.rule`), `${r} has no router`);
  }
});

test('the organisation host is a regex, since tenants are made at runtime', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,tenant-web,webapp', '--out', out,
    '--root-domain', 'example.com']);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  // Dots escaped, or `demo.example.com` also matches `demoXexample.com`.
  assert.match(compose, /HostRegexp\(`\^\[a-z0-9\]\[a-z0-9-\]\*\\\.demo\\\.example\\\.com\$`\)/);
});

test('path routers outrank the tenant-web catch-all on the same host', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,tenant-web,webapp', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  const priority = (r) =>
    Number(compose.match(new RegExp(`routers\\.demo-${r}\\.priority=(\\d+)`))[1]);
  // All three match the same hostname. Without explicit priorities Traefik
  // falls back to rule length, so a hostname rename could silently send /v1
  // to tenant-web.
  assert.ok(priority('api') > priority('tenant-web'));
  assert.ok(priority('webapp') > priority('tenant-web'));
  assert.match(compose, /routers\.demo-api\.rule=.*PathPrefix\(`\/v1`\)/);
  assert.match(compose, /routers\.demo-webapp\.rule=.*PathPrefix\(`\/app`\)/);
});

test('no application service publishes a host port', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web,webapp,tenant-web', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  // Publishing a port exposes the container beside TLS rather than behind it,
  // and is not how Traefik routes anyway.
  assert.doesNotMatch(compose, /^\s+ports:/m);
});

test('postgres is a separate stack, unpublished, with a secret password', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out]);
  const pg = readFileSync(join(out, 'deploy', 'postgres.compose.yml'), 'utf8');
  assert.match(pg, /name: demo-postgres/);
  // Publishing 5432 puts the database on the public internet behind a password.
  assert.doesNotMatch(pg, /^\s+ports:/m);
  assert.match(pg, /POSTGRES_PASSWORD_FILE/);
  assert.doesNotMatch(pg, /POSTGRES_PASSWORD:/);
});

test('a Vite surface is routed on container port 80, not its dev port', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,admin-web', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  assert.match(compose, /services\.demo-admin-web\.loadbalancer\.server\.port=80/);
});

test('mobile is scaffolded but never given a compose service', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,mobile', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  assert.doesNotMatch(compose, /demo-mobile:/);
  assert.ok(existsSync(join(out, 'apps', 'mobile', 'pubspec.yaml')));
});

test('redis follows the API by default and can be declined', () => {
  const withRedis = tmp();
  run(['demo', '--surfaces', 'backend', '--out', withRedis]);
  assert.ok(existsSync(join(withRedis, 'backend', 'internal', 'cache', 'cache.go')));
  assert.match(
    readFileSync(join(withRedis, 'deploy', 'demo.compose.yml'), 'utf8'), /demo-redis:/);

  const without = tmp();
  run(['demo', '--surfaces', 'backend', '--out', without, '--no-redis']);
  assert.equal(existsSync(join(without, 'backend', 'internal', 'cache')), false);
  assert.doesNotMatch(
    readFileSync(join(without, 'deploy', 'demo.compose.yml'), 'utf8'), /demo-redis:/);
});

test('a surfaces-only product gets no redis', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'tenant-web,webapp', '--out', out]);
  assert.doesNotMatch(
    readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8'), /demo-redis:/);
});

test('redis is bounded and never published', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out]);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  // A cache with no maxmemory and no eviction policy is a memory leak that
  // eventually takes the box down.
  assert.match(compose, /--maxmemory 256mb/);
  assert.match(compose, /--maxmemory-policy allkeys-lru/);
  // An unauthenticated Redis on a public port is remote code execution.
  assert.doesNotMatch(compose, /^\s+ports:/m);
});

test('chat scaffolds a websocket hub and forces redis on', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out, '--realtime', 'chat']);
  const hub = readFileSync(join(out, 'backend', 'internal', 'realtime', 'hub.go'), 'utf8');
  // fasthttp's upgrader, not gorilla — mixing net/http upgrade paths into a
  // fasthttp server means running two servers.
  assert.match(hub, /fasthttp\/websocket/);
  // Delivery goes over the bus so a message reaches clients held by other
  // replicas, which is the entire reason redis is mandatory here.
  assert.match(hub, /Publish|PSubscribe/);
  assert.ok(existsSync(join(out, 'backend', 'internal', 'cache', 'cache.go')));
});

test('chat without redis is refused rather than silently single-replica', () => {
  const { status, stderr } = runExpectingFailure([
    'demo', '--surfaces', 'backend', '--realtime', 'chat', '--no-redis',
  ]);
  assert.equal(status, 2);
  assert.match(stderr, /requires redis/);
});

test('video scaffolds LiveKit token minting and no media path', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out, '--realtime', 'video']);
  const lk = readFileSync(join(out, 'backend', 'internal', 'realtime', 'livekit.go'), 'utf8');
  assert.match(lk, /AccessToken/);
  // Rooms are tenant-namespaced, or two organisations that both name a room
  // "assembly" join the same call.
  assert.match(lk, /func RoomName\(tenantID/);
  const env = readFileSync(join(out, 'backend', '.env.example'), 'utf8');
  assert.match(env, /LIVEKIT_API_SECRET/);
});

test('an unknown realtime mode is refused', () => {
  const { status, stderr } = runExpectingFailure([
    'demo', '--surfaces', 'backend', '--realtime', 'telepathy',
  ]);
  assert.equal(status, 2);
  assert.match(stderr, /unknown realtime mode/);
});

test('R2 storage uses region auto and never sends an ACL', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out, '--storage']);
  const s = readFileSync(join(out, 'backend', 'internal', 'storage', 'storage.go'), 'utf8');
  // R2 has no regions; any other value fails as a signature mismatch that
  // reads like bad credentials.
  assert.match(s, /Region: *"auto"/);
  assert.match(s, /r2\.cloudflarestorage\.com/);
  // R2 rejects ACL parameters outright.
  assert.doesNotMatch(s, /ACL:/);
  // Uploads are presigned so they never tie up a request worker.
  assert.match(s, /PresignPut/);
});

test('Zoho mail uses STARTTLS on 587 and requires a From', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out, '--mail']);
  const m = readFileSync(join(out, 'backend', 'internal', 'mail', 'mail.go'), 'utf8');
  assert.match(m, /StartTLS/);
  const env = readFileSync(join(out, 'backend', '.env.example'), 'utf8');
  assert.match(env, /SMTP_HOST=smtp\.zoho\.com/);
  assert.match(env, /SMTP_PORT=587/);
});

test('storage and mail without a backend are refused', () => {
  for (const flag of ['--storage', '--mail']) {
    const { status, stderr } = runExpectingFailure(['demo', '--surfaces', 'webapp', flag]);
    assert.equal(status, 2, flag);
    assert.match(stderr, /need `backend`/, flag);
  }
});

test('capabilities not asked for leave no trace', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out, '--no-redis']);
  for (const d of ['cache', 'storage', 'mail', 'realtime']) {
    assert.equal(existsSync(join(out, 'backend', 'internal', d)), false, d);
  }
  const goMod = readFileSync(join(out, 'backend', 'go.mod'), 'utf8');
  for (const dep of ['redis', 'aws-sdk', 'livekit', 'websocket']) {
    assert.doesNotMatch(goMod, new RegExp(dep), `${dep} leaked into go.mod`);
  }
});

test('each capability adds exactly its own dependencies', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out,
    '--realtime', 'chat,video', '--storage', '--mail']);
  const goMod = readFileSync(join(out, 'backend', 'go.mod'), 'utf8');
  assert.match(goMod, /redis\/go-redis\/v9/);
  assert.match(goMod, /fasthttp\/websocket/);
  assert.match(goMod, /livekit\/protocol/);
  assert.match(goMod, /aws-sdk-go-v2\/service\/s3/);
  // mail is net/smtp from the standard library and must add nothing.
  assert.doesNotMatch(goMod, /gomail|sendgrid|mailgun/);
});

test('an existing file is skipped rather than clobbered', () => {
  const out = tmp();
  mkdirSync(join(out, 'backend'), { recursive: true });
  writeFileSync(join(out, 'backend', 'go.mod'), 'module example.com/handwritten\n');

  const stdout = run(['demo', '--surfaces', 'backend', '--out', out]);
  assert.match(stdout, /go\.mod \(exists, skipped\)/);
  assert.equal(
    readFileSync(join(out, 'backend', 'go.mod'), 'utf8'),
    'module example.com/handwritten\n',
  );
});

test('rerunning over a finished scaffold changes nothing', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,webapp,tenant-web', '--out', out]);
  const before = readFileSync(join(out, 'backend', 'cmd', 'api', 'main.go'), 'utf8');
  const stdout = run(['demo', '--surfaces', 'backend,webapp,tenant-web', '--out', out]);
  assert.equal(readFileSync(join(out, 'backend', 'cmd', 'api', 'main.go'), 'utf8'), before);
  assert.match(stdout, /exists, skipped/);
});

test('--allocations steers around blocks already in use', () => {
  const out = tmp();
  const table = join(out, 'ports.md');
  writeFileSync(table, '| aitutor | 3200 | 3201 | 8080 |\n| primary | 3210 | 3211 | 8081 |\n');
  const stdout = run([
    'demo', '--surfaces', 'backend,platform-web', '--out', join(out, 'p'),
    '--allocations', table,
  ]);
  assert.match(stdout, /block\s+3220/);
  assert.match(stdout, /backend\s+8082/);
});

test('a missing --allocations file exits 2 rather than allocating blindly', () => {
  const { status, stderr } = runExpectingFailure([
    'demo', '--surfaces', 'backend', '--allocations', '/nonexistent/ports.md',
  ]);
  assert.equal(status, 2);
  assert.match(stderr, /no such file/);
});

test('an incoherent selection still scaffolds but warns', () => {
  const out = tmp();
  const stdout = run(['demo', '--surfaces', 'platform-web', '--out', out]);
  assert.match(stdout, /warning:/);
  assert.ok(existsSync(join(out, 'apps', 'platform-web', 'package.json')));
});

test('the README records the allocation the run actually made', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,webapp,tenant-web', '--out', out]);
  const readme = readFileSync(join(out, 'README.md'), 'utf8');
  assert.match(readme, /akadesk_demo/);
  assert.match(readme, /apps\/webapp/);
});

test('--db-prefix and --root-domain reach the generated files', () => {
  const out = tmp();
  run([
    'demo', '--surfaces', 'backend,platform-web', '--out', out,
    '--db-prefix', 'npf', '--root-domain', 'ngpanel.space',
  ]);
  assert.match(readFileSync(join(out, 'README.md'), 'utf8'), /npf_demo/);
  const compose = readFileSync(join(out, 'deploy', 'demo.compose.yml'), 'utf8');
  assert.match(compose, /Host\(`demo\.ngpanel\.space`\)/);
});

test('every surface gets a tsconfig and an entry point', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web,tenant-web,webapp,admin-web', '--out', out]);

  for (const p of ['platform-web', 'tenant-web']) {
    for (const f of ['tsconfig.json', 'src/app/layout.tsx', 'src/app/page.tsx',
      'src/app/globals.css', 'postcss.config.mjs']) {
      assert.ok(existsSync(join(out, 'apps', p, f)), `missing apps/${p}/${f}`);
    }
  }
  for (const p of ['webapp', 'admin-web']) {
    for (const f of ['tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.tsx',
      'src/index.css', 'src/setupTests.ts', 'tailwind.config.js', 'postcss.config.js']) {
      assert.ok(existsSync(join(out, 'apps', p, f)), `missing apps/${p}/${f}`);
    }
  }
});

test('every path a Dockerfile COPYs from the build context exists', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web,tenant-web,webapp', '--out', out]);

  // `COPY --from=build /app/public ./public` is a hard failure when the
  // directory is absent. Next.js never creates it and a fresh scaffold has no
  // static assets, so the image build broke on the first deploy of an
  // otherwise working app.
  for (const p of ['platform-web', 'tenant-web']) {
    assert.ok(existsSync(join(out, 'apps', p, 'public')), `apps/${p}/public missing`);
  }
  // The Vite image copies nginx.conf out of the context the same way.
  assert.ok(existsSync(join(out, 'apps', 'webapp', 'nginx.conf')));
});

test("the router basename matches vite's base", () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,tenant-web,webapp,admin-web', '--out', out]);
  // A basename that disagrees with `base` resolves every link one level off,
  // and only once the app is served behind the gateway.
  const webappMain = readFileSync(join(out, 'apps', 'webapp', 'src', 'main.tsx'), 'utf8');
  assert.match(webappMain, /basename=\{'\/app'\}/);
  const adminMain = readFileSync(join(out, 'apps', 'admin-web', 'src', 'main.tsx'), 'utf8');
  assert.match(adminMain, /basename=\{'\/'\}/);
});

test('go.mod declares only what the generated code imports', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend', '--out', out]);
  const goMod = readFileSync(join(out, 'backend', 'go.mod'), 'utf8');
  const sources = [
    'cmd/api/main.go', 'internal/config/config.go', 'internal/db/db.go',
    'internal/problems/problems.go', 'internal/response/response.go',
    'internal/middleware/middleware.go', 'internal/middleware/tenant.go',
  ].map((f) => readFileSync(join(out, 'backend', f), 'utf8')).join('\n');

  // Declaring a dependency nothing imports makes `go mod tidy` rewrite go.mod
  // on a freshly scaffolded product — an unexplained diff in the first commit.
  for (const dep of ['github.com/golang-jwt/jwt/v5', 'golang.org/x/crypto']) {
    assert.doesNotMatch(goMod, new RegExp(dep.replace(/[/.]/g, '\\$&')), `${dep} declared`);
  }
  for (const dep of [
    'github.com/valyala/fasthttp', 'github.com/buaazp/fasthttprouter',
    'github.com/jackc/pgx/v5', 'github.com/rs/zerolog',
  ]) {
    assert.ok(goMod.includes(dep), `${dep} missing from go.mod`);
    assert.ok(sources.includes(dep), `${dep} declared but not imported`);
  }
});

test('generated JSON manifests actually parse', () => {
  const out = tmp();
  run(['demo', '--surfaces', 'backend,platform-web,webapp,tenant-web,admin-web', '--out', out]);
  for (const p of ['platform-web', 'tenant-web', 'webapp', 'admin-web']) {
    const raw = readFileSync(join(out, 'apps', p, 'package.json'), 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), `apps/${p}/package.json`);
  }
});
