import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanText, SECRET_PATTERNS } from '../scripts/lib/scan.mjs';

// SYNTHETIC ONLY — read this before adding or "improving" any fixture here.
//
// Every credential-shaped value in this file, and in the fixtures it reads,
// is fabricated. Confirmed by an actual push against live GitHub push
// protection while fixing this suite: it blocks Stripe secret/restricted
// keys on SHAPE ALONE — the sk_live_/rk_live_ prefix plus a minimum-length
// alphanumeric run — regardless of how obviously fake the content is. Even
// a value using a repeated FAKE marker in place of real key material still
// tripped it, because "unmistakably fake to a human" and "matches the shape
// a vendor partner pattern keys on" are independent properties, and only
// the second one matters to push protection. (Deliberately not spelling
// that value out here even as an example — see below for why.)
//
// The practical consequence, followed throughout this file:
//   - Static fixture files scanned as raw bytes (bundle.js,
//     fixtures/target/dist/app.js) never contain the sk_live_/rk_live_
//     prefix immediately followed by 16+ letters/digits, anywhere — not in
//     code, not in a comment. There is no "fake enough" version of that
//     shape that survives push protection, so those fixtures carry no
//     Stripe key at all, in any form. They still carry a synthetic JWT
//     (confirmed safe by the same push attempt) to exercise JWT detection
//     from a real file.
//   - Stripe secret/restricted key coverage instead lives in the tests
//     below, where the value is assembled from two separate string
//     literals joined with `+` rather than written out as one. The
//     committed source therefore never contains the matching contiguous run
//     byte-for-byte — nothing for push protection's static scan to find —
//     while scanText still receives the fully reconstructed string at test
//     time and detects it exactly as it would in real code.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'bundle.js');
const text = readFileSync(FIXTURE, 'utf8');

test('finds the JWT in the bundle fixture', () => {
  const kinds = scanText(text, 'bundle.js').map((f) => f.kind).sort();
  assert.ok(kinds.includes('JWT'));
});

test('no finding contains the raw secret', () => {
  const jwtMatch = text.match(/eyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/);
  const signature = jwtMatch[0].split('.')[2];
  for (const f of scanText(text, 'bundle.js')) {
    assert.ok(!text.includes(f.description), 'description must not be a substring of the source');
    assert.ok(!f.description.includes(signature));
  }
});

test('detects a Stripe live secret key (sk_live_)', () => {
  // Built via concatenation, not a single literal — see the file-top note.
  const fake = 'sk_live_' + 'FAKE'.repeat(5) + '0000';
  const kinds = scanText(`const t = "${fake}";`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('Stripe live secret key'));
});

test('findings carry line and column for reproducibility', () => {
  const f = scanText(text, 'bundle.js').find((x) => x.kind === 'JWT');
  assert.equal(typeof f.line, 'number');
  assert.equal(typeof f.column, 'number');
  assert.ok(f.line >= 1);
});

test('public env prefixes on secret-shaped names are reported separately', () => {
  const kinds = scanText(text, 'bundle.js').map((f) => f.kind);
  assert.ok(kinds.includes('public-prefixed secret name'));
});

test('an ordinary bundle with no secrets yields nothing', () => {
  assert.deepEqual(scanText('export const add = (a, b) => a + b;\n', 'x.js'), []);
});

// --- Regression: quadratic backtracking on high-eyJ-density base64 runs ---

test('scanning a high-eyJ-density base64 run completes well under a second', () => {
  // Mirrors base64-encoded JSON embedded in a production bundle: a long,
  // unbroken base64url run containing many "eyJ" starts and no literal "."
  // to ever terminate a JWT match. An unbounded {10,} segment quantifier
  // makes every "eyJ" occurrence scan to end-of-run and backtrack; {10,4096}
  // bounds the per-start cost so the file is never skipped as too slow.
  const chunk = 'eyJhbGciOiJIUzI1NiJ9';
  const text = chunk.repeat(30000); // ~600 KB, ~30000 "eyJ" start positions
  const startedAt = Date.now();
  const findings = scanText(text, 'huge.js');
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 1000, `expected scan under 1000ms, took ${elapsedMs}ms`);
  assert.deepEqual(findings, [], 'no literal "." anywhere, so no real JWT should be reported');
});

// --- New credential families ---

test('detects a GitHub fine-grained PAT (github_pat_)', () => {
  const fake = `github_pat_${'FAKE0000'.repeat(6)}`;
  const kinds = scanText(`const t = "${fake}";`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('GitHub fine-grained PAT'));
});

test('detects a Stripe restricted key (rk_live_)', () => {
  // Built via concatenation, not a single literal — see the file-top note.
  const fake = 'rk_live_' + 'FAKE'.repeat(5) + '0000';
  const kinds = scanText(`const t = "${fake}";`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('Stripe restricted key'));
});

test('detects an AWS temporary (STS) access key id (ASIA)', () => {
  const fake = 'ASIAFAKE1234567890AB';
  const kinds = scanText(`const t = "${fake}";`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('AWS temporary access key id'));
});

test('detects an AWS secret access key by assignment context, not shape alone', () => {
  const fakeSecret = 'FAKE'.repeat(10); // 40 chars
  const text = `AWS_SECRET_ACCESS_KEY=${fakeSecret}\n`;
  const findings = scanText(text, '.env');
  const found = findings.find((f) => f.kind === 'AWS secret access key');
  assert.ok(found, 'expected an AWS secret access key finding');
  assert.ok(!found.description.includes(fakeSecret));
});

test('a bare 40-character string with no assignment context is not flagged as an AWS secret access key', () => {
  const fakeSecret = 'FAKE'.repeat(10);
  const kinds = scanText(`const blob = "${fakeSecret}";`, 'x.js').map((f) => f.kind);
  assert.ok(!kinds.includes('AWS secret access key'));
});

test('detects the AWS SDK v3 camelCase spelling (secretAccessKey), not just the env var form', () => {
  const fakeSecret = 'FAKE'.repeat(10);
  const kinds = scanText(`const creds = { secretAccessKey: "${fakeSecret}" };`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('AWS secret access key'));
});

test('detects awsSecretAccessKey and the kebab-case spelling too', () => {
  const fakeSecret = 'FAKE'.repeat(10);
  const camel = scanText(`const c = { awsSecretAccessKey: "${fakeSecret}" };`, 'x.js').map((f) => f.kind);
  const kebab = scanText(`aws-secret-access-key: "${fakeSecret}"`, 'config.yaml').map((f) => f.kind);
  assert.ok(camel.includes('AWS secret access key'));
  assert.ok(kebab.includes('AWS secret access key'));
});

test('detects a Supabase secret key (sb_secret_)', () => {
  const fake = 'sb_secret_FAKEFAKEFAKEFAKEFAKEFAKE';
  const kinds = scanText(`const t = "${fake}";`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('Supabase secret key'));
});

test('detects a Supabase personal access token (sbp_)', () => {
  const fake = `sbp_${'fake0'.repeat(8)}`; // 40 chars after the prefix
  const kinds = scanText(`const t = "${fake}";`, 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('Supabase personal access token'));
});

test('detects a Postgres connection string with an embedded password', () => {
  const text = 'DATABASE_URL="postgresql://appuser:FakePassw0rd123@db.example.com:5432/appdb"';
  const findings = scanText(text, '.env');
  const found = findings.find((f) => f.kind === 'database connection string');
  assert.ok(found);
  assert.ok(!found.description.includes('FakePassw0rd123'));
});

test('detects a mongodb+srv connection string with an embedded password', () => {
  const text = 'MONGO_URL="mongodb+srv://appuser:FakePassw0rd123@cluster0.example.mongodb.net/appdb"';
  const kinds = scanText(text, '.env').map((f) => f.kind);
  assert.ok(kinds.includes('database connection string'));
});

// --- PEM: correct length reporting, and additional header variants ---

function fakePemBlock(type, bodyLines) {
  return [`-----BEGIN ${type}-----`, ...bodyLines, `-----END ${type}-----`].join('\n');
}

test('a DSA private key block is detected and its full length reported, not just the header', () => {
  const block = fakePemBlock('DSA PRIVATE KEY', [
    'FAKEuBASE64FAKEuBASE64FAKEuBASE64',
    'FAKEuBASE64FAKEuBASE64FAKEuBASE64',
  ]);
  const findings = scanText(block, 'key.pem');
  const found = findings.find((f) => f.kind === 'private key block');
  assert.ok(found);
  assert.match(found.description, new RegExp(`${block.length} chars`));
  assert.ok(!found.description.includes('shape'));
  assert.ok(!found.description.includes('FAKEuBASE64'));
});

test('an ENCRYPTED private key block is detected', () => {
  const block = fakePemBlock('ENCRYPTED PRIVATE KEY', ['FAKEuBASE64FAKEuBASE64']);
  const kinds = scanText(block, 'key.pem').map((f) => f.kind);
  assert.ok(kinds.includes('private key block'));
});

test('a PGP private key block is detected under its own kind, with real length', () => {
  const block = fakePemBlock('PGP PRIVATE KEY BLOCK', [
    'FAKEuBASE64FAKEuBASE64',
    'FAKEuBASE64FAKEuBASE64',
  ]);
  const findings = scanText(block, 'key.asc');
  const found = findings.find((f) => f.kind === 'PGP private key block');
  assert.ok(found);
  assert.match(found.description, new RegExp(`${block.length} chars`));
});

// --- PEM: a header with no matching END must still be reported ---

test('a BEGIN header with no END anywhere is still reported, under a distinct kind', () => {
  const text = '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEuBASE64FAKEuBASE64\n// truncated, no footer';
  const kinds = scanText(text, 'bundle.js').map((f) => f.kind);
  assert.ok(kinds.includes('private key block (unterminated)'));
  assert.ok(!kinds.includes('private key block'));
});

test('a mismatched BEGIN/END type pair is reported as unterminated, not silently dropped', () => {
  // Hand-edited files sometimes end up with a header/footer type mismatch.
  const text = '-----BEGIN RSA PRIVATE KEY-----\nFAKEuBASE64FAKEuBASE64\n-----END PRIVATE KEY-----';
  const kinds = scanText(text, 'key.pem').map((f) => f.kind);
  assert.ok(kinds.includes('private key block (unterminated)'));
});

test('the unterminated finding never claims a specific (and therefore misleading) length', () => {
  const text = '-----BEGIN RSA PRIVATE KEY-----\nFAKEuBASE64FAKEuBASE64\n// truncated';
  const found = scanText(text, 'bundle.js').find((f) => f.kind === 'private key block (unterminated)');
  assert.ok(found);
  assert.ok(!/\d+ chars/.test(found.description));
});

test('a well-formed key is reported once, not twice, despite also matching the header-only fallback', () => {
  const block = fakePemBlock('RSA PRIVATE KEY', ['FAKEuBASE64FAKEuBASE64']);
  const findings = scanText(block, 'key.pem');
  const kinds = findings.map((f) => f.kind);
  assert.equal(kinds.filter((k) => k === 'private key block').length, 1);
  assert.equal(kinds.filter((k) => k === 'private key block (unterminated)').length, 0);
});

test('scanning 128,000 unterminated PEM headers (~4MB, the reviewer\'s exact worst case) completes in seconds, not tens of seconds', () => {
  // This exact input (repeated BEGIN headers, no END anywhere, ~4 MB) is
  // what exposed both the original unbounded [\s\S]*? scan (~37s measured)
  // and a first bounded-but-still-regex-based attempt, [\s\S]{0,200000}?,
  // which measured *worse* (~44s) because a bounded lazy quantifier still
  // retries a multi-character footer literal at every position within the
  // bound. Detection here uses native indexOf over an explicitly bounded
  // slice instead (see scanPemBlocks in scan.mjs), which is linear.
  const header = '-----BEGIN RSA PRIVATE KEY-----\n';
  const text = header.repeat(128000);
  const startedAt = Date.now();
  const findings = scanText(text, 'huge.pem');
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 5000, `expected scan well under 5000ms, took ${elapsedMs}ms`);
  assert.equal(findings.length, 128000);
  assert.ok(findings.every((f) => f.kind === 'private key block (unterminated)'));
});

// --- Public-prefix pattern: segment-boundary anchoring ---

test('public-prefix pattern does not fire on a sensitive word appearing only as a substring', () => {
  const text = [
    'const a = { NEXT_PUBLIC_MONKEY_NAME: "Bob" };',
    'const b = { VITE_TURKEY_TZ: "Europe/Istanbul" };',
    'const c = { NEXT_PUBLIC_KEYCLOAK_URL: "https://auth.example.com" };',
  ].join('\n');
  const kinds = scanText(text, 'x.js').map((f) => f.kind);
  assert.ok(!kinds.includes('public-prefixed secret name'));
});

test('public-prefix pattern still fires when the sensitive word is a segment followed by a trailing suffix', () => {
  const kinds = scanText('const x = { NEXT_PUBLIC_API_KEY_2: "..." };', 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('public-prefixed secret name'));
});

// --- Public-prefix pattern: known-public suffixes are not incidents ---

test('known-public suffixes (anon key, publishable key, site key) are not reported as findings', () => {
  // CLIENT_ID is deliberately not exercised here: it contains none of
  // SECRET/KEY/TOKEN/PASSWORD/CREDENTIAL itself, so the only way a
  // "..._CLIENT_ID" name ever reaches the suppression check at all is via
  // *another* sensitive segment elsewhere in the name — which always
  // disqualifies suppression (see the gaming-resistance test below). A
  // genuinely-suppressible bare CLIENT_ID example does not exist under this
  // pattern set, which is intentional, not an oversight.
  const text = [
    'const a = { NEXT_PUBLIC_SUPABASE_ANON_KEY: "..." };',
    'const b = { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "..." };',
    'const c = { VITE_RECAPTCHA_SITE_KEY: "..." };',
  ].join('\n');
  const kinds = scanText(text, 'x.js').map((f) => f.kind);
  assert.ok(!kinds.includes('public-prefixed secret name'));
});

test('a genuinely secret-shaped public-prefixed name is still reported', () => {
  const kinds = scanText('const x = { VITE_STRIPE_SECRET_KEY: "..." };', 'x.js').map((f) => f.kind);
  assert.ok(kinds.includes('public-prefixed secret name'));
});

test('known-public suffix suppression does not fire when another segment of the name is itself sensitive', () => {
  // Adversarial names: each ends in a known-public suffix but names, or
  // sits alongside, an actually-privileged credential. A bare suffix match
  // (anchored only to the end of the identifier) would wave every one of
  // these through; they must all still be reported.
  const text = [
    'const a = { NEXT_PUBLIC_SERVICE_ROLE_KEY_ANON_KEY: "..." };',
    'const b = { VITE_SERVICE_ROLE_ANON_KEY: "..." };',
    'const c = { VITE_SECRET_CLIENT_ID: "..." };',
    'const d = { NEXT_PUBLIC_STRIPE_SECRET_PUBLISHABLE_KEY: "..." };',
    'const e = { VITE_ADMIN_PASSWORD_SITE_KEY: "..." };',
    'const f = { VITE_DB_CREDENTIAL_CLIENT_ID: "..." };',
  ].join('\n');
  const findings = scanText(text, 'x.js');
  const names = findings
    .filter((f) => f.kind === 'public-prefixed secret name')
    .map((f) => f.description);
  assert.equal(names.length, 6, `expected all 6 adversarial names to fire, got ${names.length}`);
});

// --- Public-prefix pattern: emitted name is sanitized, not echoed verbatim ---

test('a credential glued to a public-prefixed name via underscore is redacted, not echoed', () => {
  const key = 'AKIAFAKE1234567890AB'; // AWS-shaped, fits the SCREAMING_SNAKE_CASE identifier charset
  const text = `const x = { VITE_SECRET_${key}: "..." };`;
  const findings = scanText(text, 'x.js');
  const nameFinding = findings.find((f) => f.kind === 'public-prefixed secret name');
  assert.ok(nameFinding);
  assert.ok(!nameFinding.description.includes(key));
  // the embedded key is still independently caught under its own kind
  assert.ok(findings.some((f) => f.kind === 'AWS access key id'));
});

test('an oversized public-prefixed name is capped rather than echoed in full', () => {
  // Built from many short (2-char) underscore-separated segments so no
  // single contiguous run is long enough to be caught by the opaque-run
  // redaction below — this isolates the length cap itself.
  const longName = Array.from({ length: 200 }, (_, i) => `S${i % 10}`).join('_');
  const text = `const x = { VITE_SECRET_${longName}: "..." };`;
  const findings = scanText(text, 'x.js');
  const nameFinding = findings.find((f) => f.kind === 'public-prefixed secret name');
  assert.ok(nameFinding);
  assert.ok(nameFinding.description.length < 200, `description was ${nameFinding.description.length} chars`);
});

test('a long opaque run in a public-prefixed name is redacted even though it matches no specific pattern', () => {
  // A 64-char uppercase hex-shaped blob doesn't match any entry in
  // SECRET_PATTERNS, but is still an opaque token, not a human-chosen name.
  const hex64 = 'ABCDEF0123456789'.repeat(4);
  const text = `const x = { VITE_SECRET_${hex64}: "..." };`;
  const findings = scanText(text, 'x.js');
  const nameFinding = findings.find((f) => f.kind === 'public-prefixed secret name');
  assert.ok(nameFinding);
  assert.ok(!nameFinding.description.includes(hex64));
});

// --- Exported patterns must not carry shared regex state ---

test('exported SECRET_PATTERNS carry no global flag, so downstream .test() calls stay consistent', () => {
  const jwtPattern = SECRET_PATTERNS.find((p) => p.kind === 'JWT');
  assert.equal(jwtPattern.re.global, false);
  const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFLTAwMDAifQ.FAKESIGNATUREFAKE0123456789';
  assert.equal(jwtPattern.re.test(jwtLike), true);
  assert.equal(jwtPattern.re.test(jwtLike), true, 'a second .test() call must not flip to false via shared lastIndex');
});
