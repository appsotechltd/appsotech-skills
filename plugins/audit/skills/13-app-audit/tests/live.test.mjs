import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { headerFacts, errorShapeFacts, guardRateLimitProbe, collectLive, resolveTlsTarget } from '../scripts/lib/live.mjs';
import { makeSelfSignedCert } from './helpers/self-signed-cert.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'scripts', 'collect-live.mjs');

// Closes a Node http/https server, forcing any still-open connections shut
// first — several tests below deliberately leave a connection stalled or
// mid-redirect, and a plain server.close() would otherwise wait forever for
// a connection that is never going to finish on its own.
async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/naked') { res.writeHead(200); res.end('ok'); return; }
    if (req.url === '/hardened') {
      res.writeHead(200, {
        'content-security-policy': "default-src 'self'",
        'strict-transport-security': 'max-age=31536000',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cache-control': 'private, no-store',
      });
      res.end('ok');
      return;
    }
    if (req.url === '/leaky-error') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Error: connect ECONNREFUSED 10.0.0.4:5432\n    at TCPConnectWrap.afterConnect');
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('missing security headers are reported as facts under probe 8.7', async () => {
  const res = await fetch(`${base}/naked`);
  const facts = headerFacts(res, `${base}/naked`);
  const missing = facts.filter((f) => f.probe === '8.7' && /absent/i.test(f.fact));
  const names = missing.map((f) => f.fact.toLowerCase()).join(' ');
  for (const h of ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'referrer-policy']) {
    assert.match(names, new RegExp(h));
  }
});

test('present security headers are recorded with their value', async () => {
  const res = await fetch(`${base}/hardened`);
  const facts = headerFacts(res, `${base}/hardened`);
  assert.ok(facts.some((f) => /default-src 'self'/.test(f.fact)));
});

test('a cacheable authenticated response is flagged under probe 10.3', async () => {
  const res = await fetch(`${base}/naked`);
  const facts = headerFacts(res, `${base}/naked`, { authenticated: true });
  const c = facts.find((f) => f.probe === '10.3');
  assert.match(c.fact, /no Cache-Control/i);
});

test('a private no-store authenticated response is not flagged', async () => {
  const res = await fetch(`${base}/hardened`);
  const facts = headerFacts(res, `${base}/hardened`, { authenticated: true });
  const c = facts.find((f) => f.probe === '10.3');
  assert.match(c.fact, /private, no-store/);
});

test('a stack trace in a 5xx body is reported under probe 2.3', async () => {
  const res = await fetch(`${base}/leaky-error`);
  const body = await res.text();
  const facts = errorShapeFacts(res, body, `${base}/leaky-error`);
  assert.match(facts[0].fact, /stack trace|internal/i);
  assert.equal(facts[0].probe, '2.3');
});

test('the error fact does not reproduce the internal host', async () => {
  const res = await fetch(`${base}/leaky-error`);
  const body = await res.text();
  const facts = errorShapeFacts(res, body, `${base}/leaky-error`);
  assert.ok(!facts.some((f) => f.fact.includes('10.0.0.4')));
});

test('rate-limit probing is refused against a remote host without consent', () => {
  const g = guardRateLimitProbe({ url: 'https://someone-elses-app.com', iOwnThis: false });
  assert.equal(g.allowed, false);
  assert.match(g.reason, /--i-own-this/);
});

test('rate-limit probing is allowed against localhost without consent', () => {
  assert.equal(guardRateLimitProbe({ url: 'http://127.0.0.1:3000', iOwnThis: false }).allowed, true);
  assert.equal(guardRateLimitProbe({ url: 'http://localhost:3000', iOwnThis: false }).allowed, true);
});

test('rate-limit probing is allowed against a remote host with explicit consent', () => {
  assert.equal(guardRateLimitProbe({ url: 'https://my-app.com', iOwnThis: true }).allowed, true);
});

test('collectLive marks rate-limit probes unavailable when the guard refuses', async () => {
  const refusingGuard = () => ({
    allowed: false,
    reason: 'refusing to burst-probe example.com: pass --i-own-this to confirm you are authorised.',
  });
  const doc = await collectLive({ url: base, probeRateLimit: true, iOwnThis: false }, { guard: refusingGuard });
  assert.ok(doc.unavailable.some((u) => u.probe === '9.1' && /--i-own-this/.test(u.reason)));
});

test('collectLive uses the real guard when none is injected', async () => {
  const doc = await collectLive({ url: base, probeRateLimit: true, iOwnThis: false });
  // base is 127.0.0.1, which the real guard permits — so 9.1 must NOT be unavailable
  assert.ok(!doc.unavailable.some((u) => u.probe === '9.1'));
});

// --- Critical 1: a redirect must not carry the burst (or attribution) off the approved host ---

test('a decoy that redirects to a guard-refused host never carries the rate-limit burst there', async () => {
  let victimHits = 0;
  const victim = createServer((req, res) => {
    victimHits += 1;
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => victim.listen(0, '127.0.0.2', r));
  const victimBase = `http://127.0.0.2:${victim.address().port}`;

  // The decoy answers the very first hit to '/' normally (so the one-off
  // header check succeeds locally) and redirects every hit after that to
  // the victim — i.e. every one of the burst's 20 iterations, and nothing
  // else. This isolates the burst-specific vector: if even one of those 20
  // redirects were followed, the victim would see it.
  let rootHits = 0;
  const decoy = createServer((req, res) => {
    if (req.url === '/') {
      rootHits += 1;
      if (rootHits === 1) {
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(302, { location: victimBase });
        res.end();
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => decoy.listen(0, '127.0.0.1', r));
  const decoyBase = `http://127.0.0.1:${decoy.address().port}`;

  try {
    // No deps.guard override: the real guard sees decoyBase's host,
    // 127.0.0.1, and allows it — the burst genuinely runs, against a host
    // the guard actually approved.
    const doc = await collectLive({ url: decoyBase, probeRateLimit: true, iOwnThis: false });
    assert.equal(victimHits, 0, 'not one of the 20 burst requests may reach a host the guard would refuse');
    assert.ok(rootHits > 1, 'sanity check: the burst must actually have run against the decoy');
    // Every one of the 20 burst requests hit a cross-origin redirect that
    // was correctly left unfollowed, so no conclusive evidence of the
    // target's behaviour was ever obtained — this must land in unavailable,
    // not a false "no rate limiting observed" fact built from unfollowed
    // 302s (a subsequent review round identified exactly this as a false
    // 9.1 verdict: a redirecting target must never be reported as
    // unprotected when its real response was never actually seen).
    assert.ok(
      !doc.facts.some((f) => f.probe === '9.1'),
      'zero conclusive responses must not be reported as a "no rate limiting" fact',
    );
    const gap = doc.unavailable.find((u) => u.probe === '9.1');
    assert.ok(gap, 'a burst with no conclusive result must land in unavailable');
    assert.match(gap.reason, /need at least \d+ to rule out rate limiting/i);
  } finally {
    await closeServer(decoy);
    await closeServer(victim);
  }
});

test('a redirected header check names the host actually contacted, not the original URL', async () => {
  const target = createServer((req, res) => {
    res.writeHead(200, { 'x-frame-options': 'DENY' });
    res.end('ok');
  });
  await new Promise((r) => target.listen(0, '127.0.0.2', r));
  const targetBase = `http://127.0.0.2:${target.address().port}`;

  const decoy = createServer((req, res) => {
    res.writeHead(302, { location: targetBase });
    res.end();
  });
  await new Promise((r) => decoy.listen(0, '127.0.0.1', r));
  const decoyBase = `http://127.0.0.1:${decoy.address().port}`;

  try {
    const doc = await collectLive({ url: decoyBase });
    const xfo = doc.facts.find((f) => f.probe === '8.7' && /x-frame-options: DENY/.test(f.fact));
    assert.ok(xfo, 'the redirected response must still be inspected');
    assert.ok(
      xfo.source.startsWith(`header:x-frame-options @ ${targetBase}`),
      `source must name the host actually contacted (${targetBase}), got: ${xfo.source}`,
    );
  } finally {
    await closeServer(decoy);
    await closeServer(target);
  }
});

// --- Critical 2: a stalled response body must not crash the whole run ---

test('a stalled response body is recorded as evidence under 2.3, not a crash', async () => {
  const stalling = createServer((req, res) => {
    res.writeHead(200, { 'content-length': '4096' });
    // Node buffers headers until the first body write/end unless flushed
    // explicitly — without this, the request never even completes the
    // headers phase, which would test a request timeout, not a body stall.
    res.flushHeaders();
    // Deliberately never call res.end() or write further bytes — a
    // slow-loris response that sends headers and then never finishes.
  });
  await new Promise((r) => stalling.listen(0, '127.0.0.1', r));
  const stallBase = `http://127.0.0.1:${stalling.address().port}`;

  try {
    const doc = await collectLive({ url: stallBase, timeoutMs: 200 });
    const gap = doc.unavailable.find((u) => u.probe === '2.3');
    assert.ok(gap, 'a stalled body must be recorded as a 2.3 gap, not thrown');
    assert.match(gap.reason, /stall/i);
    // 8.7 doesn't need the body at all and must not be discarded just
    // because a different probe's body read stalled.
    assert.ok(doc.facts.some((f) => f.probe === '8.7'));
  } finally {
    await closeServer(stalling);
  }
});

// --- Important 3: 8.7 must land in exactly one of facts/unavailable ---

test('probe 8.7 lands only in facts when the base URL fails but the auth route answers', async () => {
  const flaky = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    // '/' never responds at all — the base fetch will time out.
  });
  await new Promise((r) => flaky.listen(0, '127.0.0.1', r));
  const flakyBase = `http://127.0.0.1:${flaky.address().port}`;

  try {
    const doc = await collectLive({ url: flakyBase, authPath: '/ok', timeoutMs: 200 });
    assert.ok(doc.facts.some((f) => f.probe === '8.7'), 'the auth route answered, so 8.7 must have real evidence');
    assert.ok(!doc.unavailable.some((u) => u.probe === '8.7'), 'a probe with real evidence must not also appear in unavailable');
  } finally {
    await closeServer(flaky);
  }
});

test('no probe appears in both facts and unavailable for collectLive, across several configurations', async () => {
  const flaky = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
  });
  await new Promise((r) => flaky.listen(0, '127.0.0.1', r));
  const flakyBase = `http://127.0.0.1:${flaky.address().port}`;

  try {
    const docs = await Promise.all([
      collectLive({ url: base }),
      collectLive({ url: base, authPath: '/hardened' }),
      collectLive({ url: base, authPath: '/leaky-error', probeRateLimit: true, iOwnThis: false }),
      collectLive({ url: flakyBase, authPath: '/ok', timeoutMs: 200 }),
    ]);
    for (const doc of docs) {
      const factProbes = new Set(doc.facts.map((f) => f.probe));
      for (const { probe } of doc.unavailable) {
        assert.ok(!factProbes.has(probe), `probe ${probe} appears in both facts and unavailable in a collectLive document`);
      }
    }
  } finally {
    await closeServer(flaky);
  }
});

// --- Important 4: an unparseable/missing --url must exit 2, not crash ---

test('CLI: an unparseable --url exits 2 with the usage message, not a crash', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--url', 'notaurl'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: collect-live\.mjs/);
});

test('CLI: --url immediately followed by another flag is treated as a missing value, not swallowed', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--url', '--probe-rate-limit'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: collect-live\.mjs/);
});

test('collectLive resolves gracefully, without throwing, when --auth-path cannot be resolved against --url', async () => {
  const doc = await collectLive({ url: base, authPath: 'http://' });
  const gap = doc.unavailable.find((u) => u.probe === '10.3');
  assert.ok(gap, 'an unresolvable --auth-path must be recorded as a 10.3 gap');
  assert.match(gap.reason, /could not resolve --auth-path/);
});

// --- Important 5: TLS (probe 5.7) coverage, generated at test time ---

test('TLS: a valid certificate reports expiry with days remaining and the chain-trust verdict', async () => {
  const { certPem, keyPem } = makeSelfSignedCert({
    cn: '127.0.0.1',
    notBefore: new Date(Date.now() - 86_400_000),
    notAfter: new Date(Date.now() + 30 * 86_400_000),
  });
  const httpsServer = createHttpsServer({ key: keyPem, cert: certPem }, (req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => httpsServer.listen(0, '127.0.0.1', r));
  const tlsBase = `https://127.0.0.1:${httpsServer.address().port}`;

  try {
    const doc = await collectLive({ url: tlsBase });
    const fact = doc.facts.find((f) => f.probe === '5.7');
    assert.ok(fact, '5.7 must produce a fact for an https origin');
    assert.match(fact.fact, /expires .* day\(s\) remaining/);
    assert.match(fact.fact, /chain NOT verified/);
  } finally {
    await closeServer(httpsServer);
  }
});

test('TLS: an expired certificate is reported as expired, not as valid', async () => {
  const { certPem, keyPem } = makeSelfSignedCert({
    cn: '127.0.0.1',
    notBefore: new Date(Date.now() - 60 * 86_400_000),
    notAfter: new Date(Date.now() - 30 * 86_400_000),
  });
  const httpsServer = createHttpsServer({ key: keyPem, cert: certPem }, (req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => httpsServer.listen(0, '127.0.0.1', r));
  const tlsBase = `https://127.0.0.1:${httpsServer.address().port}`;

  try {
    const doc = await collectLive({ url: tlsBase });
    const fact = doc.facts.find((f) => f.probe === '5.7');
    assert.ok(fact, '5.7 must produce a fact even for an expired certificate');
    assert.match(fact.fact, /expired .* day\(s\) ago/);
    assert.doesNotMatch(fact.fact, /expires .* remaining/);
    assert.match(fact.fact, /chain NOT verified/);
  } finally {
    await closeServer(httpsServer);
  }
});

// --- Round 3, Important: 9.1 must never claim absence it did not observe ---

test('a same-origin redirecting auth path does not mask a real rate limiter (no false negative)', async () => {
  // /login redirects (same-origin, exactly like a normal post-login
  // redirect) for its first 5 hits, then a real limiter trips and every
  // hit after that gets 429 directly, with no redirect. The old
  // followRedirects:false burst would see only 302s for all 20 requests —
  // since it never followed even the same-origin ones — and report "no
  // rate limiting observed" despite the limiter genuinely engaging.
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.url === '/login') {
      hits += 1;
      if (hits <= 5) {
        res.writeHead(302, { location: '/login-ok' });
        res.end();
      } else {
        res.writeHead(429, { 'retry-after': '30' });
        res.end('slow down');
      }
      return;
    }
    if (req.url === '/login-ok') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverBase = `http://127.0.0.1:${server.address().port}`;

  try {
    const doc = await collectLive({ url: serverBase, authPath: '/login', probeRateLimit: true, iOwnThis: false });
    const fact = doc.facts.find((f) => f.probe === '9.1');
    assert.ok(fact, 'a real limiter trip reached through a same-origin redirect must be recorded as a 9.1 fact');
    assert.match(fact.fact, /rate limiting engaged/i);
    assert.doesNotMatch(fact.fact, /no rate limiting observed/i);
    assert.ok(!doc.unavailable.some((u) => u.probe === '9.1'));
  } finally {
    await closeServer(server);
  }
});

test('a burst that receives no responses at all is inconclusive, not a false "no rate limiting" claim', async () => {
  const flaky = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    // '/login' never responds — every burst request will time out.
  });
  await new Promise((r) => flaky.listen(0, '127.0.0.1', r));
  const flakyBase = `http://127.0.0.1:${flaky.address().port}`;

  try {
    const doc = await collectLive({
      url: flakyBase,
      authPath: '/login',
      probeRateLimit: true,
      iOwnThis: false,
      timeoutMs: 30,
    });
    assert.ok(!doc.facts.some((f) => f.probe === '9.1'), 'zero responses must not be reported as a fact');
    const gap = doc.unavailable.find((u) => u.probe === '9.1');
    assert.ok(gap, 'a burst with no conclusive responses must land in unavailable');
    assert.match(gap.reason, /need at least \d+ to rule out rate limiting/i);
  } finally {
    await closeServer(flaky);
  }
});

test('one conclusive response among nineteen failures is still too thin a sample to claim no rate limiting', async () => {
  // Exactly the shape a follow-up review reproduced: the very first BURST
  // request gets a real response, and every one after that dies (the
  // server stops responding at all past that point). A limiter tripping
  // anywhere in its normal range would never have been reached by the
  // eighteen requests that got no response, so "no rate limiting observed"
  // built from this one data point would be a false verdict on a gate-G7
  // probe.
  //
  // No --auth-path here, so the rate-limit target is the base URL itself —
  // which means the mandatory 8.7 check that always runs first is ALSO a
  // request to '/'. rootHits counts both: the first hit is that 8.7 check
  // (given a normal response so it doesn't itself time out and add delay),
  // the second hit is the burst's first iteration (also given a real
  // response — this is the "one conclusive response" the burst itself
  // sees), and everything from the third hit on hangs forever, landing on
  // the burst's remaining 19 iterations.
  let rootHits = 0;
  const thin = createServer((req, res) => {
    if (req.url !== '/') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    rootHits += 1;
    if (rootHits <= 2) {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    // every hit to '/' from the third on never responds at all
  });
  await new Promise((r) => thin.listen(0, '127.0.0.1', r));
  const thinBase = `http://127.0.0.1:${thin.address().port}`;

  try {
    const doc = await collectLive({
      url: thinBase,
      probeRateLimit: true,
      iOwnThis: false,
      timeoutMs: 30,
    });
    assert.ok(
      !doc.facts.some((f) => f.probe === '9.1'),
      'one conclusive response out of twenty must not be reported as "no rate limiting observed"',
    );
    const gap = doc.unavailable.find((u) => u.probe === '9.1');
    assert.ok(gap, 'a burst with only one conclusive response must land in unavailable');
    assert.match(gap.reason, /need at least \d+ to rule out rate limiting/i);
    assert.match(gap.reason, /^only 1\//, `expected the reason to disclose the thin ratio, got: ${gap.reason}`);
  } finally {
    await closeServer(thin);
  }
});

test('a healthy burst with mostly-conclusive responses still produces a "no rate limiting" fact', async () => {
  // Every request gets a real, fast response — comfortably above
  // MIN_CONCLUSIVE_FOR_ABSENCE_CLAIM — and none of them is ever 429. This is
  // the ordinary "target answers normally and isn't rate-limited" case the
  // absence claim exists to report, and the new sample-size floor must not
  // have turned it into a false gap.
  const healthy = createServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => healthy.listen(0, '127.0.0.1', r));
  const healthyBase = `http://127.0.0.1:${healthy.address().port}`;

  try {
    const doc = await collectLive({ url: healthyBase, probeRateLimit: true, iOwnThis: false });
    const fact = doc.facts.find((f) => f.probe === '9.1');
    assert.ok(fact, 'a burst with a full, healthy sample must still report "no rate limiting observed"');
    assert.match(fact.fact, /no rate limiting observed/i);
    assert.ok(!doc.unavailable.some((u) => u.probe === '9.1'));
  } finally {
    await closeServer(healthy);
  }
});

// --- Round 3, Important: cap cross-origin redirect amplification for one-shot probes ---

test('a two-hop cross-origin redirect chain is capped at one hop, not followed all the way', async () => {
  let farHits = 0;
  const far = createServer((req, res) => {
    farHits += 1;
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => far.listen(0, '127.0.0.3', r));
  const farBase = `http://127.0.0.3:${far.address().port}`;

  let midHits = 0;
  const mid = createServer((req, res) => {
    midHits += 1;
    res.writeHead(302, { location: farBase });
    res.end();
  });
  await new Promise((r) => mid.listen(0, '127.0.0.2', r));
  const midBase = `http://127.0.0.2:${mid.address().port}`;

  // near only redirects '/' — everything else (the absent-path probe's
  // request) gets a plain 404, so exactly one one-shot probe traverses the
  // chain and the hit counts below aren't muddied by a second, independent
  // traversal from a different probe also landing on the same decoy.
  const near = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(302, { location: midBase });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => near.listen(0, '127.0.0.1', r));
  const nearBase = `http://127.0.0.1:${near.address().port}`;

  try {
    await collectLive({ url: nearBase });
    // near (origin 1) -> mid (origin 2, first and only allowed cross-origin
    // hop) -> far (origin 3, a second cross-origin hop) must be refused.
    assert.equal(midHits, 1, 'the first cross-origin hop is allowed and must be dialed exactly once');
    assert.equal(farHits, 0, 'a second cross-origin hop must never be dialed — the budget caps at one');
  } finally {
    await closeServer(near);
    await closeServer(mid);
    await closeServer(far);
  }
});

// --- Round 3, Minor: dedupe byte-identical 8.7 facts from a self-redirecting base URL ---

test('a base URL that redirects onto the auth path does not duplicate 8.7 facts', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(302, { location: '/login' });
      res.end();
      return;
    }
    if (req.url === '/login') {
      res.writeHead(200, { 'x-frame-options': 'DENY' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverBase = `http://127.0.0.1:${server.address().port}`;

  try {
    const doc = await collectLive({ url: serverBase, authPath: '/login' });
    const xfoFacts = doc.facts.filter((f) => f.probe === '8.7' && /x-frame-options: DENY/.test(f.fact));
    assert.equal(xfoFacts.length, 1, 'the same observation landed on via two probes must be recorded once, not duplicated');
  } finally {
    await closeServer(server);
  }
});

// --- Round 4, Minor: 5.7 must use the URL actually landed on, not the literal --url ---
//
// A prior round's report claimed this was untestable without weakening TLS
// verification. That claim was wrong: the decision itself
// (`baseResult.ok ? baseResult.url : baseUrl`) is a pure one-line choice
// with no network involved, extracted into `resolveTlsTarget` specifically
// so it has a real regression test using plain fake objects — no server,
// no certificate, no fetch() trust question anywhere near it. What
// genuinely can't be covered without weakening verification is the
// end-to-end integration (an http server that 301s to a self-signed https
// server, driven all the way through collectLive) — that part is still
// exercised only by hand — but the decision logic itself has no excuse not
// to be tested, and now is.

test('resolveTlsTarget uses the URL the base fetch actually landed on when it succeeded', () => {
  const landed = resolveTlsTarget({ ok: true, url: 'https://example.test/dashboard' }, 'http://example.test/');
  assert.equal(landed, 'https://example.test/dashboard');
});

test('resolveTlsTarget falls back to the literal --url when the base fetch failed', () => {
  const fallback = resolveTlsTarget({ ok: false, reason: 'connection refused' }, 'http://example.test/');
  assert.equal(fallback, 'http://example.test/');
});

// --- Round 3, Minor: burst overall time budget has regression coverage ---

test('the rate-limit burst stops early once its overall time budget is exceeded', async () => {
  const slow = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200);
      res.end('ok');
    }, 20);
  });
  await new Promise((r) => slow.listen(0, '127.0.0.1', r));
  const slowBase = `http://127.0.0.1:${slow.address().port}`;

  try {
    // 20ms/request against a 400ms budget was measured (empirically, not
    // guessed — real per-request overhead on loopback runs a few ms above
    // the artificial delay) to land at 16-18 sent, comfortably below the
    // full 20-request burst. Whether that count also clears
    // MIN_CONCLUSIVE_FOR_ABSENCE_CLAIM (10) depends on wall-clock timing
    // that CPU contention on a shared runner can push either side of — a
    // prior version of this test asserted `sent >= 10`, which measurably
    // flaked (1/25 runs under contention) whenever a slow run dropped the
    // conclusive count below the threshold and the outcome landed in
    // unavailable instead of facts. This test is actually named for budget
    // truncation, not for the minimum-sample threshold, so it now extracts
    // `sent` from whichever outcome bucket fired — the fact's source string
    // ("N sequential requests @ ...") or the unavailable reason's "N/M
    // sequential request(s)" clause — and asserts on the request count
    // directly, with no dependency on which side of that threshold timing
    // jitter lands the run.
    const doc = await collectLive({
      url: slowBase,
      probeRateLimit: true,
      iOwnThis: false,
      rateLimitBudgetMs: 400,
      timeoutMs: 1000,
    });

    const fact = doc.facts.find((f) => f.probe === '9.1');
    const gap = doc.unavailable.find((u) => u.probe === '9.1');
    assert.ok(fact || gap, 'a burst that ran at all, even truncated, must report a fact or an explicit gap — not nothing');
    assert.ok(!(fact && gap), 'probe 9.1 must land in exactly one of facts/unavailable, never both');

    let sent;
    if (fact) {
      assert.match(fact.fact, /stopped early/i);
      const sentMatch = fact.source.match(/^(\d+) sequential requests/);
      assert.ok(sentMatch, `expected source to start with a request count, got: ${fact.source}`);
      sent = Number(sentMatch[1]);
    } else {
      const sentMatch = gap.reason.match(/\/(\d+) sequential request/);
      assert.ok(sentMatch, `expected reason to carry a "N/M sequential request(s)" count, got: ${gap.reason}`);
      sent = Number(sentMatch[1]);
    }

    assert.ok(sent >= 1, 'at least one request must have been sent before the budget check could trip');
    assert.ok(sent < 20, `expected an early stop well under the full 20-request burst, got ${sent}`);
  } finally {
    await closeServer(slow);
  }
});
