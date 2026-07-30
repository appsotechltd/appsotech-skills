// Minimal, dependency-free X.509v1 self-signed certificate builder, used
// only by tests to stand up a real `https:` server for probe 5.7 (TLS
// certificate expiry) without ever reaching the network or an external
// `openssl` binary. Zero-dependency constraint applies to shipped code; this
// exists purely so the TLS path — the single most security-sensitive branch
// in this collector, since certificate verification is deliberately disabled
// there — has real in-suite coverage instead of being exercised only by hand.
//
// Just enough ASN.1 DER is hand-rolled here to produce a structurally valid
// certificate: SEQUENCE/SET/INTEGER/OID/NULL/UTF8String/BIT STRING/UTCTime,
// a single-RDN self-signed Name, and an RSA/SHA-256 signature computed with
// node:crypto over the encoded TBSCertificate. No X.509v3 extensions are
// included (no basicConstraints/keyUsage) — TLS handshakes accept a v1 cert
// fine, and this collector's client connects with rejectUnauthorized: false
// specifically so extension/chain policy never gates reading the cert.

import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

function derLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTLV(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSeq(...parts) { return derTLV(0x30, Buffer.concat(parts)); }
function derSet(...parts) { return derTLV(0x31, Buffer.concat(parts)); }

function derInt(n) {
  let bytes;
  if (n === 0) {
    bytes = [0];
  } else {
    bytes = [];
    let x = n;
    while (x > 0) {
      bytes.unshift(x & 0xff);
      x = Math.floor(x / 256);
    }
    if (bytes[0] & 0x80) bytes.unshift(0); // keep it non-negative in two's complement
  }
  return derTLV(0x02, Buffer.from(bytes));
}

function derOID(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const chunk = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(...chunk);
  }
  return derTLV(0x06, Buffer.from(bytes));
}

function derNull() { return Buffer.from([0x05, 0x00]); }
function derUTF8String(str) { return derTLV(0x0c, Buffer.from(str, 'utf8')); }
function derBitString(buf) { return derTLV(0x03, Buffer.concat([Buffer.from([0x00]), buf])); }

function derUTCTime(date) {
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${two(date.getUTCFullYear() % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}`
    + `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
  return derTLV(0x17, Buffer.from(stamp, 'ascii'));
}

const OID_CN = '2.5.4.3';
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const ALG_SHA256_RSA = derSeq(derOID(OID_SHA256_RSA), derNull());

function nameWithCN(cn) {
  return derSeq(derSet(derSeq(derOID(OID_CN), derUTF8String(cn))));
}

function toPem(der, label) {
  const lines = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

let serialCounter = 1;

// Returns { certPem, keyPem }. notBefore/notAfter are Date objects — pass a
// notAfter in the past to build an already-expired certificate.
export function makeSelfSignedCert({ cn = '127.0.0.1', notBefore = new Date(), notAfter } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const tbs = derSeq(
    derInt(serialCounter++),
    ALG_SHA256_RSA,
    nameWithCN(cn), // issuer == subject: self-signed
    derSeq(derUTCTime(notBefore), derUTCTime(notAfter)),
    nameWithCN(cn),
    spkiDer,
  );
  const signature = cryptoSign('sha256', tbs, privateKey);
  const certDer = derSeq(tbs, ALG_SHA256_RSA, derBitString(signature));

  return {
    certPem: toPem(certDer, 'CERTIFICATE'),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
