// Produces shape-only descriptions of secrets for inclusion in audit
// reports. This module is the single place responsible for turning a raw
// secret value into report text — nothing outside this module should slice,
// prefix, or otherwise partially expose a secret value.
//
// SECURITY INVARIANT: describeSecret's return value must never let a reader
// reconstruct more than a small, fixed prefix of `value`. The only
// value-derived characters in the output are that prefix (or none, for
// short values) and the decimal length of `value` — never any other
// substring of `value`, and the prefix is always separated from the rest of
// the string by literal text so it can never fuse with an adjacent field
// into a longer leaked run.
//
// PRECONDITION: `kind` must be a fixed, human-authored label describing the
// *pattern* that matched (e.g. "Stripe live secret key"), never a value
// derived from the secret itself or from otherwise untrusted input.
// describeSecret has no way to distinguish `kind` from `value` — calling
// describeSecret(secret, secret) is fully reconstructive by construction.
// Callers own this invariant.
const PREFIX_LEN = 3;

export function describeSecret(value, kind, { includeShape = true } = {}) {
  if (!includeShape) {
    // Some kinds (PEM blocks) carry no useful shape information in a fixed
    // prefix — every such block starts with the identical "-----BEGIN"
    // literal, so a prefix would reveal nothing about the key material.
    // Report kind and length only.
    return `${kind} (${value.length} chars)`;
  }
  // A PREFIX_LEN-character prefix reconstructs a large fraction of very
  // short values (e.g. 75% of a 4-digit PIN, 100% of a value no longer than
  // PREFIX_LEN itself). Below twice the prefix length, show no prefix.
  if (value.length <= PREFIX_LEN * 2) {
    return `${kind} (shape: redacted, ${value.length} chars)`;
  }
  const prefix = value.slice(0, PREFIX_LEN);
  return `${kind} (shape: ${prefix}…, ${value.length} chars)`;
}
