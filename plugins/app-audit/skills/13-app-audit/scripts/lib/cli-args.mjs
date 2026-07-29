// Argument parsing shared by all three CLI entrypoints (score.mjs,
// collect-static.mjs, collect-live.mjs) so these two guards cannot silently
// regress in just one of them — which is exactly what happened before this
// module existed: only collect-live.mjs had the value-looks-like-a-flag
// guard, so `score.mjs --out --baseline` created a directory literally
// named "--baseline" (exit 0), and collect-static.mjs's naive
// `args.find(a => !a.startsWith('--'))` picked --out's own value as the
// target directory in `collect-static.mjs --out X target`, auditing X
// instead of target.

// Returns the value following `name` in `args`, or null if the flag is
// absent or its value would itself look like a flag (`--foo --bar` means
// "no value given for --foo", not "value is the literal string --bar").
export function flagValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const v = args[idx + 1];
  if (v === undefined || v.startsWith('--')) return null;
  return v;
}

// Returns every argument that is neither a recognised flag nor the value
// belonging to one. `valueFlags` is the set of flag names that consume the
// following token as their value (e.g. `--out`, `--baseline`) — anything
// immediately after one of those is never a positional, regardless of what
// it looks like. e.g. for `--out X target` with valueFlags = {'--out'},
// this returns ['target'], not ['X', 'target'].
export function positionals(args, valueFlags) {
  return args.filter((a, i) => !a.startsWith('--') && !valueFlags.has(args[i - 1]));
}
