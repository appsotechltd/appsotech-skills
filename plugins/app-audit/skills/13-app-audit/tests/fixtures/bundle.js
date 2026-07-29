// SYNTHETIC FIXTURE — do not "improve" realism.
//
// The JWT below is fabricated: it decodes to obviously-fake JSON (see the
// "FAKE" marker in the payload) and carries no vendor-specific issuer
// claims. This is enough to be safely used as static file content — an
// actual push against live GitHub push protection confirmed this exact
// value does not trip it.
//
// A Stripe secret key is deliberately NOT present anywhere in this file,
// not even spelled out in a comment. GitHub push protection blocks the
// `sk_live_`/`rk_live_` prefixes on shape alone (prefix plus a
// minimum-length alphanumeric run) regardless of how obviously fake the
// remainder is — confirmed by an actual push attempt while fixing this
// suite, which still blocked on a value using a repeated FAKE marker in
// place of real key material. There is no "fake enough" static text of
// that shape — writing the prefix immediately followed by 16+ letters and
// digits anywhere in this file's raw bytes reintroduces the exact problem,
// comment or code alike. Stripe key detector coverage instead lives in
// scan.test.mjs, built at test time via string concatenation so the shape
// never exists as committed bytes. Do not add the shape back here, in any
// form, including to document this rule.
//
// The VITE_STRIPE_SECRET_KEY property name is kept (with a harmless,
// non-credential-shaped value) purely to exercise the public-prefixed
// secret *name* detector, which matches on the identifier, not the value.
const cfg = {
  url: "https://xyzcompany.supabase.co",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiRkFLRS1hbm9uIiwibm90ZSI6InN5bnRoZXRpYyBmaXh0dXJlLCBub3QgYSByZWFsIFN1cGFiYXNlIGtleSJ9.FAKESIGNATUREFAKESIGNATUREFAKESIGNATURE0000",
  VITE_STRIPE_SECRET_KEY: "REDACTED-not-a-real-key-see-scan.test.mjs-for-detector-coverage",
};
export default cfg;
