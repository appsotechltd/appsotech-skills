#!/usr/bin/env node
// Verifies responsive behaviour and dark mode against a real browser.
//
//   responsive-check.mjs <url-or-file> [--widths 320,768,1280]
//                        [--out design/responsive] [--json] [--no-shots]
//
// The gate asks whether a layout works at three widths and whether dark mode
// is implemented. Both were trusted rather than checked: reading a stylesheet
// cannot tell you that a fixed-width table pushes the page 40px wide at 320,
// and nothing at all catches a dark block that was written but never wired up.
//
// Playwright is NOT a dependency of this repository. It is resolved from the
// target project or from a global install, and the run degrades with a clear
// message when it is absent — the same three-tier posture the design engine
// uses.

import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve, isAbsolute, extname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VIEWPORTS = [
  // 320 is the narrowest phone still in real use; anything that survives it
  // survives everything above.
  { name: 'mobile', width: 320, height: 640 },
  // The width most often skipped — a layout that jumps straight from stacked
  // to desktop grid looks like a stretched phone right here.
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

export const TAP_MIN = 44;
export const MOBILE_MAX = 640;
// Below 16px, iOS zooms the viewport when a form control takes focus. This is
// a hard, mechanical consequence, not a readability preference.
export const IOS_ZOOM_FLOOR = 16;

// --- resolving playwright ---------------------------------------------------

export function playwrightCandidates(projectDir = '.') {
  const globalRoot = (() => {
    try {
      return execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  })();
  return [
    join(resolve(projectDir), 'node_modules', 'playwright', 'index.mjs'),
    join(resolve(projectDir), 'node_modules', 'playwright-core', 'index.mjs'),
    globalRoot && join(globalRoot, 'playwright', 'index.mjs'),
    globalRoot && join(globalRoot, 'playwright-core', 'index.mjs'),
  ].filter(Boolean);
}

export function resolvePlaywright(projectDir = '.') {
  return playwrightCandidates(projectDir).find((p) => existsSync(p)) ?? null;
}

// A built Vite or Next export is a directory of files with a client-side
// router, and file:// breaks both absolute asset paths and any deep link. This
// serves it over http so a check on a real build is one command instead of
// "start a server in another terminal, then run this".
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Resolves a request path inside root, refusing anything that escapes it.
// `..` in a URL is the oldest static-server bug there is, and this server is
// pointed at a build directory on someone's machine.
export function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  // A trailing slash survives normalize(), so "/" resolves to "<root>/" and
  // compares unequal to the root itself. Stripping it keeps the return value
  // canonical and the containment check a plain string comparison.
  const full = normalize(join(root, decoded)).replace(/\/+$/, '') || '/';
  const base = resolve(root).replace(/\/+$/, '') || '/';
  // The `base + '/'` prefix matters: a sibling named `<base>-evil` starts with
  // base as a string but is not inside it.
  return full === base || full.startsWith(base + '/') ? full : null;
}

export function serveDir(root) {
  const server = createServer((req, res) => {
    const target = safeJoin(root, req.url ?? '/');
    if (!target) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let file = target;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    // SPA fallback: a client-side router owns deep links, so a miss serves
    // index.html rather than 404 — the same rule the nginx config uses.
    if (!existsSync(file)) file = join(resolve(root), 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.on('error', fail);
    // Port 0 lets the OS pick a free one, so concurrent runs cannot collide.
    server.listen(0, '127.0.0.1', () => ok({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

export function targetUrl(target) {
  if (/^https?:\/\//.test(target)) return target;
  const abs = isAbsolute(target) ? target : resolve(target);
  if (!existsSync(abs)) return null;
  return pathToFileURL(abs).href;
}

// --- the in-page analysis ---------------------------------------------------

// Runs inside the browser. Must be self-contained — it is serialised across,
// so it cannot close over anything in this module.
export function analysePage() {
  const vw = window.innerWidth;
  const findings = [];
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // 1. Page-level horizontal overflow.
  const docWidth = document.documentElement.scrollWidth;
  if (docWidth > vw + 1) {
    findings.push({
      rule: 'page-overflow', severity: 'error',
      text: `document scrolls to ${docWidth}px in a ${vw}px viewport`,
      why: 'the page itself scrolls sideways — wide content must scroll inside its own container, not move the page',
    });
  }

  // 2. Which elements cause it. Without this the finding is unactionable.
  //
  // An element inside an overflow-x:auto|scroll|hidden ancestor is the
  // PRESCRIBED pattern for wide tables and code blocks, so it is exempt —
  // flagging it would penalise the documented fix.
  const scrollsInsideContainer = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };
  if (docWidth > vw + 1) {
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (scrollsInsideContainer(el)) continue;
      culprits.push({ el: describe(el), right: Math.round(r.right), width: Math.round(r.width) });
      if (culprits.length >= 5) break;
    }
    for (const c of culprits) {
      findings.push({
        rule: 'overflow-culprit', severity: 'error',
        text: `${c.el} extends to ${c.right}px (width ${c.width})`,
        why: 'give it max-width:100%, or wrap it in an overflow-x:auto container',
      });
    }
  }

  // 3. Tap targets.
  const interactive = document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick]');
  const seen = new Set();
  for (const el of interactive) {
    if (!visible(el)) continue;
    if (el.disabled) continue;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 44 && r.height >= 44) continue;

    // WCAG 2.5.8 exempts a target inside a sentence or block of text — an
    // inline link in body copy is not a sizing failure, and flagging it would
    // make the report unusable on any page with prose.
    const inline = getComputedStyle(el).display.startsWith('inline');
    const parentText = el.parentElement?.textContent?.trim().length ?? 0;
    const ownText = el.textContent?.trim().length ?? 0;
    if (inline && el.tagName === 'A' && parentText > ownText + 20) continue;

    const key = describe(el) + Math.round(r.top);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      rule: 'tap-target', severity: 'error',
      text: `${describe(el)} is ${Math.round(r.width)}×${Math.round(r.height)}`,
      why: 'below 44×44px — extend the target with padding, the visual box may stay smaller',
    });
    if (findings.filter((f) => f.rule === 'tap-target').length >= 10) break;
  }

  // 4. Form controls below the iOS zoom floor. Precise: this is about form
  // controls specifically, where the consequence is a viewport jump on focus.
  if (vw <= 640) {
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= 16) continue;
      findings.push({
        rule: 'ios-zoom-font', severity: 'error',
        text: `${describe(el)} font-size ${size}px`,
        why: 'below 16px, iOS zooms the viewport when this control takes focus',
      });
    }

    // Long-form copy below 16px. Heuristic, so it warns: a 12px caption is
    // legitimate and short, a 13px paragraph is neither.
    for (const el of document.querySelectorAll('p, li, td')) {
      if (!visible(el)) continue;
      const text = el.textContent?.trim() ?? '';
      if (text.length < 80) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= 16) continue;
      findings.push({
        rule: 'small-body-text', severity: 'warn',
        text: `${describe(el)} font-size ${size}px on ${text.length} chars`,
        why: 'long-form text below 16px on mobile',
      });
    }
  }

  return {
    findings,
    docWidth,
    viewportWidth: vw,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
  };
}

// --- reporting --------------------------------------------------------------

// Layout does not usually change with the colour scheme, so a page that
// overflows at 320px reports it once per scheme and the report doubles in
// length for no added information. A finding already seen in light is dropped
// from dark — but one that appears ONLY in dark is kept and labelled, because
// that is a real dark-specific regression and the whole reason the dark pass
// runs the same checks at all.
export function summarise(results) {
  const seen = new Set();
  const findings = [];
  const key = (f, viewport) => `${viewport}|${f.rule}|${f.text}`;

  for (const r of results.filter((x) => x.scheme === 'light')) {
    for (const f of r.findings) {
      seen.add(key(f, r.viewport));
      findings.push({ ...f, viewport: r.viewport, scheme: 'light' });
    }
  }
  for (const r of results.filter((x) => x.scheme === 'dark')) {
    for (const f of r.findings) {
      if (seen.has(key(f, r.viewport))) continue;
      findings.push({
        ...f, viewport: r.viewport, scheme: 'dark',
        why: `${f.why} — appears only in dark mode`,
      });
    }
  }

  return {
    findings,
    errors: findings.filter((f) => f.severity === 'error').length,
    warns: findings.filter((f) => f.severity === 'warn').length,
  };
}

// Dark mode is a hard requirement, and "the .dark block exists" is not the
// same as "dark mode is wired up". If the rendered body is identical under
// both colour schemes, nothing is switching.
export function darkModeFinding(lightProbe, darkProbe) {
  if (!lightProbe || !darkProbe) return null;
  if (lightProbe.bodyBackground !== darkProbe.bodyBackground) return null;
  if (lightProbe.bodyColor !== darkProbe.bodyColor) return null;
  return {
    rule: 'dark-mode-missing', severity: 'error', viewport: 'all', scheme: 'dark',
    text: `body renders ${lightProbe.bodyBackground} under both colour schemes`,
    why: 'prefers-color-scheme: dark changes nothing — the dark tokens are not wired to the document',
  };
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const noShots = args.includes('--no-shots');
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : fallback;
  };
  const serveRoot = flag('--serve', null);
  const routePath = flag('--path', '/');
  const consumed = new Set([flag('--widths', null), flag('--out', null), serveRoot, flag('--path', null)]);
  const target = args.find((a) => !a.startsWith('--') && !consumed.has(a));

  if (!target && !serveRoot) {
    console.error('usage: responsive-check.mjs <url-or-html-file> [--widths 320,768,1280]');
    console.error('       responsive-check.mjs --serve <build-dir> [--path /route]');
    console.error('       [--out design/responsive] [--json] [--no-shots]');
    process.exit(2);
  }

  // Checked before anything is started. Without a browser there is nothing to
  // serve a page to, and binding a port only to exit is noise.
  const pwPath = resolvePlaywright('.');
  if (!pwPath) {
    // Degrade the way the design engine does: say what is missing and why the
    // check did not happen, rather than failing the build or passing silently.
    console.error(
      'Playwright not found — responsive and dark-mode checks did not run.\n' +
        'Install it in the project (`npm i -D playwright`) or globally, then re-run.\n' +
        'Until then these gate items must be checked by hand at 320, 768 and 1280px.');
    process.exit(3);
  }

  let server = null;
  let url;
  if (serveRoot) {
    if (!existsSync(serveRoot) || !statSync(serveRoot).isDirectory()) {
      console.error(`--serve: not a directory: ${serveRoot}`);
      process.exit(2);
    }
    if (!existsSync(join(serveRoot, 'index.html'))) {
      // Pointing at src/ instead of dist/ otherwise reports a blank page as
      // clean, which is the most convincing possible false pass.
      console.error(
        `--serve: no index.html in ${serveRoot} — point this at the BUILD output ` +
          '(dist/, out/) rather than the source directory.');
      process.exit(2);
    }
    server = await serveDir(serveRoot);
    url = server.url + (routePath.startsWith('/') ? routePath : `/${routePath}`);
  } else {
    url = targetUrl(target);
    if (!url) {
      console.error(`no such file, and not a URL: ${target}`);
      process.exit(2);
    }
  }

  const widths = flag('--widths', null)
    ? flag('--widths', '').split(',').map((w) => ({ name: `${w.trim()}px`, width: Number(w.trim()), height: 900 }))
    : VIEWPORTS;
  if (widths.some((v) => !Number.isFinite(v.width) || v.width < 200)) {
    console.error('--widths must be comma-separated pixel numbers ≥ 200');
    process.exit(2);
  }

  const outDir = flag('--out', join('design', 'responsive'));
  if (!noShots) mkdirSync(outDir, { recursive: true });

  const { chromium } = await import(pwPath);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let lightProbe = null;
  let darkProbe = null;

  try {
    for (const scheme of ['light', 'dark']) {
      for (const vp of widths) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme: scheme,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const probe = await page.evaluate(analysePage);
        results.push({ viewport: vp.name, scheme, findings: probe.findings });

        if (vp.width === widths[widths.length - 1].width) {
          if (scheme === 'light') lightProbe = probe;
          else darkProbe = probe;
        }
        if (!noShots) {
          await page.screenshot({
            path: join(outDir, `${vp.name}-${scheme}.png`),
            fullPage: true,
          });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  const summary = summarise(results);
  const dark = darkModeFinding(lightProbe, darkProbe);
  if (dark) {
    summary.findings.push(dark);
    summary.errors += 1;
  }

  if (asJson) {
    console.log(JSON.stringify({ url, ...summary }, null, 2));
  } else {
    let last = null;
    for (const f of summary.findings) {
      const head = `${f.viewport} / ${f.scheme}`;
      if (head !== last) { console.log(`\n${head}`); last = head; }
      const tag = f.severity === 'error' ? 'ERROR' : ' warn';
      console.log(`  ${tag} ${f.rule}: ${f.text}`);
      console.log(`        ${f.why}`);
    }
    console.log(
      `\n${widths.length} width(s) × 2 schemes — ${summary.errors} error(s), ${summary.warns} warning(s).`);
    if (!noShots) console.log(`Screenshots in ${outDir}/`);
    if (summary.findings.length === 0) console.log('Nothing to fix.');
  }

  process.exit(summary.errors > 0 ? 1 : 0);
}
