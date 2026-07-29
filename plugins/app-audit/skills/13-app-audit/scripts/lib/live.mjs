import { connect as tlsConnect } from 'node:tls';

// --- shared constants ------------------------------------------------------

const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'referrer-policy',
];

// NOTE: 0.0.0.0 is "this host" (a wildcard bind address), not literally a
// loopback address the way 127.0.0.1/[::1] are — connecting a client to it
// happens to reach the local machine on every mainstream OS, which is why
// the original spec for this guard includes it, but that is OS convention,
// not a networking guarantee. Left as-is rather than changed unilaterally
// (no test exercises it either way and the spec for this function named it
// explicitly), flagged here for whoever revisits this list.
const LOCAL = /^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/;

const REQUEST_TIMEOUT_MS = 5_000;
const TLS_TIMEOUT_MS = 5_000;
const RATE_LIMIT_BURST = 20;
// Bounds the burst's total wall-clock cost: 20 sequential requests at the
// full REQUEST_TIMEOUT_MS each would be ~100s with nothing capping it. A
// budget this size still comfortably allows the burst to run its full course
// against anything that responds at normal speed, while keeping a target
// that stalls every request from turning one probe into a multi-minute hang.
const RATE_LIMIT_BUDGET_MS = 30_000;
// A single conclusive response (or any count short of this) is not enough
// sample to claim rate limiting is ABSENT — auth-endpoint limiters
// overwhelmingly trip somewhere in a 3-10 request range in practice, so
// half the burst's full size (10 of 20) comfortably covers that normal
// range with margin: if a limiter configured anywhere in the ordinary range
// existed, at least one of ten-plus genuine attempts would have tripped it.
// Fewer conclusive responses than this and the collector has not actually
// exercised enough of the target's behaviour to rule a limiter out — that
// case is reported as unavailable, not as a "no rate limiting" fact, no
// matter how confidently worded the alternative would read. This bar does
// not apply to a positive result (a 429 actually seen): detecting that the
// limiter fired is real evidence the very first time it happens, unlike
// ruling out that it exists.
const MIN_CONCLUSIVE_FOR_ABSENCE_CLAIM = RATE_LIMIT_BURST / 2;
const MAX_REDIRECTS = 5;
const ABSENT_PATH = '/__app-audit-probe-404-check__';

// --- 9.1 guard --------------------------------------------------------------
//
// This is the safety-critical function in this file. A burst of 20 requests
// at an authentication endpoint is exactly the kind of thing that is fine
// against your own app and abusive against someone else's. The guard is the
// only thing standing between "helpful audit" and "unsolicited load test of
// a stranger's login form", so it fails closed: anything that isn't
// recognisably local requires explicit, opted-in consent via --i-own-this.
//
// The guard only ever inspects the URL string it is handed — it cannot see
// where a request ends up after a redirect. That is why the burst path below
// only ever follows a redirect that stays on the SAME origin the guard
// approved (see safeFetch's crossOriginBudget option, passed as 0 for the
// burst): a guard that approved one literal target URL must not be treated
// as having approved wherever a 3xx response on that target later points.
// Same-origin redirects are still followed, though (not refused outright) —
// an auth endpoint that 302s to a "you're signed in" page on success is
// completely ordinary, and refusing to follow it would make the burst blind
// to the target's real behaviour, reporting "no rate limiting" from nothing
// but unfollowed 302s even when a limiter is genuinely tripping past that
// redirect.

export function guardRateLimitProbe({ url, iOwnThis }) {
  const host = new URL(url).hostname;
  if (LOCAL.test(host)) return { allowed: true };
  if (iOwnThis) return { allowed: true };
  return {
    allowed: false,
    reason: `refusing to burst-probe ${host}: pass --i-own-this to confirm you are authorised. Rate-limit probing an unowned host is abusive.`,
  };
}

// --- 8.7 / 10.3: response headers -------------------------------------------

export function headerFacts(res, url, opts = {}) {
  const facts = [];
  for (const h of SECURITY_HEADERS) {
    const v = res.headers.get(h);
    facts.push({
      probe: '8.7',
      fact: v ? `${h}: ${v}` : `${h} absent`,
      source: `header:${h} @ ${url}`,
      class: 'inspected',
    });
  }
  if (opts.authenticated) {
    const cc = res.headers.get('cache-control');
    facts.push({
      probe: '10.3',
      fact: cc
        ? `authenticated response sends Cache-Control: ${cc}`
        : 'authenticated response sends no Cache-Control header; shared caches may store it',
      source: `header:cache-control @ ${url}`,
      class: 'inspected',
    });
  }
  return facts;
}

// --- 2.3: error body shape ---------------------------------------------------

export function errorShapeFacts(res, body, url) {
  if (res.status < 400) return [];
  const looksInternal = /\n\s+at\s|Traceback|ECONNREFUSED|panic:|SQLSTATE/.test(body);
  return [{
    probe: '2.3',
    fact: looksInternal
      ? `${res.status} response body contains an internal stack trace or driver error (${body.length} bytes)`
      : `${res.status} response body is ${body.length} bytes, no stack trace detected`,
    source: `${url} → ${res.status}`,
    class: 'inspected',
  }];
}

// --- network helpers ---------------------------------------------------------
//
// Every request in this module goes through safeFetch so a target that never
// responds degrades into recorded evidence (a timeout is data — "the server
// didn't answer" — not a reason to crash the collector or hang the suite).
//
// redirect is always 'manual': undici's default of following redirects meant
// a single fetch() call could silently leave the URL the caller asked for and
// land on a different host with no record of it happening. followRedirects
// controls whether a 3xx is chased at all; crossOriginBudget caps how many
// times, across the whole chain, the ORIGIN is allowed to change (scheme +
// host + port) — same-origin hops are always free and unbounded (up to
// MAX_REDIRECTS), since the guard already approved that host and staying on
// it carries no new exposure.
//
// The budget differs by caller on purpose:
//   - the 9.1 burst passes crossOriginBudget: 0 — it repeats 20 times, so
//     even one free cross-origin hop per iteration would let a decoy the
//     guard approved carry the whole burst onto a host it would have
//     refused, exactly as if redirects were followed unconditionally.
//   - the one-shot header/error probes default to crossOriginBudget: 1 —
//     they each run once, so one hop caps the total attacker-chosen
//     destinations at (number of one-shot probes) regardless of how long a
//     chain the target constructs; a chain that tries to hop origins twice
//     is refused at the second attempt, not followed and then noticed.
// Either way, the guard's refusal is never bypassable by adding more hops.
async function singleFetch(url, init, timeoutMs) {
  try {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, res };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      reason: timedOut
        ? `request to ${url} timed out after ${timeoutMs}ms with no response`
        : `request to ${url} failed: ${err.message}`,
    };
  }
}

function isRedirect(res) {
  return res.status >= 300 && res.status < 400 && res.headers.has('location');
}

async function safeFetch(url, init = {}, { timeoutMs = REQUEST_TIMEOUT_MS, followRedirects = true, crossOriginBudget = 1 } = {}) {
  let currentUrl = url;
  let currentOrigin;
  try {
    currentOrigin = new URL(url).origin;
  } catch {
    currentOrigin = null;
  }
  let crossOriginHopsUsed = 0;

  for (let hop = 0; ; hop++) {
    const result = await singleFetch(currentUrl, init, timeoutMs);
    if (!result.ok) return result;
    const { res } = result;
    if (!followRedirects || !isRedirect(res)) {
      return { ok: true, res, url: currentUrl };
    }
    if (hop >= MAX_REDIRECTS) {
      await dropBody(res);
      return {
        ok: false,
        reason: `too many redirects starting at ${url} (stopped after ${MAX_REDIRECTS} hops, last at ${currentUrl})`,
      };
    }
    let nextUrl;
    try {
      nextUrl = new URL(res.headers.get('location'), currentUrl).toString();
    } catch (err) {
      await dropBody(res);
      return { ok: false, reason: `redirect from ${currentUrl} carried an unparseable Location header: ${err.message}` };
    }
    const nextOrigin = new URL(nextUrl).origin;
    if (nextOrigin !== currentOrigin) {
      if (crossOriginHopsUsed >= crossOriginBudget) {
        // The chain has already used its cross-origin allowance. Stop here
        // and report this hop's response as the outcome — never keep
        // dialing attacker-chosen hosts because there happen to be more of
        // them further down the chain.
        return { ok: true, res, url: currentUrl, redirectRefused: true, refusedTarget: nextUrl };
      }
      crossOriginHopsUsed += 1;
    }
    await dropBody(res);
    currentUrl = nextUrl;
    currentOrigin = nextOrigin;
  }
}

// A response whose body this collector has no use for (every header-only
// check, and every burst iteration) still needs its body released, or the
// connection cannot be freed and the target is left holding an open socket
// per request the collector never intended to keep alive. Best-effort: a
// body that fails to cancel cleanly is not itself evidence of anything.
async function dropBody(res) {
  try {
    await res.body?.cancel();
  } catch {
    // ignored — see comment above
  }
}

// Two independent sources (a base URL, and an authenticated route) can land
// on the identical final URL — most commonly a "/" that redirects straight
// onto the auth path, an extremely ordinary deployment shape — and produce
// byte-identical fact objects for the same observation. Recording the same
// evidence twice makes the pack look like it covers more ground than it
// does, so exact duplicates (same probe, same fact text, same source) are
// collapsed to the first occurrence.
function dedupeFacts(facts) {
  const seen = new Set();
  const result = [];
  for (const f of facts) {
    const key = `${f.probe}|${f.fact}|${f.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(f);
  }
  return result;
}

// Body reads are guarded the same way requests are: the AbortSignal handed
// to fetch() covers the whole response lifetime including body streaming, so
// a target that sends headers and then stalls (a slow-loris response) aborts
// mid-.text() with the fetch already reported as {ok:true}. Left unguarded,
// that abort is an uncaught rejection that kills the whole collector run —
// every fact gathered before it is discarded and no document is produced.
async function safeReadText(res, url) {
  try {
    const body = await res.text();
    return { ok: true, body };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      reason: timedOut
        ? `response body from ${url} stalled and was aborted before it finished arriving`
        : `response body from ${url} could not be read: ${err.message}`,
    };
  }
}

// --- 5.7: TLS certificate expiry ---------------------------------------------

function tlsExpiryFact(url, timeoutMs) {
  return new Promise((settlePromise) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      settlePromise(result);
    };

    const parsed = new URL(url);
    const port = parsed.port ? Number(parsed.port) : 443;
    // SNI (servername) is only meaningful for a hostname; RFC 6066 forbids
    // it for an IP literal and Node emits a deprecation warning if it's set
    // anyway. Bracketed IPv6 hostnames come through from URL parsing without
    // the brackets, so both forms need to be caught.
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname) || parsed.hostname.includes(':');
    // rejectUnauthorized is deliberately false: this probe's job is to read
    // whatever certificate the server presents and report its expiry — an
    // expired or self-signed certificate is exactly the finding 5.7 exists
    // to surface, and rejectUnauthorized: true would abort the handshake
    // before getPeerCertificate() ever runs, hiding the expiry date behind a
    // generic "certificate error" instead of reporting it. The chain-trust
    // question this trades away is not swallowed, though — socket.authorized
    // and socket.authorizationError are captured below and folded into the
    // fact, so an untrusted/MITM-able chain is visible evidence, not a
    // silent risk. No data is exchanged over this connection beyond the
    // handshake itself.
    const socket = tlsConnect({
      host: parsed.hostname,
      port,
      ...(isIpLiteral ? {} : { servername: parsed.hostname }),
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const { authorized, authorizationError } = socket;
      socket.end();
      if (!cert || !cert.valid_to) {
        settle({ ok: false, reason: `TLS handshake to ${parsed.hostname}:${port} succeeded but exposed no certificate details` });
        return;
      }
      const validTo = new Date(cert.valid_to);
      const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
      settle({ ok: true, hostname: parsed.hostname, port, validTo: cert.valid_to, daysRemaining, authorized, authorizationError });
    });
    socket.once('timeout', () => {
      socket.destroy();
      settle({ ok: false, reason: `TLS connection to ${parsed.hostname}:${port} timed out after ${timeoutMs}ms` });
    });
    socket.once('error', (err) => {
      settle({ ok: false, reason: `TLS connection to ${parsed.hostname}:${port} failed: ${err.message}` });
    });
  });
}

// Pure and exported specifically so this one-line decision has a test that
// doesn't require an actual working https connection: an http origin that
// redirects to https should get its TLS probe run against the URL the base
// fetch actually landed on, not the literal --url string, or the probe
// permanently reports "origin is http:" despite having just contacted the
// https endpoint moments before. baseResult is whatever safeFetch returned
// for the base URL (an { ok, url } on success, or { ok: false, reason } on
// failure); when the fetch itself failed there is no "landed on" URL to
// fall back to, so the literal baseUrl is used instead — a wrong scheme
// there is exactly the origin.protocol !== 'https:' branch this probe
// already reports cleanly.
export function resolveTlsTarget(baseResult, baseUrl) {
  return baseResult.ok ? baseResult.url : baseUrl;
}

async function tlsExpiryFacts(baseUrl, timeoutMs) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (err) {
    return { facts: [], unavailable: [{ probe: '5.7', reason: `could not parse ${baseUrl} as a URL: ${err.message}` }] };
  }

  if (parsed.protocol !== 'https:') {
    return {
      facts: [],
      unavailable: [{ probe: '5.7', reason: `origin is ${parsed.protocol} not https:; TLS certificate probing requires an https origin` }],
    };
  }

  const result = await tlsExpiryFact(baseUrl, timeoutMs);
  if (!result.ok) return { facts: [], unavailable: [{ probe: '5.7', reason: result.reason }] };

  const expiry = result.daysRemaining >= 0
    ? `expires ${result.validTo} (${result.daysRemaining} day(s) remaining)`
    : `expired ${result.validTo} (${Math.abs(result.daysRemaining)} day(s) ago)`;
  // Chain trust is reported alongside expiry rather than gating collection
  // of it — see the comment in tlsExpiryFact for why the connection accepts
  // untrusted certs in the first place.
  const trust = result.authorized ? 'chain verified' : `chain NOT verified (${result.authorizationError ?? 'untrusted'})`;
  const fact = `TLS certificate for ${result.hostname} ${expiry}; ${trust}`;
  return {
    facts: [{ probe: '5.7', fact, source: `tls:${result.hostname}:${result.port}`, class: 'inspected' }],
    unavailable: [],
  };
}

// --- 9.1: rate-limit burst ----------------------------------------------------
//
// Deliberately a plain for-await loop, not Promise.all — the point of the
// probe is to observe whether a limit engages as request count climbs over
// real wall-clock time, which a concurrent burst would not demonstrate.
// crossOriginBudget: 0 on every iteration — see the safeFetch/guard comments.
//
// Each request lands in exactly one bucket:
//   - a real status code (including a redirect the target itself resolved,
//     e.g. same-origin 302 -> 200) — this is CONCLUSIVE: the app's actual
//     behaviour under load was observed, whether or not it happens to be 429.
//   - "(no response)" — the request failed or timed out; no evidence either
//     way.
//   - "(cross-origin redirect refused)" — the chain tried to leave the
//     approved origin and was stopped; no evidence either way, since the
//     app's real response was never seen.
// `conclusive` counts only the first bucket. A 429 is definitive regardless
// of how many other requests landed in the other two buckets — seeing the
// limiter engage once is real evidence it exists. Absence is a different
// claim and needs a different bar: "no rate limiting observed" requires not
// just conclusive > 0 but conclusive >= MIN_CONCLUSIVE_FOR_ABSENCE_CLAIM
// (see collectLive) — one conclusive response out of twenty is exactly as
// unable to rule out a limiter as zero is, since a limiter that trips well
// within the burst's normal range could simply never have been reached by
// the other nineteen, which died as noise before ever exercising it.

async function burstProbe(url, timeoutMs, budgetMs) {
  const statusCounts = {};
  let sawLimit = false;
  let hitAt = null;
  let retryAfter = null;
  let sent = 0;
  let conclusive = 0;
  const start = Date.now();

  for (let i = 1; i <= RATE_LIMIT_BURST; i++) {
    if (Date.now() - start > budgetMs) break;
    sent = i;
    const result = await safeFetch(url, {}, { timeoutMs, followRedirects: true, crossOriginBudget: 0 });
    if (!result.ok) {
      statusCounts['(no response)'] = (statusCounts['(no response)'] ?? 0) + 1;
      continue;
    }
    if (result.redirectRefused) {
      statusCounts['(cross-origin redirect refused)'] = (statusCounts['(cross-origin redirect refused)'] ?? 0) + 1;
      await dropBody(result.res);
      continue;
    }
    conclusive += 1;
    const { status } = result.res;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (status === 429 && !sawLimit) {
      sawLimit = true;
      hitAt = i;
      retryAfter = result.res.headers.get('retry-after');
    }
    await dropBody(result.res);
  }

  return { sawLimit, hitAt, retryAfter, statusCounts, sent, conclusive };
}

function rateLimitFact(target, burst) {
  const counts = Object.entries(burst.statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ');
  const stoppedEarly = burst.sent < RATE_LIMIT_BURST;
  const budgetNote = stoppedEarly
    ? ` (stopped early after the overall time budget elapsed — only ${burst.sent}/${RATE_LIMIT_BURST} requests sent)`
    : '';
  const fact = burst.sawLimit
    ? `rate limiting engaged: request ${burst.hitAt}/${RATE_LIMIT_BURST} to ${target} returned 429${
        burst.retryAfter ? ` with Retry-After: ${burst.retryAfter}` : ' with no Retry-After header'
      }${budgetNote}`
    : `no rate limiting observed across ${burst.conclusive}/${burst.sent} conclusive sequential requests to ${target} (status counts — ${counts})${budgetNote}`;
  return { probe: '9.1', fact, source: `${burst.sent} sequential requests @ ${target}`, class: 'inspected' };
}

// --- composition --------------------------------------------------------------

export async function collectLive(opts, deps = {}) {
  const guard = deps.guard ?? guardRateLimitProbe;
  const baseUrl = opts.url;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const rateLimitBudgetMs = opts.rateLimitBudgetMs ?? RATE_LIMIT_BUDGET_MS;
  const collectedAt = new Date().toISOString();
  const facts = [];
  const unavailable = [];

  // 8.7 is collected from up to two independent sources (base URL, and the
  // authenticated route if one was given) and reconciled once at the end —
  // the same discipline repo.mjs applies to 8.4 across multiple roots: a
  // probe with real evidence from any source belongs in facts, with any
  // other source's failure folded in as a coverage note there too, never as
  // a contradictory unavailable[] entry for a probe that otherwise has data.
  const eight7Facts = [];
  const eight7Failures = []; // { source, reason }

  // 8.7 (base): security headers on the base URL.
  const baseResult = await safeFetch(baseUrl, {}, { timeoutMs });
  if (baseResult.ok) {
    eight7Facts.push(...headerFacts(baseResult.res, baseResult.url));
    await dropBody(baseResult.res);
  } else {
    eight7Failures.push({ source: baseUrl, reason: baseResult.reason });
  }

  // 10.3 (+ additional 8.7 coverage): Cache-Control and headers on an
  // authenticated route, only if one was given — there is nothing to inspect
  // without an authenticated route to fetch. authRequestUrl is the literal
  // --auth-path resolved against the base URL: it is used later as the
  // rate-limit target and passed to the guard, and is deliberately NOT
  // replaced by wherever this single header-check request redirected to —
  // the burst target must stay the address the user actually asked to
  // probe, not something that drifted because of a redirect encountered
  // during an unrelated check.
  let authRequestUrl = null;
  if (opts.authPath) {
    try {
      authRequestUrl = new URL(opts.authPath, baseUrl).toString();
    } catch (err) {
      unavailable.push({
        probe: '10.3',
        reason: `could not resolve --auth-path "${opts.authPath}" against ${baseUrl}: ${err.message}`,
      });
    }
    if (authRequestUrl) {
      const authResult = await safeFetch(authRequestUrl, {}, { timeoutMs });
      if (authResult.ok) {
        const authHeaderFacts = headerFacts(authResult.res, authResult.url, { authenticated: true });
        eight7Facts.push(...authHeaderFacts.filter((f) => f.probe === '8.7'));
        facts.push(...authHeaderFacts.filter((f) => f.probe === '10.3'));
        await dropBody(authResult.res);
      } else {
        eight7Failures.push({ source: authRequestUrl, reason: authResult.reason });
        unavailable.push({ probe: '10.3', reason: authResult.reason });
      }
    }
  } else {
    unavailable.push({ probe: '10.3', reason: 'no --auth-path given; cannot inspect Cache-Control on an authenticated route' });
  }

  if (eight7Facts.length > 0) {
    facts.push(...dedupeFacts(eight7Facts));
    for (const failure of eight7Failures) {
      facts.push({
        probe: '8.7',
        fact: `security headers could not be checked at ${failure.source}: ${failure.reason} (other 8.7 facts above cover a route that did answer)`,
        source: failure.source,
        class: 'inspected',
      });
    }
  } else if (eight7Failures.length > 0) {
    unavailable.push({ probe: '8.7', reason: eight7Failures.map((f) => f.reason).join('; ') });
  }

  // 5.7: TLS certificate expiry, https origins only. Uses the URL the base
  // fetch actually landed on, not the literal --url string — an http origin
  // that redirects to https (an exceedingly common deployment pattern) has
  // already had that https endpoint contacted moments ago by baseResult;
  // re-checking the original http string here would report "origin is
  // http:, not https:" and permanently miss a TLS probe the collector was
  // otherwise fully able to perform.
  const tlsTargetUrl = resolveTlsTarget(baseResult, baseUrl);
  const tls = await tlsExpiryFacts(tlsTargetUrl, timeoutMs);
  facts.push(...tls.facts);
  unavailable.push(...tls.unavailable);

  // 2.3: sample error-body shape from a deliberately absent path.
  let absentUrl;
  try {
    absentUrl = new URL(ABSENT_PATH, baseUrl).toString();
  } catch (err) {
    unavailable.push({ probe: '2.3', reason: `could not construct a probe path against ${baseUrl}: ${err.message}` });
  }
  if (absentUrl) {
    const absentResult = await safeFetch(absentUrl, {}, { timeoutMs });
    if (!absentResult.ok) {
      unavailable.push({ probe: '2.3', reason: absentResult.reason });
    } else {
      const bodyResult = await safeReadText(absentResult.res, absentResult.url);
      if (!bodyResult.ok) {
        unavailable.push({ probe: '2.3', reason: bodyResult.reason });
      } else {
        const errorFacts = errorShapeFacts(absentResult.res, bodyResult.body, absentResult.url);
        if (errorFacts.length > 0) {
          facts.push(...errorFacts);
        } else {
          unavailable.push({
            probe: '2.3',
            reason: `probe path ${absentResult.url} returned ${absentResult.res.status} (not an error status); could not sample an error response body`,
          });
        }
      }
    }
  }

  // 9.1: rate-limit burst, guarded — only when explicitly requested, and
  // never fired unless the guard allows it. The guard call itself is
  // wrapped: a target so malformed that hostname extraction throws must
  // fail closed (no burst), not crash the whole collector.
  if (opts.probeRateLimit) {
    const rateLimitTarget = authRequestUrl ?? baseUrl;
    let check;
    try {
      check = guard({ url: rateLimitTarget, iOwnThis: !!opts.iOwnThis });
    } catch (err) {
      check = { allowed: false, reason: `could not determine target host safety for ${rateLimitTarget}: ${err.message}` };
    }
    if (!check.allowed) {
      unavailable.push({ probe: '9.1', reason: check.reason });
    } else {
      const burst = await burstProbe(rateLimitTarget, timeoutMs, rateLimitBudgetMs);
      if (!burst.sawLimit && burst.conclusive < MIN_CONCLUSIVE_FOR_ABSENCE_CLAIM) {
        // Too few requests in the burst actually resolved to a real,
        // observed response — the rest died as noise (unanswered, or a
        // cross-origin redirect correctly left unfollowed) — to say
        // anything about whether a limiter exists. This covers both zero
        // conclusive responses AND the thinner case a single conclusive
        // response among nineteen failures: neither is enough sample that
        // a limiter tripping somewhere in its normal range would have been
        // reached. "No rate limiting observed" would be a claim this
        // collector doesn't have the evidence for, on a probe that carries
        // gate G7: telling a client their auth endpoint is unprotected when
        // it might well be protected — and simply wasn't exercised enough
        // to find out — is worse than saying nothing.
        const counts = Object.entries(burst.statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
        unavailable.push({
          probe: '9.1',
          reason: `only ${burst.conclusive}/${burst.sent} sequential request(s) to ${rateLimitTarget} produced a conclusive response — need at least ${MIN_CONCLUSIVE_FOR_ABSENCE_CLAIM} to rule out rate limiting across the burst's normal trip range (status counts — ${counts})`,
        });
      } else {
        facts.push(rateLimitFact(rateLimitTarget, burst));
      }
    }
  }

  return {
    tier: 'live',
    collectedAt,
    target: { url: baseUrl },
    facts,
    unavailable,
  };
}
