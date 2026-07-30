#!/usr/bin/env node
// Audits source for the gate's mechanical anti-patterns.
//
//   audit-markup.mjs <dir> [--json] [--warn-only]
//
// contrast.mjs validates the token FILE. This validates the code that consumes
// it — which is where the drift actually happens. A component with a hardcoded
// #3B82F6 bypasses the entire frozen design system and passes every contrast
// check, because the check never sees it.
//
// Precision is the design constraint, not coverage. A rule that fires on
// correct code teaches people to skip the whole run, so every rule here either
// carries an exemption for the legitimate case or is downgraded to a warning.
// Suppress a specific line with a `design-ok` comment on it.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.git', '.svelte-kit',
  'coverage', 'vendor', 'ios', 'android', '.dart_tool', 'Pods', '__snapshots__',
]);

// design/ holds the tokens themselves — the one place raw colour belongs.
const SKIP_PATH_PARTS = [`${sep}design${sep}`];
const SKIP_FILE_RE = /\.(test|spec|stories)\.[jt]sx?$/;

const WEB_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.css', '.html', '.vue', '.svelte']);
const DART_EXT = new Set(['.dart']);
const EXTS = new Set([...WEB_EXT, ...DART_EXT]);

// --- tag scanning -----------------------------------------------------------

// Finds opening tags and returns their raw attribute text.
//
// A naive /<div[^>]*>/ is wrong for JSX: `onClick={() => f()}` contains a `>`
// inside an arrow function, so the match ends early and the attributes are
// truncated — which silently hides exactly the handler this file exists to
// find. This walks the tag tracking brace depth and quote state instead.
export function extractTags(content, tagNames) {
  const tags = [];
  const names = tagNames.map((n) => n.toLowerCase());
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '<') continue;
    const rest = content.slice(i + 1);
    const nameMatch = rest.match(/^([A-Za-z][A-Za-z0-9]*)/);
    if (!nameMatch) continue;
    if (!names.includes(nameMatch[1].toLowerCase())) continue;

    let j = i + 1 + nameMatch[1].length;
    let depth = 0;
    let quote = null;
    for (; j < content.length; j++) {
      const c = content[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) break;
    }
    tags.push({
      name: nameMatch[1],
      attrs: content.slice(i + 1 + nameMatch[1].length, j),
      line: content.slice(0, i).split('\n').length,
    });
    i = j;
  }
  return tags;
}

function hasAttr(attrs, name) {
  return new RegExp(`(^|[\\s{])${name}\\s*[=}]`, 'i').test(attrs);
}
function attrValue(attrs, name) {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

// --- rules ------------------------------------------------------------------

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}
function suppressed(lines, line) {
  const cur = lines[line - 1] ?? '';
  const prev = lines[line - 2] ?? '';
  return /design-ok/.test(cur) || /design-ok/.test(prev);
}

// 1. A colour that is not a token. The whole point of the frozen system.
function hardcodedColour(file, content, lines, ext) {
  const out = [];
  const push = (line, text) => {
    if (suppressed(lines, line)) return;
    out.push({
      rule: 'hardcoded-colour', severity: 'error', file, line, text,
      why: 'colour not from a token — it will not follow the design system, and it will not change in dark mode',
    });
  };

  if (DART_EXT.has(ext)) {
    for (const m of content.matchAll(/Color\(0x[0-9A-Fa-f]{6,8}\)/g)) {
      push(lineOf(content, m.index), m[0]);
    }
    return out;
  }

  for (const m of content.matchAll(/(^|[^\w&#])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g)) {
    const line = lineOf(content, m.index);
    const src = lines[line - 1] ?? '';
    // href="#anchor" and url(#svg-ref) are references, not colours.
    if (/href\s*=|url\(#|xlink:href/.test(src)) continue;
    push(line, `#${m[2]}`);
  }

  // rgb()/hsl() with literal channels. hsl(var(--token)) is the CORRECT
  // pattern and must never be flagged — that exemption is why this is not a
  // bare search for "hsl(".
  for (const m of content.matchAll(/\b(rgba?|hsla?)\(\s*(?!var\()[^)]*\d[^)]*\)/g)) {
    push(lineOf(content, m.index), m[0].slice(0, 40));
  }
  return out;
}

// 2. Tailwind purges class names it cannot see as literals.
function dynamicTailwind(file, content, lines) {
  const out = [];
  const re = /`[^`]*\b(bg|text|border|ring|fill|stroke|from|via|to|shadow)-\$\{[^`]*`/g;
  for (const m of content.matchAll(re)) {
    const line = lineOf(content, m.index);
    if (suppressed(lines, line)) continue;
    out.push({
      rule: 'dynamic-tailwind-class', severity: 'error', file, line,
      text: m[0].slice(0, 60),
      why: 'Tailwind purges classes it cannot see as literals — this renders unstyled in production',
    });
  }
  return out;
}

// 3. A click handler on a non-interactive element.
function nonSemanticClick(file, content, lines) {
  const out = [];
  for (const tag of extractTags(content, ['div', 'span', 'li', 'td'])) {
    if (!/onClick|onclick/.test(tag.attrs)) continue;
    // A div with role, tabIndex and a key handler is a deliberately built
    // control and is legitimate. Only flag the ones with none of that.
    const accessible =
      hasAttr(tag.attrs, 'role') &&
      /tabIndex|tabindex/.test(tag.attrs) &&
      /onKeyDown|onKeyPress|onKeyUp/.test(tag.attrs);
    if (accessible) continue;
    if (suppressed(lines, tag.line)) continue;
    out.push({
      rule: 'non-semantic-click', severity: 'error', file, line: tag.line,
      text: `<${tag.name} onClick …>`,
      why: 'not reachable by keyboard or announced as a control — use <button>, or add role, tabIndex and a key handler',
    });
  }
  return out;
}

// 4. Images without alt text.
function imgMissingAlt(file, content, lines) {
  const out = [];
  for (const tag of extractTags(content, ['img', 'Image'])) {
    if (hasAttr(tag.attrs, 'alt')) continue;
    if (suppressed(lines, tag.line)) continue;
    out.push({
      rule: 'img-missing-alt', severity: 'error', file, line: tag.line,
      text: `<${tag.name} …>`,
      why: 'every image needs alt — descriptive if meaningful, alt="" if decorative',
    });
  }
  return out;
}

// 5. Inputs with no accessible name.
function inputMissingLabel(file, content, lines) {
  const out = [];
  for (const tag of extractTags(content, ['input', 'select', 'textarea'])) {
    const type = (attrValue(tag.attrs, 'type') ?? '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    if (hasAttr(tag.attrs, 'aria-label') || hasAttr(tag.attrs, 'aria-labelledby')) continue;

    // If it has an id, look for a label bound to that id in the same file
    // before reporting — that is the correct pattern and must not be flagged.
    const id = attrValue(tag.attrs, 'id');
    if (id && new RegExp(`(htmlFor|for)\\s*=\\s*["']${id}["']`).test(content)) continue;
    if (suppressed(lines, tag.line)) continue;

    out.push({
      rule: 'input-missing-label', severity: 'error', file, line: tag.line,
      text: `<${tag.name}${type ? ` type="${type}"` : ''} …>`,
      why: 'no associated <label>, aria-label or aria-labelledby — a placeholder is not a label',
    });
  }
  return out;
}

// 6. The blacklisted display faces.
function bannedDisplayFont(file, content, lines) {
  const out = [];
  const re = /font-family\s*:\s*([^;{}]+)/gi;
  for (const m of content.matchAll(re)) {
    const stack = m[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
    const first = stack[0] ?? '';
    // Only the FIRST font is the design choice. Arial deep in a fallback
    // stack is correct practice, not a violation.
    if (!/^(Inter|Roboto|Arial)$/i.test(first)) continue;
    const line = lineOf(content, m.index);
    if (suppressed(lines, line)) continue;
    out.push({
      rule: 'banned-display-font', severity: 'error', file, line, text: first,
      why: 'overused AI default as the primary face — fine as a fallback, not as the design',
    });
  }
  return out;
}

// 7. Focus removed with nothing put back.
function outlineNoneNoFocus(file, content, lines) {
  const out = [];
  // A file that also defines a focus-visible style has almost certainly
  // replaced the indicator, so this drops to a warning there.
  const hasReplacement = /focus-visible|:focus\s*\{|focus:ring|focus:outline|focus:border/.test(content);
  for (const m of content.matchAll(/outline\s*:\s*none|outline-none/g)) {
    const line = lineOf(content, m.index);
    if (suppressed(lines, line)) continue;
    out.push({
      rule: 'outline-none', severity: hasReplacement ? 'warn' : 'error',
      file, line, text: m[0],
      why: hasReplacement
        ? 'focus styling exists in this file — confirm it covers this element'
        : 'focus indicator removed with no replacement anywhere in this file',
    });
  }
  return out;
}

// 8. Animating properties that force reflow.
function layoutAnimation(file, content, lines) {
  const out = [];
  const patterns = [
    /transition\s*:\s*[^;{}]*\b(width|height|margin|padding|top|left|right|bottom)\b/gi,
    /transition-property\s*:\s*[^;{}]*\b(width|height|margin|padding)\b/gi,
    /\btransition-all\b/g,
  ];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) {
      const line = lineOf(content, m.index);
      if (suppressed(lines, line)) continue;
      out.push({
        rule: 'layout-animation', severity: 'warn', file, line,
        text: m[0].slice(0, 50),
        why: 'animating layout properties triggers reflow — animate transform and opacity instead',
      });
    }
  }
  return out;
}

const WEB_RULES = [
  hardcodedColour, dynamicTailwind, nonSemanticClick, imgMissingAlt,
  inputMissingLabel, bannedDisplayFont, outlineNoneNoFocus, layoutAnimation,
];

export function auditFile({ path, content }) {
  const ext = extname(path);
  const lines = content.split('\n');
  if (DART_EXT.has(ext)) return hardcodedColour(path, content, lines, ext);
  return WEB_RULES.flatMap((rule) =>
    rule.length === 4 ? rule(path, content, lines, ext) : rule(path, content, lines));
}

export function auditFiles(files) {
  return files.flatMap(auditFile).sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// --- walking ----------------------------------------------------------------

export function collect(dir, root = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collect(full, root, acc);
      continue;
    }
    if (!EXTS.has(extname(entry))) continue;
    const rel = relative(root, full);
    if (SKIP_FILE_RE.test(entry)) continue;
    if (SKIP_PATH_PARTS.some((p) => `${sep}${rel}`.includes(p))) continue;
    acc.push({ path: rel, content: readFileSync(full, 'utf8') });
  }
  return acc;
}

// --- cli --------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const warnOnly = args.includes('--warn-only');
  const dir = args.find((a) => !a.startsWith('--')) ?? '.';

  if (!existsSync(dir)) {
    console.error(`no such directory: ${dir}`);
    process.exit(2);
  }

  const files = collect(dir);
  const findings = auditFiles(files);
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');

  if (asJson) {
    console.log(JSON.stringify(
      { dir, scanned: files.length, findings }, null, 2));
  } else {
    let last = null;
    for (const f of findings) {
      if (f.file !== last) { console.log(`\n${f.file}`); last = f.file; }
      const tag = f.severity === 'error' ? 'ERROR' : ' warn';
      console.log(`  ${tag} ${String(f.line).padStart(4)}  ${f.rule}: ${f.text}`);
      console.log(`              ${f.why}`);
    }
    console.log(
      `\n${files.length} file(s) scanned — ${errors.length} error(s), ${warns.length} warning(s).`);
    if (files.length === 0) {
      // Silence would read as a clean pass on a directory nothing matched.
      console.error(
        'No source files matched. Check the path — scanning the wrong ' +
          'directory reports zero findings and looks like success.');
      process.exit(2);
    }
    if (findings.length === 0) console.log('Nothing to fix.');
    console.log('\nSuppress a checked line with a `design-ok` comment on it.');
  }

  process.exit(!warnOnly && errors.length > 0 ? 1 : 0);
}
