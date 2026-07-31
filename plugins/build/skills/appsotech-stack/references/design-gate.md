# The gate — Phase 5

Vendored from **elite-frontend-ux** §8–10, with responsive and dark-mode items
added. Run this **last, on finished code**, before presenting anything.

Report what failed and what you changed. A gate that always passes silently is
a gate nobody ran.

## Run the scripts first

```
node "$GATE" --serve <build-dir>        # all of it, one summary
```

It discovers `design/` and every `apps/*/src` from the conventions, so only the
rendered target needs naming. Underneath it runs:

```
node "$CONTRAST" design/tokens.css                  # tokens still compliant
node "$FREEZE" design/tokens.css design/design-system.md  # …and still the frozen ones
node "$TOKENSDART" design/tokens.css -o <dart> --check    # Flutter copy has not drifted
node "$AUDIT" <src-dir>                             # the code actually uses them
node "$RESPONSIVE" --serve <build-dir>              # it holds up in a real browser
```

`--serve` runs a static server with the SPA fallback over a build directory, so
a built surface is one command. A single-file prototype or a running dev server
can be passed directly instead.

**A step that could not run prints `SKIP` and is never counted as a pass.** If
Playwright is absent the rendered checks skip; that is a gap in the run, not a
clean bill of health, and the summary repeats it at the end.

Between them these cover the checklist items marked **[auto]** below. Everything
else needs a human pass — and those are not leftovers, they are the judgement
calls: whether the tablet layout is designed or merely fits, whether dark mode
was designed or inverted, whether the memorable element survived into the code.

`$AUDIT` exits 1 on errors and 0 on warnings alone. `--warn-only` surveys
without failing. A justified exception gets a `design-ok` comment on the line,
which is a decision someone can review — deleting a rule is not.

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
- `transition: all` — animates properties nobody chose, off the GPU
- `scale(0)` — nothing in the real world appears out of nothing
- Framer Motion `x`/`y`/`scale` shorthands — main thread, drops frames
- Reading layout properties in loops (thrashing)
- A WebGL canvas behind a signed-in surface — battery tax on a daily user
- `100vh` on a full-screen hero — taller than the viewport on iOS
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

- [ ] **[auto]** Contrast ≥ 4.5:1 text, ≥ 3:1 focus ring, both light and dark
- [ ] **[auto]** Contrast holds *as rendered* — a token used against an
      unintended background, or a translucent foreground, fails here and passes
      the token file
- [ ] **[auto]** Text over an image or gradient is reported for a human — the
      checker will not guess a ratio it cannot compute
- [ ] **[auto]** Touch targets ≥ 44×44px at every breakpoint
- [ ] **[auto]** All images have `alt`
- [ ] **[auto]** All form fields have a `<label>`, `aria-label` or `aria-labelledby`
- [ ] **[auto]** Focus never removed without a replacement
- [ ] No colour-only information
- [ ] Reduced motion honoured (`prefers-reduced-motion` / `disableAnimations`)

### Responsive

- [ ] **[auto]** Loads at 320px, 768px (**tablet**) and 1280px with no page overflow
- [ ] Tablet is a designed layout, not a stretched phone
- [ ] **[auto]** No horizontal page scroll — wide content scrolls in its own container
- [ ] Images `max-w-full`; no fixed width exceeding a phone
- [ ] **[auto]** Form controls ≥16px on mobile (below this iOS zooms on focus)
- [ ] **[auto]** Nothing clips its own content at 740×360 — a phone in
      landscape, where `height: 100vh` eats the CTA
- [ ] Fixed chrome leaves room to read on a short viewport
- [ ] Flutter: checked in landscape and at the largest OS text scale

### Dark mode

- [ ] **[auto]** (web) Implemented — the rendered page actually changes under `prefers-color-scheme: dark`. Flutter checked by hand.
- [ ] Driven by tokens; **no component names a raw colour**
- [ ] Contrast gate passes against the dark block too
- [ ] Follows the system preference, and an explicit toggle overrides and
      persists
- [ ] Dark is a designed palette, not the light one inverted

### Visual design

- [ ] Clear typographic hierarchy, 3–5 levels
- [ ] Consistent spacing from the token scale
- [ ] **[auto]** Primary face is not Inter, Roboto or Arial · maximum 2–3 typefaces
- [ ] Cohesive palette, 60-30-10
- [ ] **One** memorable design element, and you can name it

### Technical

- [ ] Mobile-first, not desktop-shrunk
- [ ] **[auto]** Animations use only transform and opacity
- [ ] Nothing animates that is triggered 100+ times a day
- [ ] No `ease-in` on UI, and no `transition: all`
- [ ] Rapidly-retriggered motion uses transitions, not keyframes
- [ ] Reduced motion drops movement but keeps the feedback
- [ ] **[auto]** No dynamic Tailwind class names
- [ ] `cn()` used for class merging
- [ ] Dark mode via CSS variables / `ThemeData`, not per-component branches

### Hero *(public surfaces only)*

- [ ] **[auto]** `100svh`, not `100vh` / `h-screen`, on anything that must fit the fold
- [ ] **[auto]** `three`/R3F loaded with `next/dynamic(…, { ssr: false })`, never imported into a route file
- [ ] **[auto]** Ambient motion has a `prefers-reduced-motion` path — and it goes to **zero**, not gentler
- [ ] The `<h1>` is real server-rendered text, not drawn in the canvas
- [ ] The canvas is not the LCP element; a hero *image* is, and carries `priority`
- [ ] Loop pauses off-screen (`IntersectionObserver`) and on `visibilitychange`
- [ ] `dpr` clamped — `<Canvas dpr={[1, 1.5]}>`
- [ ] Pointer position written to a ref, never `setState` per `pointermove`
- [ ] Without a fine pointer the field drifts on its own — never frozen
- [ ] The form traces to `design/design-system.md`, not invented this session
- [ ] Text over a hero image sits on a scrim that holds 4.5:1 across the whole
      text box — `contrast.mjs` cannot sample a photograph
- [ ] No canvas on `webapp` or `admin-web` at all

### UX integrity

- [ ] Single primary goal per page
- [ ] No dark patterns or confirmshaming
- [ ] Footer always reachable
- [ ] Error states are helpful — never a raw exception
- [ ] Loading states exist, and are skeletons rather than bare spinners
- [ ] Empty states say what this is and what fills it

### Flutter

- [ ] **[auto]** No `Color(0x…)` literal and no bare `Colors.blue` — the
      palette or `Theme.of(context).colorScheme`
- [ ] **[auto]** `tokens.dart` regenerated, not hand-edited beside the CSS
- [ ] **[auto]** Every `Image.*` has a `semanticLabel`, or `excludeFromSemantics`
- [ ] **[auto]** Breakpoints come from `LayoutBuilder`, not `MediaQuery.size`
- [ ] **[auto]** `GestureDetector` tap handlers are wrapped in `Semantics`
- [ ] Checked at the largest OS text scale and in landscape

### Consistency with the frozen system

- [ ] **[auto]** Every colour traces to a token in `design/tokens.css`
- [ ] **[auto]** `tokens.css` still holds the palette `design-system.md`
      describes — the freeze fingerprint matches
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
