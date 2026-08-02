# Style directions — the tier-3 fallback

Used when the design engine is unreachable: no Python, or pro-max not
installed. **Tell the user** the engine was unavailable so the narrower range
is explained.

The twelve directions come from **elite-frontend-ux** §1. Each has been given a
concrete palette and a font pairing so this is a real selection, not a prompt
to improvise.

**Every palette here is contrast-verified** — 120 pairs, light and dark, all
passing 4.5:1 for text and 3:1 for the focus ring. Values are **HSL triples,
ready to paste**: the token architecture consumes them as
`hsl(var(--accent) / <alpha-value>)`, and a pasted hex kills every opacity
modifier — silently in configs that wrap, not in configs that don't, so the
failure lands inconsistently across surfaces of one product. The hex in
parentheses is for human reading and renders identically to the triple. Re-run
`node "$CONTRAST" design/tokens.css` after freezing anyway; the check
is cheap and a typo in transcription is not.

## How to use this file

1. Pick the direction that fits the product, not the one you like most.
2. Copy both palettes into `design/tokens.css` — the backticked triples paste
   as-is. Never paste the parenthesised hex; it is the label, not the value.
3. `--ring` is the same value as `--primary` in every direction here.
4. Derive `--secondary` from `--muted` and `--destructive` from your own
   semantics — these twelve define the character, not every token.
5. Record the choice and the reasoning in `design/design-system.md`, and note
   that it came from tier 3.

No font in this file is Inter, Roboto or Arial. All are on Google Fonts.

---

## 1. Brutally minimal

Stripe, Linear. Restraint as the statement: near-black on white, one accent,
generous whitespace, no ornament.

**Use for** developer tools, B2B SaaS, anything where the product is complex
and the chrome must not compete.

| Token | Light | Dark |
|---|---|---|
| background | `0 0% 100%` (#FFFFFF) | `240 10% 4%` (#09090B) |
| foreground | `0 0% 4%` (#0A0A0A) | `0 0% 98%` (#FAFAFA) |
| primary | `0 0% 4%` (#0A0A0A) | `0 0% 98%` (#FAFAFA) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `240 10% 4%` (#09090B) |
| muted | `240 5% 96%` (#F4F4F5) | `240 6% 10%` (#18181B) |
| muted-foreground | `240 5% 34%` (#52525B) | `240 5% 65%` (#A1A1AA) |
| accent | `245 58% 51%` (#463ACB) | `230 94% 82%` (#A6B4FC) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `240 10% 4%` (#09090B) |
| border | `240 6% 90%` (#E4E4E7) | `240 4% 16%` (#27272A) |

**Type** Space Grotesk / Work Sans · **Signature** one hairline rule and a
single accent, used no more than twice per screen.

## 2. Maximalist editorial

Bloomberg, award-winning magazines. Dense type, strong rules, confident colour,
content as the visual.

**Use for** news, long-form, research, anything with a lot to say.

| Token | Light | Dark |
|---|---|---|
| background | `43 47% 97%` (#FBF9F4) | `30 12% 6%` (#110F0D) |
| foreground | `24 12% 8%` (#171412) | `37 39% 94%` (#F6F1EA) |
| primary | `0 64% 33%` (#8A1E1E) | `0 53% 81%` (#E8B5B5) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `30 12% 6%` (#110F0D) |
| muted | `40 32% 91%` (#EFEAE1) | `30 14% 11%` (#201C18) |
| muted-foreground | `28 8% 32%` (#58514B) | `33 11% 65%` (#B0A79C) |
| accent | `159 43% 21%` (#1F4D3C) | `159 44% 69%` (#8DD3BA) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `30 12% 6%` (#110F0D) |
| border | `37 24% 83%` (#DED6C9) | `30 15% 16%` (#2F2923) |

**Type** Playfair Display / Source Serif Pro · **Signature** a heavy top rule
above every section head.

## 3. Retro-futuristic

Y2K revival, vaporwave. Saturated violet and magenta, chrome edges, a deliberate
sense of the recent past imagining the future.

**Use for** creative tools, music, gaming, developer toys.

| Token | Light | Dark |
|---|---|---|
| background | `252 100% 98%` (#F7F5FF) | `248 60% 8%` (#0B0821) |
| foreground | `246 53% 15%` (#16123B) | `249 100% 96%` (#EEEBFF) |
| primary | `255 65% 34%` (#3B1E8F) | `251 100% 83%` (#B8A8FF) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `248 60% 8%` (#0B0821) |
| muted | `253 70% 95%` (#EDE9FB) | `247 56% 16%` (#171240) |
| muted-foreground | `246 29% 39%` (#4C4780) | `248 41% 74%` (#A9A2D8) |
| accent | `321 75% 39%` (#AE197A) | `325 100% 74%` (#FF7AC8) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `248 60% 8%` (#0B0821) |
| border | `252 63% 89%` (#D8D1F5) | `248 46% 22%` (#251E52) |

**Type** Clash Display / Plus Jakarta Sans · **Signature** a magenta-to-violet
edge on focus and hover — never as a background gradient on white.

## 4. Organic natural

Earthy, textured, hand-made. Warm neutrals, botanical greens, soft edges.

**Use for** food, agriculture, wellness, sustainability, craft commerce.

| Token | Light | Dark |
|---|---|---|
| background | `43 41% 97%` (#FAF9F4) | `50 20% 6%` (#12110C) |
| foreground | `42 20% 10%` (#1F1C14) | `45 32% 93%` (#F3F0E7) |
| primary | `113 22% 30%` (#405D3C) | `105 27% 70%` (#A8C79E) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `50 20% 6%` (#12110C) |
| muted | `42 32% 90%` (#EEE9DD) | `47 17% 10%` (#1E1C15) |
| muted-foreground | `45 16% 29%` (#56503E) | `43 13% 63%` (#ADA694) |
| accent | `26 56% 39%` (#9B5C2C) | `30 64% 66%` (#E0A871) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `50 20% 6%` (#12110C) |
| border | `42 27% 81%` (#DCD4C1) | `44 14% 15%` (#2C2921) |

**Type** Fraunces / Work Sans · **Signature** generous 12px radius and a paper
texture on section backgrounds.

## 5. Luxury refined

Fashion houses, premium brands. Black, cream, restrained gold. Space is the
luxury.

**Use for** premium commerce, private banking, hospitality, professional
services.

| Token | Light | Dark |
|---|---|---|
| background | `0 0% 100%` (#FFFFFF) | `30 20% 4%` (#0C0A08) |
| foreground | `30 18% 7%` (#15120F) | `42 39% 94%` (#F6F2EA) |
| primary | `30 18% 7%` (#15120F) | `42 54% 67%` (#D8BD7D) |
| primary-foreground | `41 65% 89%` (#F5EAD1) | `30 20% 4%` (#0C0A08) |
| muted | `40 31% 94%` (#F4F1EB) | `38 18% 9%` (#1B1813) |
| muted-foreground | `35 12% 32%` (#5B5348) | `41 15% 62%` (#ADA390) |
| accent | `42 61% 34%` (#8C6C22) | `42 54% 67%` (#D8BD7D) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `30 20% 4%` (#0C0A08) |
| border | `39 25% 86%` (#E4DED2) | `36 22% 14%` (#2C251C) |

**Type** Instrument Serif / Libre Franklin · **Signature** wide letter-spacing
on small caps labels, and nothing else decorated.

## 6. Playful

Figma, Notion. Rounded, friendly, bright but not childish.

**Use for** consumer apps, education, collaboration, onboarding-heavy products.

| Token | Light | Dark |
|---|---|---|
| background | `0 0% 100%` (#FFFFFF) | `216 28% 7%` (#0D1117) |
| foreground | `240 6% 10%` (#18181B) | `210 36% 96%` (#F1F5F8) |
| primary | `224 76% 48%` (#1D4FD7) | `218 100% 77%` (#8AB5FF) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `216 28% 7%` (#0D1117) |
| muted | `210 40% 96%` (#F1F5F9) | `216 22% 13%` (#1A2028) |
| muted-foreground | `215 16% 36%` (#4D596A) | `213 19% 70%` (#A4B1C1) |
| accent | `339 68% 45%` (#C1255B) | `336 100% 81%` (#FF9EC5) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `216 28% 7%` (#0D1117) |
| border | `214 32% 91%` (#E1E7EF) | `215 21% 17%` (#222A34) |

**Type** Cabinet Grotesk / Plus Jakarta Sans · **Signature** a 2px lift and
scale on hover, 120ms, and illustrated empty states.

## 7. Neo-brutalist

Raw, exposed, intentionally rough. Hard black borders, flat blocks, offset
shadows, no gradients.

**Use for** portfolios, indie products, anything that benefits from looking
un-corporate.

| Token | Light | Dark |
|---|---|---|
| background | `55 100% 97%` (#FFFEF0) | `0 0% 4%` (#0A0A0A) |
| foreground | `0 0% 0%` (#000000) | `55 100% 97%` (#FFFEF0) |
| primary | `0 0% 0%` (#000000) | `54 100% 50%` (#FFE600) |
| primary-foreground | `55 100% 97%` (#FFFEF0) | `0 0% 4%` (#0A0A0A) |
| muted | `54 40% 90%` (#F0EEDB) | `60 4% 10%` (#1B1B18) |
| muted-foreground | `52 14% 21%` (#3D3B2E) | `53 10% 68%` (#B6B4A5) |
| accent | `225 100% 40%` (#0033CC) | `222 100% 74%` (#7AA2FF) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `0 0% 4%` (#0A0A0A) |
| border | `0 0% 0%` (#000000) | `55 100% 97%` (#FFFEF0) |

**Type** Space Grotesk / IBM Plex Sans · **Signature** 2px solid borders and a
4px offset shadow, radius 0. The one direction here whose borders are high
contrast by design.

## 8. Art deco geometric

Bold shapes, symmetry, deep teal and brass. Structured and formal.

**Use for** hotels, theatres, heritage brands, event and ticketing.

| Token | Light | Dark |
|---|---|---|
| background | `40 50% 98%` (#FCFBF7) | `212 39% 6%` (#090F15) |
| foreground | `210 33% 9%` (#0F171F) | `47 27% 94%` (#F4F2EC) |
| primary | `197 67% 18%` (#0F3B4D) | `195 54% 67%` (#7DC2D8) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `212 39% 6%` (#090F15) |
| muted | `47 19% 91%` (#ECEBE4) | `212 30% 11%` (#141B24) |
| muted-foreground | `210 13% 33%` (#49545F) | `210 12% 69%` (#A6B0B9) |
| accent | `42 61% 34%` (#8C6C22) | `42 54% 67%` (#D8BD7D) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `212 39% 6%` (#090F15) |
| border | `44 17% 83%` (#DBD7CC) | `210 26% 16%` (#1E2933) |

**Type** Cabinet Grotesk / Source Serif Pro · **Signature** a repeating
geometric divider between sections, brass on deep teal.

## 9. Soft pastel

Dreamy, low-contrast surfaces with high-contrast text. Calm, contemporary.

**Use for** wellbeing, journaling, personal finance, meditation, scheduling.

| Token | Light | Dark |
|---|---|---|
| background | `270 100% 99%` (#FCFAFF) | `251 33% 9%` (#120F1F) |
| foreground | `255 28% 14%` (#1F1A2E) | `263 45% 94%` (#EEE9F7) |
| primary | `256 45% 45%` (#5B3FA6) | `257 78% 83%` (#C5B2F5) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `251 33% 9%` (#120F1F) |
| muted | `265 50% 95%` (#F1ECF9) | `252 33% 14%` (#1D182F) |
| muted-foreground | `255 17% 36%` (#544C6B) | `255 20% 70%` (#ABA3C2) |
| accent | `180 77% 24%` (#0E6C6C) | `180 53% 66%` (#7AD6D6) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `251 33% 9%` (#120F1F) |
| border | `265 39% 90%` (#E4DCEF) | `254 31% 19%` (#28213F) |

**Type** Fraunces / Plus Jakarta Sans · **Signature** soft tinted surfaces
instead of shadows for elevation. Pastel applies to *surfaces only* — text
stays at full contrast, which is what keeps this from becoming the washed-out
version of itself.

## 10. Industrial utilitarian

Data-dense, functional, no ornament. Built to be read for eight hours.

**Use for** logistics, operations consoles, admin panels, internal tooling.

| Token | Light | Dark |
|---|---|---|
| background | `60 11% 96%` (#F6F6F4) | `210 7% 6%` (#0E0F10) |
| foreground | `210 6% 7%` (#111213) | `60 6% 94%` (#F1F1EF) |
| primary | `210 24% 16%` (#1F2933) | `212 15% 81%` (#C7CED6) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `210 7% 6%` (#0E0F10) |
| muted | `60 6% 91%` (#E9E9E7) | `210 7% 11%` (#1A1C1E) |
| muted-foreground | `212 8% 32%` (#4B5158) | `210 7% 66%` (#A2A8AE) |
| accent | `21 85% 38%` (#B3480F) | `22 100% 67%` (#FF9457) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `210 7% 6%` (#0E0F10) |
| border | `60 6% 83%` (#D6D6D1) | `210 7% 16%` (#26292C) |

**Type** Satoshi / IBM Plex Sans · **Signature** 4px radius, tight 32px rows,
and the accent reserved strictly for alerts.

## 11. Clinical trust

Calm, legible, unexcitable. Blues and greens, high contrast, nothing playful.

**Use for** healthcare, government, education, insurance, compliance — anywhere
the user is anxious and the interface must not add to it.

| Token | Light | Dark |
|---|---|---|
| background | `0 0% 100%` (#FFFFFF) | `202 54% 7%` (#08141B) |
| foreground | `204 46% 12%` (#11212D) | `200 40% 94%` (#EAF2F6) |
| primary | `197 83% 26%` (#0B5A79) | `196 63% 67%` (#76C4E0) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `202 54% 7%` (#08141B) |
| muted | `202 33% 95%` (#EEF3F6) | `203 40% 11%` (#111F27) |
| muted-foreground | `205 16% 35%` (#4B5C68) | `203 16% 68%` (#A0B0BA) |
| accent | `159 76% 25%` (#0F704E) | `156 56% 64%` (#70D7AD) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `202 54% 7%` (#08141B) |
| border | `204 27% 89%` (#DBE4EB) | `202 33% 16%` (#1B2C36) |

**Type** Satoshi / Libre Franklin · **Signature** a persistent status band that
states plainly what is happening and what happens next. Never colour alone for
status — always an icon or word beside it.

## 12. Financial precision

Dense numerics, tabular alignment, restrained colour. Green and red carry
meaning and nothing else does.

**Use for** fintech, lending, payments, accounting, trading, billing.

| Token | Light | Dark |
|---|---|---|
| background | `0 0% 100%` (#FFFFFF) | `219 54% 5%` (#060B14) |
| foreground | `220 49% 8%` (#0A111E) | `216 38% 95%` (#EDF1F7) |
| primary | `210 63% 19%` (#12304F) | `210 52% 71%` (#8FB5DC) |
| primary-foreground | `0 0% 100%` (#FFFFFF) | `219 54% 5%` (#060B14) |
| muted | `214 33% 96%` (#F1F4F8) | `216 37% 11%` (#121A26) |
| muted-foreground | `212 20% 36%` (#495B6E) | `213 19% 68%` (#9EACBD) |
| accent | `162 70% 22%` (#115F48) | `157 54% 59%` (#5ECFA4) |
| accent-foreground | `0 0% 100%` (#FFFFFF) | `219 54% 5%` (#060B14) |
| border | `214 26% 89%` (#DCE2EA) | `215 30% 16%` (#1D2735) |

**Type** Cabinet Grotesk / IBM Plex Sans · **Signature** tabular figures
everywhere numbers align — `font-variant-numeric: tabular-nums`, or columns
visibly jitter as values update. Never signal gain or loss by colour alone;
pair it with a sign or an arrow.

---

## Choosing

Sector narrows the list to candidates; **what the product feels like to use**
picks between them. A one-to-one sector mapping hands every education product
"Clinical trust" and every money product "Financial precision" — a suite of
seven education products would get one direction seven times, leaving the
accent to carry all differentiation.

| If the product is… | Candidates |
|---|---|
| A developer or B2B tool | 1, 10, 7 |
| Read for long stretches | 2, 10, 5 |
| Consumer-facing and friendly | 6, 9, 4 |
| Premium or high-ticket | 5, 8, 2 |
| Public sector, health, education | 11, 9, 6 |
| Money | 12, 5, 10 |
| Deliberately distinctive | 3, 7, 2 |
| Natural, physical, or made by hand | 4, 9, 6 |

Tiebreak on feel, not sector:

| Using it should feel… | Lean |
|---|---|
| Calm — the user is anxious, the interface must not add to it | 11, 9 |
| Fast and dense — read for hours, operated all day | 10, 12 |
| Warm — human, personal, hand-made | 4, 6 |
| Authoritative — precise, formal, trustworthy with money or records | 12, 5, 2 |
| Delightful — first-run wonder matters more than density | 6, 3 |

A parents' school portal is *calm* (11 or 9); an exam-marking console for
staff is *fast and dense* (10) — same sector, different products, different
directions, and that is the point.

**Within one suite, no two products share a direction.** The accent is the
per-product identity; the direction is the per-product character, and a suite
of look-alikes has neither. If the category offers only one honest fit, the
second product takes the nearest neighbour from its feel row and records why
in `design/design-system.md`.

If two still fit, pick the one whose **signature move** you can actually
execute in the surface you are building. A direction is only worth choosing if
its one memorable element survives into the code.
