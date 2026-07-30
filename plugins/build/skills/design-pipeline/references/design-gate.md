# The gate — Phase 5

Vendored from **elite-frontend-ux** §8–10, with responsive and dark-mode items
added. Run this **last, on finished code**, before presenting anything.

Report what failed and what you changed. A gate that always passes silently is
a gate nobody ran.

## Anti-patterns — never ship these

### Visual

- Purple/blue gradients on white — the AI cliché
- Inter, Roboto or Arial as a **display** face
- Inconsistent border-radius — pick one: 4px, 8px or 12px
- Shadows that do not match a single light source
- More than 3 font weights
- Rainbow colour schemes without purpose

### UX

- Confirmshaming ("No thanks, I hate saving money")
- Pre-selected options benefiting the company over the user
- Cancellation harder than signup
- Fake urgency or scarcity
- Infinite scroll with no pagination option — breaks the back button and
  keyboard navigation
- Disabled submit buttons before the user attempts submission
- Placeholder text used as a label

### Technical

- `outline: none` with no focus replacement
- `<div onclick>` instead of `<button>`
- Dynamic Tailwind class names — `bg-${color}-500`
- Animating layout properties — width, height, margin, padding
- Reading layout properties in loops (thrashing)
- Missing `alt` text
- Forms without labels
- A hardcoded colour in a component instead of a token

### Mobile

- Touch targets below 44×44px (48×48dp on Android)
- Body text below 16px
- Horizontal scrolling of page content
- No tap feedback within 100ms
- Fixed elements blocking the thumb zone

---

## Pre-delivery checklist

### Accessibility

- [ ] Contrast ≥ 4.5:1 text, ≥ 3:1 UI — **verified by running the script, not
      by eye**, in both light and dark
- [ ] Touch targets ≥ 44×44px at every breakpoint
- [ ] All images have `alt`
- [ ] All form fields have a `<label>`
- [ ] Visible focus states on every interactive element
- [ ] No colour-only information
- [ ] Reduced motion honoured (`prefers-reduced-motion` / `disableAnimations`)

```
node "$CONTRAST" design/tokens.css
```

### Responsive

- [ ] Works at 320px, 768px (**tablet**) and 1280px
- [ ] Tablet is a designed layout, not a stretched phone
- [ ] No horizontal page scroll at any width — wide content scrolls in its own
      container
- [ ] Images `max-w-full`; no fixed width exceeding a phone
- [ ] Body text ≥16px on mobile
- [ ] Flutter: checked in landscape and at the largest OS text scale

### Dark mode

- [ ] Implemented on every surface — web and Flutter alike
- [ ] Driven by tokens; **no component names a raw colour**
- [ ] Contrast gate passes against the dark block too
- [ ] Follows the system preference, and an explicit toggle overrides and
      persists
- [ ] Dark is a designed palette, not the light one inverted

### Visual design

- [ ] Clear typographic hierarchy, 3–5 levels
- [ ] Consistent spacing from the token scale
- [ ] Maximum 2–3 typefaces
- [ ] Cohesive palette, 60-30-10
- [ ] **One** memorable design element, and you can name it

### Technical

- [ ] Mobile-first, not desktop-shrunk
- [ ] Animations use only transform and opacity
- [ ] No dynamic Tailwind class names
- [ ] `cn()` used for class merging
- [ ] Dark mode via CSS variables / `ThemeData`, not per-component branches

### UX integrity

- [ ] Single primary goal per page
- [ ] No dark patterns or confirmshaming
- [ ] Footer always reachable
- [ ] Error states are helpful — never a raw exception
- [ ] Loading states exist, and are skeletons rather than bare spinners
- [ ] Empty states say what this is and what fills it

### Consistency with the frozen system

- [ ] Every colour traces to a token in `design/tokens.css`
- [ ] Any deviation is recorded in `design/overrides.md`, with a reason
- [ ] Nothing re-selected the style — `design/design-system.md` is unchanged
      unless the user explicitly asked for a restyle

---

## Implementation notes

1. **Start from the tokens** — include the variables before writing components
2. **Mobile-first** — base styles are mobile, layer up with breakpoints
3. **Semantic HTML first** — proper elements before any ARIA
4. **Composition over configuration props**
5. **Test the extremes** — smallest screen, longest content, empty state

Bold aesthetic choices plus systematic execution make memorable interfaces.
Generic is the enemy. Commit to a direction and execute precisely.
