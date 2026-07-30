# Tokens and the accessibility floor — Phase 3

Vendored from **elite-frontend-ux** §2–3. This file is the authority on token
architecture, naming, scale and the accessibility floor in every tier, whether
or not the design engine was reachable.

Never eyeball spacing or pick arbitrary colours. Use these systematic values.

## Typography scale

```
--font-size-xs:   0.75rem   /* 12px - captions, labels */
--font-size-sm:   0.875rem  /* 14px - secondary text */
--font-size-base: 1rem      /* 16px - body text (MINIMUM for mobile) */
--font-size-lg:   1.125rem  /* 18px - lead paragraphs */
--font-size-xl:   1.25rem   /* 20px - H4 */
--font-size-2xl:  1.5rem    /* 24px - H3 */
--font-size-3xl:  2rem      /* 32px - H2 */
--font-size-4xl:  2.5rem    /* 40px - H1 */
--font-size-5xl:  3.5rem    /* 56px - Display */
```

- Line height 1.5–1.6 for body, 1.1–1.2 for headings
- Line length 45–75 characters (`max-w-prose` or `max-w-2xl`)
- **Maximum 2–3 typefaces** per design
- **Never** Inter, Roboto or Arial as a *display* face — overused AI defaults,
  and this holds however confidently pro-max returns them
- Pair one distinctive display face with one refined body face

Distinctive display: Fraunces, Instrument Serif, Playfair Display, Space
Grotesk, Clash Display, Cabinet Grotesk, Satoshi.
Distinctive body: Source Serif Pro, IBM Plex Sans, Libre Franklin, Work Sans,
Plus Jakarta Sans.

## Spacing scale (8px base)

```
--space-0:  0          --space-8:  2rem    /* 32px */
--space-1:  0.25rem    --space-10: 2.5rem  /* 40px */
--space-2:  0.5rem     --space-12: 3rem    /* 48px */
--space-3:  0.75rem    --space-16: 4rem    /* 64px */
--space-4:  1rem       --space-20: 5rem    /* 80px */
--space-5:  1.25rem    --space-24: 6rem    /* 96px */
--space-6:  1.5rem     --space-32: 8rem    /* 128px - section gaps */
```

Section spacing: 80–120px between major landing page sections.

## Colour system

HSL, stored as a bare triplet so opacity modifiers work — `hsl(var(--primary) / 0.9)`.
This is the naming scheme pro-max's values are mapped *into*; pro-max never
brings its own token names.

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 222 47% 11%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 210 40% 98%;
  --success: 142 76% 36%;
  --warning: 38 92% 50%;
  --border: 214 32% 91%;
  --ring: 222 47% 11%;
  --radius: 0.5rem;
}

.dark {
  --background: 222 47% 4%;
  --foreground: 210 40% 98%;
  /* ... invert appropriately, then re-run the contrast gate on this block */
}
```

Colour rules:

- 60-30-10 ratio: 60% dominant, 30% secondary, 10% accent
- **One** bold accent colour maximum
- **Never** purple gradients on white — the AI cliché, and a veto over any
  palette that proposes it

### Mapping pro-max output into these names

pro-max returns semantic keys already. The mapping is direct:

| pro-max | elite token |
|---|---|
| `Primary` | `--primary` |
| `On Primary` | `--primary-foreground` |
| `Secondary` | `--secondary` |
| `On Secondary` | `--secondary-foreground` |
| `Accent` | `--accent` |
| `On Accent` | `--accent-foreground` |
| `Background` | `--background` |
| `Foreground` | `--foreground` |

Convert hex to the HSL triplet form as you map. Values pro-max does not supply
— `--muted`, `--muted-foreground`, `--border`, `--ring` — are derived from the
palette, not invented: mute toward the background, border a step off it.

## The contrast gate

**pro-max palettes are not contrast-safe.** Its own CRM palette pairs
`#FFFFFF` on `#3B82F6` at 3.68:1 — passing the 3:1 UI threshold and failing
body text, so a button using it as intended is non-compliant.

Run before committing:

```
node scripts/contrast.mjs design/tokens.css
```

It checks every foreground/background pair implied by the token names, in each
block separately, and exits non-zero on failure. **Check the dark block too** —
a flattened map hides it, because the later declaration simply wins.

Fix the token and re-run. Never widen the threshold.

## Animation timing

```
--duration-instant: 50ms    --ease-default: cubic-bezier(0.4, 0, 0.2, 1)
--duration-fast:    100ms   --ease-in:      cubic-bezier(0.4, 0, 1, 1)
--duration-normal:  200ms   --ease-out:     cubic-bezier(0, 0, 0.2, 1)
--duration-slow:    300ms   --ease-bounce:  cubic-bezier(0.34, 1.56, 0.64, 1)
--duration-slower:  500ms
```

- Button feedback 100–150ms — must feel instantaneous
- **Only** animate `transform` and `opacity` (GPU accelerated)
- **Never** animate `width`, `height`, `margin`, `padding` — triggers reflow
- Respect `prefers-reduced-motion`

pro-max's GSAP presets pass through these rules. A preset that animates layout
properties is rewritten or dropped, not adopted.

---

# Accessibility floor (non-negotiable)

Hard requirements, not suggestions. Never overridden by a style choice.

## Colour contrast (WCAG 2.1 AA)

| Element | Minimum |
|---|---|
| Body text | 4.5:1 |
| Large text (18pt+, or 14pt bold) | 3:1 |
| UI components, icons | 3:1 |
| Focus indicators | 3:1 |

## Touch targets

- Minimum **44×44px** (Apple/WCAG) or 48×48dp (Material)
- Minimum 8px between adjacent targets
- The target may extend beyond the visual boundary via padding

## Interactive elements

- Every interactive element has a **visible focus state**
- Never `outline: none` without a replacement
- Focus indicators need 3:1 against adjacent colours
- Logical tab order; avoid `tabindex` > 0

## Forms

- Every input has an associated `<label>` — not just a placeholder
- Error messages programmatically associated via `aria-describedby`
- Do not disable submit before the user attempts submission
- Use `autocomplete` appropriately

## Images and icons

- Meaningful images: descriptive `alt`
- Decorative: `alt=""` or `aria-hidden="true"`
- Icon-only buttons: `aria-label` required
- SVG: `role="img"` + `aria-label`, or `aria-hidden="true"`

## Semantic HTML

```html
<!-- CORRECT -->
<button type="button">Click me</button>
<a href="/page">Navigate</a>

<!-- WRONG -->
<div onclick="...">Click me</div>
<span class="link">Navigate</span>
```

First rule of ARIA: **don't use ARIA if native HTML works.**

## The freeze artefacts

`design/tokens.css` — the block above, filled in, both light and dark.

`design/design-system.md` — style direction, palette with rationale, font
pairing, the one memorable element, and the contrast results. Write the
*reasoning*, not just the values: the next session inherits this file and
nothing else, and a list of hex codes with no argument behind it invites
someone to change them.

`design/overrides.md` — per-surface deviations. This is the only one of the
three that changes during normal work.
