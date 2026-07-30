# Style directions — the tier-3 fallback

Used when the design engine is unreachable: no Python, or pro-max not
installed. **Tell the user** the engine was unavailable so the narrower range
is explained.

The twelve directions come from **elite-frontend-ux** §1. Each has been given a
concrete palette and a font pairing so this is a real selection, not a prompt
to improvise.

**Every palette here is contrast-verified** — 120 pairs, light and dark, all
passing 4.5:1 for text and 3:1 for the focus ring. Re-run
`node "$CONTRAST" design/tokens.css` after freezing anyway; the check
is cheap and a typo in transcription is not.

## How to use this file

1. Pick the direction that fits the product, not the one you like most.
2. Copy both palettes into `design/tokens.css`, converting hex to HSL triplets.
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
| background | `#FFFFFF` | `#09090B` |
| foreground | `#0A0A0A` | `#FAFAFA` |
| primary | `#0A0A0A` | `#FAFAFA` |
| primary-foreground | `#FFFFFF` | `#09090B` |
| muted | `#F4F4F5` | `#18181B` |
| muted-foreground | `#52525B` | `#A1A1AA` |
| accent | `#4338CA` | `#A5B4FC` |
| accent-foreground | `#FFFFFF` | `#09090B` |
| border | `#E4E4E7` | `#27272A` |

**Type** Space Grotesk / Work Sans · **Signature** one hairline rule and a
single accent, used no more than twice per screen.

## 2. Maximalist editorial

Bloomberg, award-winning magazines. Dense type, strong rules, confident colour,
content as the visual.

**Use for** news, long-form, research, anything with a lot to say.

| Token | Light | Dark |
|---|---|---|
| background | `#FBF9F4` | `#12100E` |
| foreground | `#171412` | `#F5F0E8` |
| primary | `#8B1E1E` | `#E8B4B4` |
| primary-foreground | `#FFFFFF` | `#12100E` |
| muted | `#EFEAE0` | `#211D19` |
| muted-foreground | `#57504A` | `#B0A79C` |
| accent | `#1F4D3D` | `#8FD3BB` |
| accent-foreground | `#FFFFFF` | `#12100E` |
| border | `#DDD5C8` | `#2E2822` |

**Type** Playfair Display / Source Serif Pro · **Signature** a heavy top rule
above every section head.

## 3. Retro-futuristic

Y2K revival, vaporwave. Saturated violet and magenta, chrome edges, a deliberate
sense of the recent past imagining the future.

**Use for** creative tools, music, gaming, developer toys.

| Token | Light | Dark |
|---|---|---|
| background | `#F7F5FF` | `#0B0820` |
| foreground | `#16123A` | `#EDEAFF` |
| primary | `#3B1E8F` | `#B9A9FF` |
| primary-foreground | `#FFFFFF` | `#0B0820` |
| muted | `#ECE8FB` | `#171240` |
| muted-foreground | `#4C4680` | `#A9A2D8` |
| accent | `#B0197A` | `#FF7AC8` |
| accent-foreground | `#FFFFFF` | `#0B0820` |
| border | `#DAD3F5` | `#251E52` |

**Type** Clash Display / Plus Jakarta Sans · **Signature** a magenta-to-violet
edge on focus and hover — never as a background gradient on white.

## 4. Organic natural

Earthy, textured, hand-made. Warm neutrals, botanical greens, soft edges.

**Use for** food, agriculture, wellness, sustainability, craft commerce.

| Token | Light | Dark |
|---|---|---|
| background | `#FAF8F3` | `#12110C` |
| foreground | `#1E1B14` | `#F2EFE6` |
| primary | `#3F5D3B` | `#A8C79E` |
| primary-foreground | `#FFFFFF` | `#12110C` |
| muted | `#EDE8DC` | `#1F1D16` |
| muted-foreground | `#57513F` | `#ADA694` |
| accent | `#9A5B2B` | `#E0A972` |
| accent-foreground | `#FFFFFF` | `#12110C` |
| border | `#DCD4C2` | `#2C2921` |

**Type** Fraunces / Work Sans · **Signature** generous 12px radius and a paper
texture on section backgrounds.

## 5. Luxury refined

Fashion houses, premium brands. Black, cream, restrained gold. Space is the
luxury.

**Use for** premium commerce, private banking, hospitality, professional
services.

| Token | Light | Dark |
|---|---|---|
| background | `#FFFFFF` | `#0C0A08` |
| foreground | `#14110E` | `#F5F1E8` |
| primary | `#14110E` | `#D9BE7E` |
| primary-foreground | `#F5E9D0` | `#0C0A08` |
| muted | `#F5F2EC` | `#1A1712` |
| muted-foreground | `#5B5348` | `#ADA491` |
| accent | `#8A6A21` | `#D9BE7E` |
| accent-foreground | `#FFFFFF` | `#0C0A08` |
| border | `#E5DFD4` | `#2A241B` |

**Type** Instrument Serif / Libre Franklin · **Signature** wide letter-spacing
on small caps labels, and nothing else decorated.

## 6. Playful

Figma, Notion. Rounded, friendly, bright but not childish.

**Use for** consumer apps, education, collaboration, onboarding-heavy products.

| Token | Light | Dark |
|---|---|---|
| background | `#FFFFFF` | `#0D1117` |
| foreground | `#18181B` | `#F0F4F8` |
| primary | `#1D4FD8` | `#8AB4FF` |
| primary-foreground | `#FFFFFF` | `#0D1117` |
| muted | `#F1F5F9` | `#1A2029` |
| muted-foreground | `#4E5A6B` | `#A3B0C0` |
| accent | `#C2255C` | `#FF9EC4` |
| accent-foreground | `#FFFFFF` | `#0D1117` |
| border | `#E2E8F0` | `#232B36` |

**Type** Cabinet Grotesk / Plus Jakarta Sans · **Signature** a 2px lift and
scale on hover, 120ms, and illustrated empty states.

## 7. Neo-brutalist

Raw, exposed, intentionally rough. Hard black borders, flat blocks, offset
shadows, no gradients.

**Use for** portfolios, indie products, anything that benefits from looking
un-corporate.

| Token | Light | Dark |
|---|---|---|
| background | `#FFFEF2` | `#0A0A0A` |
| foreground | `#000000` | `#FFFEF2` |
| primary | `#000000` | `#FFE600` |
| primary-foreground | `#FFFEF2` | `#0A0A0A` |
| muted | `#F0EEDC` | `#1A1A18` |
| muted-foreground | `#3D3B2E` | `#B5B3A4` |
| accent | `#0033CC` | `#7AA2FF` |
| accent-foreground | `#FFFFFF` | `#0A0A0A` |
| border | `#000000` | `#FFFEF2` |

**Type** Space Grotesk / IBM Plex Sans · **Signature** 2px solid borders and a
4px offset shadow, radius 0. The one direction here whose borders are high
contrast by design.

## 8. Art deco geometric

Bold shapes, symmetry, deep teal and brass. Structured and formal.

**Use for** hotels, theatres, heritage brands, event and ticketing.

| Token | Light | Dark |
|---|---|---|
| background | `#FCFAF6` | `#0A1017` |
| foreground | `#101820` | `#F3F1EA` |
| primary | `#0F3B4C` | `#7FC3D9` |
| primary-foreground | `#FFFFFF` | `#0A1017` |
| muted | `#ECEAE3` | `#141C25` |
| muted-foreground | `#4A5560` | `#A5AFB9` |
| accent | `#8A6A21` | `#D9BE7E` |
| accent-foreground | `#FFFFFF` | `#0A1017` |
| border | `#DAD6CB` | `#1F2A35` |

**Type** Cabinet Grotesk / Source Serif Pro · **Signature** a repeating
geometric divider between sections, brass on deep teal.

## 9. Soft pastel

Dreamy, low-contrast surfaces with high-contrast text. Calm, contemporary.

**Use for** wellbeing, journaling, personal finance, meditation, scheduling.

| Token | Light | Dark |
|---|---|---|
| background | `#FDFBFF` | `#131020` |
| foreground | `#1F1A2E` | `#EFEAF7` |
| primary | `#5B3FA8` | `#C4B0F5` |
| primary-foreground | `#FFFFFF` | `#131020` |
| muted | `#F2EDF9` | `#1D1830` |
| muted-foreground | `#544C6B` | `#ABA3C2` |
| accent | `#0E6E6E` | `#79D6D6` |
| accent-foreground | `#FFFFFF` | `#131020` |
| border | `#E5DDF0` | `#292240` |

**Type** Fraunces / Plus Jakarta Sans · **Signature** soft tinted surfaces
instead of shadows for elevation. Pastel applies to *surfaces only* — text
stays at full contrast, which is what keeps this from becoming the washed-out
version of itself.

## 10. Industrial utilitarian

Data-dense, functional, no ornament. Built to be read for eight hours.

**Use for** logistics, operations consoles, admin panels, internal tooling.

| Token | Light | Dark |
|---|---|---|
| background | `#F7F7F5` | `#0E0F10` |
| foreground | `#101112` | `#F0F0EE` |
| primary | `#1F2933` | `#C7CED6` |
| primary-foreground | `#FFFFFF` | `#0E0F10` |
| muted | `#E9E9E6` | `#191B1D` |
| muted-foreground | `#4B5158` | `#A2A8AE` |
| accent | `#B3480F` | `#FF9457` |
| accent-foreground | `#FFFFFF` | `#0E0F10` |
| border | `#D6D6D1` | `#26292C` |

**Type** Satoshi / IBM Plex Sans · **Signature** 4px radius, tight 32px rows,
and the accent reserved strictly for alerts.

## 11. Clinical trust

Calm, legible, unexcitable. Blues and greens, high contrast, nothing playful.

**Use for** healthcare, government, education, insurance, compliance — anywhere
the user is anxious and the interface must not add to it.

| Token | Light | Dark |
|---|---|---|
| background | `#FFFFFF` | `#08141B` |
| foreground | `#10202B` | `#EAF2F6` |
| primary | `#0B5A7A` | `#77C4E0` |
| primary-foreground | `#FFFFFF` | `#08141B` |
| muted | `#EFF4F7` | `#111F28` |
| muted-foreground | `#4A5B67` | `#A0B0BA` |
| accent | `#0F6E4C` | `#6FD6AC` |
| accent-foreground | `#FFFFFF` | `#08141B` |
| border | `#DCE5EB` | `#1B2C36` |

**Type** Satoshi / Libre Franklin · **Signature** a persistent status band that
states plainly what is happening and what happens next. Never colour alone for
status — always an icon or word beside it.

## 12. Financial precision

Dense numerics, tabular alignment, restrained colour. Green and red carry
meaning and nothing else does.

**Use for** fintech, lending, payments, accounting, trading, billing.

| Token | Light | Dark |
|---|---|---|
| background | `#FFFFFF` | `#060B14` |
| foreground | `#0B1220` | `#EDF1F7` |
| primary | `#12304F` | `#8FB6DC` |
| primary-foreground | `#FFFFFF` | `#060B14` |
| muted | `#F1F4F8` | `#111925` |
| muted-foreground | `#495A6E` | `#9FADBE` |
| accent | `#116149` | `#5FCFA4` |
| accent-foreground | `#FFFFFF` | `#060B14` |
| border | `#DDE3EB` | `#1C2634` |

**Type** Cabinet Grotesk / IBM Plex Sans · **Signature** tabular figures
everywhere numbers align — `font-variant-numeric: tabular-nums`, or columns
visibly jitter as values update. Never signal gain or loss by colour alone;
pair it with a sign or an arrow.

---

## Choosing

| If the product is… | Start at |
|---|---|
| A developer or B2B tool | 1, 10 |
| Read for long stretches | 2, 10 |
| Consumer-facing and friendly | 6, 9 |
| Premium or high-ticket | 5, 8 |
| Public sector, health, education | 11 |
| Money | 12 |
| Deliberately distinctive | 3, 7 |
| Natural, physical, or made by hand | 4 |

If two fit, pick the one whose **signature move** you can actually execute in
the surface you are building. A direction is only worth choosing if its one
memorable element survives into the code.
