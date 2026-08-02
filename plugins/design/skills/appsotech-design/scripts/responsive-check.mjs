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
  // 1440×900 rather than 1280: it is the commonest desktop viewport in the
  // suite's analytics, and the composition brief's measurements were taken at
  // it. The content-coverage check below depends on a realistic desktop area.
  { name: 'desktop', width: 1440, height: 900 },
];

// A width probe answers "does this overflow sideways". This one answers a
// different question — "does anything get cut off vertically" — so it is kept
// separate rather than appended to the list above. A phone held sideways is
// around 360px tall, and every viewport above is tall enough to hide the
// problem completely.
export const SHORT_VIEWPORT = { name: 'landscape', width: 740, height: 360 };

// What the CLI actually runs when no --widths override is given.
export const PROBES = [...VIEWPORTS, SHORT_VIEWPORT];

// Below this height the short-viewport checks turn on, in the page and in the
// runner alike.
export const SHORT_MAX = 480;

export const TAP_MIN = 44;
// Below this share of the desktop viewport, a page is not using its canvas —
// the floating-login-card failure. Composition, not correctness, so it warns.
export const CONTENT_MIN = 0.4;
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
  // Both sides must be absolute or the comparison is meaningless: with a
  // RELATIVE root — `--serve apps/webapp/dist`, which is what the skill
  // documents — a normalize()d join stays relative while the base resolves to
  // an absolute path, so nothing ever matches and every request 403s.
  // resolve() also collapses `..`, which is what makes the containment check
  // an escape check.
  const full = resolve(join(root, decoded)).replace(/\/+$/, '') || '/';
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

  // 5. A short viewport — a phone in landscape is around 360px tall.
  //
  // Every other probe here is tall, so a hero built as `height: 100vh` with
  // overflow hidden looks fine at 320×640 and eats its own CTA at 740×360.
  // The finding is deliberately narrow: a box whose CONTENT is cut off. A
  // `min-height` hero that simply grows taller than the screen is correct and
  // is not reported, because scrolling is the right answer there.
  const vh = window.innerHeight;
  if (vh <= 480) {
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < vh * 0.9) continue;
      const s = getComputedStyle(el);
      const clips = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if (!clips) continue;
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      findings.push({
        rule: 'short-viewport-clip', severity: 'error',
        text: `${describe(el)} shows ${Math.round(r.height)}px of ${el.scrollHeight}px`,
        why: `content is cut off at ${vw}×${vh} — use min-height, not height, and 100svh rather than 100vh`,
      });
      if (findings.filter((f) => f.rule === 'short-viewport-clip').length >= 5) break;
    }

    // Fixed chrome anchored top and bottom. On a tall phone a header plus a
    // bottom bar is fine; in landscape the same two can leave a reading slot
    // barely taller than themselves.
    let chrome = 0;
    const bars = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.8) continue;
      const anchored = r.top <= 4 || Math.abs(r.bottom - vh) <= 4;
      if (!anchored) continue;
      chrome += r.height;
      bars.push(`${describe(el)} ${Math.round(r.height)}px`);
    }
    if (chrome > vh * 0.5 && bars.length > 0) {
      findings.push({
        rule: 'short-viewport-chrome', severity: 'warn',
        text: `fixed chrome takes ${Math.round(chrome)}px of ${vh}px — ${bars.join(', ')}`,
        why: 'over half a landscape phone is chrome — collapse or hide it below a height breakpoint',
      });
    }
  }

  // 6. Rendered contrast.
  //
  // contrast.mjs checks token against token in the FILE. It cannot see a
  // token used against a background it was never paired with, a foreground at
  // reduced opacity, or text sitting on a photograph. This computes the
  // effective pair as the browser actually painted it.
  //
  // Anything it cannot resolve with certainty becomes advisory rather than a
  // failure — a contrast checker that cries wolf over every gradient is one
  // that gets switched off in a week.
  const parseRgb = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => {
      const n = c / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratioOf = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  // Walks up compositing background layers until something opaque is reached.
  // Stops and reports uncertainty at an image, a gradient or a translucent
  // ancestor, because none of those can be reduced to one colour.
  const effectiveBackground = (el) => {
    const stack = [];
    for (let p = el; p && p !== document.documentElement.parentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        return { uncertain: 'sits on an image or gradient' };
      }
      if (p !== el && parseFloat(s.opacity) < 1) {
        return { uncertain: 'an ancestor is translucent' };
      }
      const c = parseRgb(s.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return { colour: base };
  };

  const contrastSeen = new Set();
  let advisories = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (findings.filter((f) => f.rule === 'rendered-contrast').length >= 10) break;
    if (!visible(el)) continue;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (own.length < 2) continue;

    const s = getComputedStyle(el);
    const fgRaw = parseRgb(s.color);
    if (!fgRaw) continue;
    const bg = effectiveBackground(el);
    const key = `${describe(el)}|${own.slice(0, 24)}`;
    if (contrastSeen.has(key)) continue;
    contrastSeen.add(key);

    if (bg.uncertain) {
      if (advisories >= 3) continue;
      advisories++;
      findings.push({
        rule: 'contrast-unverifiable', severity: 'warn',
        text: `${describe(el)} — ${bg.uncertain}`,
        why: 'contrast could not be computed here — check by hand that the text holds 4.5:1 across the whole box, with a scrim if needed',
      });
      continue;
    }

    // WCAG 2.1: large text is 18pt (24px), or 14pt (18.66px) at 700+.
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const min = large ? 3 : 4.5;
    const fg = fgRaw.a < 1 ? over(fgRaw, bg.colour) : fgRaw;
    const ratio = ratioOf(fg, bg.colour);
    if (ratio >= min) continue;

    findings.push({
      rule: 'rendered-contrast', severity: 'error',
      text: `${describe(el)} ${ratio}:1 (needs ${min})`,
      why: `text as painted is below the floor${fgRaw.a < 1 ? ' — the foreground is translucent, which the token file cannot show' : ''}`,
    });
  }

  // 7. Content coverage — is the page using its viewport?
  //
  // Every other probe judges an element; this one judges the page. A 400px
  // card floating in an empty 1440×900 viewport passes every element check
  // and is still an unfinished page. "Content" is anything that paints:
  // text, replaced elements and controls, a non-transparent background, or a
  // deliberate full-height section (which is how a type-alone hero — a
  // legitimate archetype — is not penalised for its restraint).
  if (vw >= 1024) {
    const rects = [];
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const PAINTED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'TABLE']);
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const s = getComputedStyle(el);
      const ownText = Array.from(el.childNodes)
        .some((n) => n.nodeType === 3 && n.textContent.trim().length >= 2);
      const bg = s.backgroundColor;
      const paintedBg = bg && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(bg) && bg !== bodyBg;
      const tall = r.height >= vh * 0.5;
      if (!ownText && !PAINTED.has(el.tagName) && !paintedBg && !tall) continue;
      rects.push({
        left: Math.max(0, r.left), top: Math.max(0, r.top),
        right: Math.min(vw, r.right), bottom: Math.min(vh, r.bottom),
      });
    }
    // Union area on a coarse grid — exact rectangle union is overkill for a
    // 40% threshold, and 20px cells keep it a few thousand checks.
    const CELL = 20;
    const cols = Math.ceil(vw / CELL);
    const rows = Math.ceil(vh / CELL);
    const grid = new Uint8Array(cols * rows);
    for (const r of rects) {
      const c0 = Math.floor(r.left / CELL); const c1 = Math.ceil(r.right / CELL);
      const r0 = Math.floor(r.top / CELL); const r1 = Math.ceil(r.bottom / CELL);
      for (let y = r0; y < r1 && y < rows; y++) {
        for (let x = c0; x < c1 && x < cols; x++) grid[y * cols + x] = 1;
      }
    }
    let covered = 0;
    for (let i = 0; i < grid.length; i++) covered += grid[i];
    const coverage = covered / (cols * rows);
    if (coverage < 0.4) {
      findings.push({
        rule: 'sparse-page', severity: 'warn',
        text: `content covers ${Math.round(coverage * 100)}% of ${vw}×${vh}`,
        why: 'most of the viewport is empty — an archetype in archetypes.md almost certainly composes this page better than a floating card does',
      });
    }
  }

  return {
    findings,
    docWidth,
    viewportWidth: vw,
    viewportHeight: vh,
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
      // Without this, pointing at src/ or .next/ renders nothing and reports
      // zero findings — the most convincing possible false pass.
      //
      // .next gets its own sentence because it IS build output, so "point at
      // the build output" would read as already-done advice. It is a server's
      // working directory, not a servable tree.
      const isNext = serveRoot.replace(/\/+$/, '').endsWith('.next');
      console.error(
        isNext
          ? '--serve: a Next.js build is not statically servable. Run `npm run start` ' +
            'in that surface and pass the URL instead:\n' +
            '  node responsive-check.mjs http://localhost:<port>'
          : `--serve: no index.html in ${serveRoot} — point this at a static build ` +
            'directory (Vite `dist/`, a Next.js `out/` export), not the source tree.',
      );
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
    : PROBES;
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
