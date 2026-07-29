import { describeSecret } from './redact.mjs';

// Each pattern's `re` must NOT carry the global flag. `matchAll` needs a
// global copy, but a shared global RegExp object mutates its own
// `lastIndex`, which silently breaks any downstream consumer that calls
// `.test()` on these exported objects directly (alternating true/false
// across calls as lastIndex creeps forward). `scanText` clones a fresh
// global copy per use via `freshGlobal` instead; exported patterns stay
// stateless.
//
// `valueGroup` (default 0) selects which match group is the actual secret
// value passed to `describeSecret` — for shape-matched secrets that's the
// whole match; for assignment-context patterns (AWS secret access key,
// database connection strings) it's the captured value only, so the
// surrounding variable name / username / host is never folded into the
// value whose prefix gets shown.
//
// JWT segment lengths are bounded ({10,4096}, not {10,}) because an
// unbounded quantifier is quadratic on any long, unbroken run of base64url
// characters containing many "eyJ" substrings — exactly what base64-encoded
// JSON produces, which is routine in production bundles and source maps.
// Every "eyJ" becomes a start position that scans to the end of the run
// and backtracks searching for a literal "." that never terminates it.
// Bounding the segment length caps the per-start cost without affecting any
// real JWT, whose segments are always far shorter than 4096 characters.
// NOTE — hard cliff, by design: a genuine JWT with a segment longer than
// 4096 characters is not degraded, it is entirely invisible to this
// pattern. Real-world JWTs are far smaller than that in every segment, so
// the trade favors a bounded, non-stalling scan over covering a segment
// size that essentially never occurs.
//
// PEM/PGP private key blocks are deliberately NOT expressed as regex
// entries here — see the comment above `scanPemBlocks` below for why a
// single bounded regex is unsafe for this particular shape even with a
// numeric cap, and how it's detected instead.
export const SECRET_PATTERNS = [
  { kind: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/ },
  { kind: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{16,}/ },
  { kind: 'Stripe restricted key', re: /rk_live_[A-Za-z0-9]{16,}/ },
  { kind: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { kind: 'AWS temporary access key id', re: /ASIA[0-9A-Z]{16}/ },
  {
    // A bare 40-character base64-ish string is too generic to flag by shape
    // alone (false positives on every hash, id, or token of that length),
    // so this fires only in assignment context: a name built from
    // "secret", "access", and "key" (optionally prefixed with "aws",
    // optionally camelCase/kebab-case/snake_case — secretAccessKey is the
    // AWS SDK v3 spelling and is exactly as common in a JS codebase as the
    // ALL_CAPS env var form), followed by an assignment operator and a
    // 40-character value.
    kind: 'AWS secret access key',
    re: /["']?(?:aws[-_]?)?secret[-_]?access[-_]?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+]{40})["']?/i,
    valueGroup: 1,
  },
  { kind: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: 'GitHub fine-grained PAT', re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { kind: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { kind: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { kind: 'Supabase personal access token', re: /sbp_[A-Za-z0-9]{20,}/ },
  {
    kind: 'database connection string',
    re: /(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^:/\s"'`]+:([^@/\s"'`]+)@[^\s"'`]+/,
    valueGroup: 1,
  },
];

// --- PEM / PGP private key blocks ---
//
// This shape can't be safely expressed as a single regex the way the
// patterns above are. A private key block is "a fixed header, then
// arbitrary key material, then a footer that must be searched for" — and a
// *bounded* lazy quantifier does not fix that the way it fixed the JWT
// pattern above. `[\s\S]{0,N}?` still retries matching the multi-character
// footer literal at every one of up to N positions per BEGIN occurrence;
// each retry costs roughly the footer's length, not O(1). Measured directly
// on this exact input shape (repeated BEGIN headers, no END anywhere):
// unbounded [\s\S]*?            : ~37s at 128,000 headers / 4.1 MB
// bounded [\s\S]{0,200000}?     : ~44s at the same input — WORSE, not better
// The bound didn't help because the retried literal is multi-character; the
// JWT fix works because its terminator is a single character. So PEM
// detection here uses native String#indexOf over an explicitly bounded
// slice instead of a regex body-scan — both slicing and indexOf are linear
// and don't suffer per-position backtracking:
// indexOf over a 20,000-char bounded window : ~2s at the same 128,000/4.1MB
// input, and scales linearly with header count, not quadratically.
const PEM_HEADER = /-----BEGIN ((?:RSA|EC|DSA|OPENSSH|ENCRYPTED) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/;
// Far larger than any real single PEM block (a 4096-bit RSA key's base64
// body is roughly 3.2 KB) or a small multi-cert bundle, while keeping the
// worst-case per-header search bounded and small.
const PEM_MAX_BODY_LEN = 20000;

// Finds every BEGIN header in `text` and, for each, searches only the next
// PEM_MAX_BODY_LEN characters for the matching END footer (same key type,
// via an exact string comparison rather than a regex backreference). A
// footer found within that window yields a 'private key block' (or, for
// the PGP variant, 'PGP private key block') finding whose description
// reports the real length of the whole block. No footer found within the
// window — because the key is truncated in a bundle, the footer's type
// doesn't match the header's (a real shape seen in hand-edited files), or
// there is no footer at all — yields a 'private key block (unterminated)'
// finding instead, so a truncated key is still reported rather than
// silently dropped. This single pass naturally reports each header exactly
// once, so no separate deduplication step is needed.
function scanPemBlocks(text) {
  const findings = [];
  const re = freshGlobal(PEM_HEADER);
  let m;
  while ((m = re.exec(text)) !== null) {
    const type = m[1];
    const headerEnd = m.index + m[0].length;
    const footer = `-----END ${type}-----`;
    const windowEnd = Math.min(text.length, headerEnd + PEM_MAX_BODY_LEN);
    const relIndex = text.slice(headerEnd, windowEnd).indexOf(footer);
    if (relIndex === -1) {
      findings.push({
        kind: 'private key block (unterminated)',
        description: 'private key block (unterminated): a BEGIN header was found with no matching END footer — the key may be truncated, or the header and footer types may not match',
        index: m.index,
      });
      continue;
    }
    const kind = type === 'PGP PRIVATE KEY BLOCK' ? 'PGP private key block' : 'private key block';
    const blockEnd = headerEnd + relIndex + footer.length;
    findings.push({
      kind,
      description: describeSecret(text.slice(m.index, blockEnd), kind, { includeShape: false }),
      index: m.index,
    });
  }
  return findings;
}

// A sensitive word must appear as a *whole* underscore-delimited segment of
// the identifier (bounded by underscores or the identifier's own edges) to
// match. This is what stops "MONKEY", "TURKEY", or "KEYCLOAK" from firing
// just because they contain "KEY" as a substring, while "API_KEY_2" still
// matches because "KEY" is its own segment there.
//
// Known trade-off, confirmed and left as-is: this also means a sensitive
// word glued to an adjacent word with no separator no longer matches —
// VITE_APIKEY, NEXT_PUBLIC_APIKEY, VITE_MYSECRET, and VITE_SECRETKEY no
// longer fire, where a purely substring-based pattern would have. That
// substring approach is also what produced the MONKEY/TURKEY/KEYCLOAK false
// positives, so the trade is accepted rather than fixed.
const ENV_PREFIX = '(?:VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_)';
const SENSITIVE_WORD = '(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)';
const SEGMENT = '[A-Z0-9]+';
const PUBLIC_PREFIX = new RegExp(
  `\\b${ENV_PREFIX}((?:${SEGMENT}_)*${SENSITIVE_WORD}(?:_${SEGMENT})*)\\b`,
);

// Suffixes that name conventionally *public* values — anon/publishable
// keys, site keys, OAuth client ids are meant to ship to the browser by
// design. A name ending in one of these is suppressed as a non-incident
// only when no *other* segment of the name is itself a signal that the
// value is actually privileged: the same generic sensitive words used
// above, plus SERVICE and ROLE — Supabase's own vocabulary for its most
// privileged key. Without that second check, a bare suffix match is
// gameable: "..._SERVICE_ROLE_ANON_KEY" or "..._SECRET_CLIENT_ID" would be
// waved through by the trailing "ANON_KEY"/"CLIENT_ID" alone despite naming
// the exact credential this tool exists to catch.
const KNOWN_PUBLIC_SUFFIXES = ['ANON_KEY', 'PUBLISHABLE_KEY', 'SITE_KEY', 'CLIENT_ID'];
const SUFFIX_DISQUALIFYING_WORD = /^(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|SERVICE|ROLE)$/;

function isSuppressiblePublicName(capturedName) {
  const segments = capturedName.split('_');
  for (const suffix of KNOWN_PUBLIC_SUFFIXES) {
    const suffixSegments = suffix.split('_');
    if (segments.length < suffixSegments.length) continue;
    const tail = segments.slice(-suffixSegments.length).join('_');
    if (tail !== suffix) continue;
    const rest = segments.slice(0, -suffixSegments.length);
    if (!rest.some((seg) => SUFFIX_DISQUALIFYING_WORD.test(seg))) return true;
  }
  return false;
}

const MAX_EMITTED_NAME_LEN = 80;
// Catches shapes outside SECRET_PATTERNS entirely — e.g. a bare 64-char hex
// or base32 blob glued onto a name — that the pattern-by-pattern scrub below
// wouldn't recognize as any specific credential kind but that is still
// unambiguously "a long opaque token", not part of a human-chosen name.
const OPAQUE_RUN = /[A-Z0-9]{20,}/g;

function freshGlobal(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}

// The public-prefix branch is the one place scanText echoes matched *text*
// (a variable name) rather than a shape-only description, because a name is
// not a secret. But minified bundles can glue a real credential onto a name
// via an underscore, and matched identifiers can run to thousands of
// characters in obfuscated output — so before that text is embedded in a
// description, scrub anything that itself looks like a known secret shape
// or is simply a long opaque run, then cap the length.
function sanitizeEmittedName(name) {
  let safe = name;
  for (const { re } of SECRET_PATTERNS) {
    safe = safe.replace(freshGlobal(re), '[redacted]');
  }
  safe = safe.replace(OPAQUE_RUN, '[redacted]');
  if (safe.length > MAX_EMITTED_NAME_LEN) {
    safe = `${safe.slice(0, MAX_EMITTED_NAME_LEN)}…`;
  }
  return safe;
}

// Offsets of the first character of every line (line 1 starts at 0).
// Computed once per scanText call so that per-finding position lookup is
// O(log lines) via binary search, not O(index) via re-slicing the text from
// the start on every call — the latter turns "many findings in one file"
// into its own quadratic cost (matches x average index), independent of
// and in addition to any regex-level backtracking. This matters more once
// a file can legitimately produce many findings, as an adversarial or
// corrupted file with many unterminated PEM headers now does (that's the
// point of the fallback above), so per-finding position cost must not
// itself scale with file size.
function lineStartOffsets(text) {
  const starts = [0];
  let idx = text.indexOf('\n');
  while (idx !== -1) {
    starts.push(idx + 1);
    idx = text.indexOf('\n', idx + 1);
  }
  return starts;
}

function position(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, column: index - lineStarts[lo] + 1 };
}

export function scanText(text, filename) {
  const findings = [];
  const lineStarts = lineStartOffsets(text);

  for (const { kind, re, valueGroup = 0 } of SECRET_PATTERNS) {
    for (const m of text.matchAll(freshGlobal(re))) {
      const value = m[valueGroup] ?? m[0];
      findings.push({
        kind,
        description: describeSecret(value, kind),
        file: filename,
        ...position(lineStarts, m.index),
      });
    }
  }

  for (const pem of scanPemBlocks(text)) {
    findings.push({
      kind: pem.kind,
      description: pem.description,
      file: filename,
      ...position(lineStarts, pem.index),
    });
  }

  for (const m of text.matchAll(freshGlobal(PUBLIC_PREFIX))) {
    if (isSuppressiblePublicName(m[1])) continue;
    const name = m[0];
    findings.push({
      kind: 'public-prefixed secret name',
      description: `environment variable named ${sanitizeEmittedName(name)} is exposed to the client by its prefix`,
      file: filename,
      ...position(lineStarts, m.index),
    });
  }

  return findings;
}
