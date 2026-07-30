import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSecret } from '../scripts/lib/redact.mjs';

// SYNTHETIC FIXTURE — do not "improve" realism. The JWT below decodes to
// obviously-fake JSON (see the "FAKE" marker in the payload) and carries no
// vendor-specific issuer claims. Keep it that way: a value that merely
// *looks* fabricated but still matches a real vendor's live-token format is
// exactly what tripped GitHub push protection on this public repo before.
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJGQUtFLTAwMDAwMDAwMDAiLCJub3RlIjoic3ludGhldGljIGZpeHR1cmUsIG5vdCBhIHJlYWwgdG9rZW4ifQ.FAKESIGNATUREFAKESIGNATUREFAKESIGNATURE0000';

test('description states kind, prefix and length', () => {
  const d = describeSecret(JWT, 'service-role JWT');
  assert.match(d, /service-role JWT/);
  assert.match(d, new RegExp(`${JWT.length} chars`));
});

test('description never contains more than a 4-character prefix of the secret', () => {
  const d = describeSecret(JWT, 'service-role JWT');
  for (let len = 5; len <= JWT.length; len++) {
    for (let i = 0; i + len <= JWT.length; i++) {
      assert.ok(!d.includes(JWT.slice(i, i + len)), `leaked ${len}-char run at ${i}`);
    }
  }
});

test('the signature segment never appears at all', () => {
  const sig = JWT.split('.')[2];
  const d = describeSecret(JWT, 'service-role JWT');
  assert.ok(!d.includes(sig.slice(0, 6)));
});

test('short secrets are described without becoming legible', () => {
  const d = describeSecret('hunter2', 'password');
  assert.ok(!d.includes('hunter2'));
  assert.match(d, /7 chars/);
});

test('values at or below twice the prefix length carry no shape prefix at all', () => {
  // PREFIX_LEN is 3; a value of length 6 would otherwise show a 3-char
  // prefix — half the value — so the guard must suppress the prefix here.
  const d = describeSecret('abcdef', 'test');
  assert.ok(!d.includes('abcdef'));
  assert.ok(!d.includes('abc'));
  assert.match(d, /6 chars/);
});

test('a 4-digit PIN is not substantially reconstructed by the shape prefix', () => {
  const d = describeSecret('1234', 'PIN');
  assert.ok(!d.includes('1234'));
  assert.ok(!d.includes('123'));
  assert.match(d, /4 chars/);
});

test('a 1-3 character value is not fully echoed back', () => {
  const d = describeSecret('ab', 'x');
  assert.ok(!d.includes('ab'));
  assert.match(d, /2 chars/);
});

test('includeShape: false omits the prefix entirely and reports kind and length only', () => {
  const fakePem = '-----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKEFAKEFAKE\n-----END RSA PRIVATE KEY-----';
  const d = describeSecret(fakePem, 'private key block', { includeShape: false });
  assert.match(d, /private key block/);
  assert.match(d, new RegExp(`${fakePem.length} chars`));
  assert.ok(!d.includes('shape'));
  assert.ok(!d.includes('MIIFAKE'));
});
