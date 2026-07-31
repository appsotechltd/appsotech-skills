# Hero treatment — Phases 2, 3 and 4

The hero is the one place this skill allows decorative motion and 3D. This
file owns which treatment a page gets, what it may cost, and how it degrades.

It is not a licence for 3D elsewhere. A canvas anywhere but a hero needs a
reason that is not "it looks good" — see `motion.md`'s frequency gate.

## The four treatments

| Treatment | What it is | Reach for it when |
|---|---|---|
| **Particles** | A drifting field that responds to the pointer | The product is abstract — software, a platform, a service |
| **3D shape** | One slowly-moving abstract form | The product has a *thing* at its centre worth abstracting |
| **Image** | A photograph or illustration, full-bleed | There is a real subject worth showing — people, a place, physical goods |
| **Type alone** | Headline, sub, CTA, and nothing behind it | The copy is strong, the brand is confident, or the page must be fast above all |

**Type alone is a real answer, not a fallback.** Stripe's and Linear's heroes
carry more weight from typography and restraint than most particle fields do.
Pick decoration because it says something, not because the section looks empty.

One treatment per page. Particles *and* a 3D shape in the same hero is two
things competing for the same attention, and twice the frame budget.

## Which surfaces may have one

The test is who visits and how often, not what the surface is called.

| Kind of surface | Allowed | Appsotech name |
|---|---|---|
| Public, marketing, a first impression | Yes | `platform-web` |
| Public, a tenant's or customer's own site | Yes — subject to their frozen system | `tenant-web` |
| Behind auth, opened daily | **No.** Forty visits a day, and they already bought it | `webapp` |
| An operator or admin console | **No.** They are working, not being sold to | `admin-web` |
| Native mobile (Flutter) | Image or gradient only — no WebGL | `mobile` |

This is `motion.md`'s frequency gate applied to a whole surface. Ambient motion
on a page someone opens every morning is a battery tax on a person who has
already bought the thing.

## Engine — decided, not chosen

| Treatment | Build it with |
|---|---|
| 2D particles | Plain `<canvas>` 2D context. **No library.** |
| 3D shape | `@react-three/fiber` + `@react-three/drei`, dynamically imported |

`three` is roughly 170KB gzipped before R3F and drei. A field of drifting dots
needs no scene graph, no material system and no renderer — a 2D context and a
`requestAnimationFrame` loop is a few dozen lines and nothing in the bundle.
**Reach for WebGL only when there is real geometry**, meaning lighting,
depth or a mesh that could not be faked in 2D.

Never Spline: the scene loads from `prod.spline.design`, which puts a
third-party host on the critical path of a page you otherwise serve yourself.
Never vanilla Three.js on a React surface, and never Babylon — one answer per
case is the point.

## Deriving the shape from the page

The form comes from what the product *is*. Read `docs/domain.md` — the core
entities and the one workflow that matters — and abstract from that.

| The product is about | The form that reads as it |
|---|---|
| Movement, delivery, logistics | Directional flow — lines with a current |
| Money, ledgers, records | Layered planes, offset and parallel |
| Learning, community, networks | Connected nodes, edges that pulse |
| Health, wellbeing, care | Soft organic mass, slow breathing scale |
| Data, search, intelligence | A dense field resolving into order |
| Security, infrastructure | Interlocking solids, deliberate and still |

**Abstract, never literal.** A rotating 3D truck is a mascot. Directional flow
that a viewer reads as *movement* without naming it is a hero.

**One form per product, not per page.** Derive it once, record it in
`design/design-system.md` beside the palette, and vary it per page by density,
crop, colour or speed. A different shape on every page is the same drift as a
different palette on every page — and the frozen design rule exists precisely
because a fresh session will otherwise invent a new one.

Colour comes from the frozen tokens. A hero that introduces its own palette has
left the design system.

## The performance budget

A hero sits on the public, indexed surfaces — the ones where Core Web Vitals
are the point and SSR earns its cost. Every rule below exists because the naive
version costs LCP, INP or battery.

- **The canvas is never the LCP element.** The `<h1>` is, and it is real
  server-rendered text. Decoration sits behind, `aria-hidden`, and carries no
  message. A headline that only exists inside a canvas is invisible to search
  engines and to screen readers alike.
- **Mount after hydration.** `next/dynamic(() => import('./Scene'), { ssr: false })`.
  Three in the initial bundle delays interactivity on the page whose whole job
  is a first impression.
- **Pause when off-screen.** An `IntersectionObserver` stops the loop once the
  hero scrolls away. Otherwise it renders at 60fps while someone reads the
  footer.
- **Pause when the tab is hidden.** `document.visibilitychange`. A backgrounded
  tab running a WebGL loop is the single most common cause of "this site melts
  my laptop".
- **Clamp device pixel ratio** — `<Canvas dpr={[1, 1.5]}>`. A 3× phone at
  native DPR renders nine times the fragments of a 1× screen for a difference
  nobody can see on a blurred abstract form.
- **Never `setState` on pointer move.** Write the position to a ref and read it
  inside `useFrame` or the rAF loop. A state update per `pointermove` is a
  re-render storm and it shows up directly in INP.
- **Budget the field:** roughly 2,000 particles on desktop, 600 on mobile.
  Measure on a real mid-range phone, not a throttled desktop profile.

## Reduced motion — this one departs from `motion.md`

`motion.md` says reduced motion means *fewer and gentler, never zero*. That
rule is about **feedback**: removing it entirely loses the signal that
something happened.

**Ambient decoration is the exception, and here zero is correct.** Continuous
background movement is exactly what provokes vestibular symptoms, and it
carries no information, so removing it costs the user nothing.

```jsx
const reduce = useReducedMotion();
if (reduce) return <HeroStill />;   // one static frame, or the image treatment
```

Recorded here and in `motion.md` as a deliberate split rather than an
inconsistency: motion that *tells you something* is reduced, motion that is
merely pleasant is removed.

## No pointer — touch and keyboard

Pointer-reactive means nothing on a phone. Gate the binding the way `motion.md`
gates hover:

```js
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
```

Without a fine pointer the field **drifts on its own** — slowly, autonomously.
It never freezes: a still field that was built to move reads as broken, and on
a phone that is most of your traffic.

## Full-screen heroes

Full-screen is a per-page choice, not a default, and the home page is where it
usually earns its place.

- **`min-height: 100svh`, never `100vh`.** On iOS `100vh` is taller than the
  visible viewport, so the CTA lands below the fold on precisely the device
  where that hurts most. `svh` is the small viewport and is stable; `dvh`
  resizes as the URL bar collapses and makes the layout jump mid-scroll.
- **`min-height`, not `height`.** A landscape phone is around 380px tall.
  Headline, sub and CTA overflow a fixed height and get clipped.
- **Give it a scroll affordance** — a peek of the next section, or an indicator.
  A full-bleed hero with a clean bottom edge reads as the entire page, and
  people leave.
- **The fold still matters.** Headline, one line of sub and the primary CTA are
  all visible at 320×568 without scrolling.

## When the treatment is an image

The image becomes the LCP element, so it gets the opposite treatment from the
canvas:

- AVIF with a WebP fallback; `next/image` with `priority` and
  `fetchPriority="high"`
- Explicit dimensions or `fill` plus `sizes` — an unsized hero image is the
  largest CLS source on the page
- Art-direct the crop. A 21:9 desktop hero centre-cropped to 320px wide is
  usually a photograph of somebody's elbow.
- **Text over an image needs a scrim**, not optimism. `contrast.mjs` checks
  tokens against tokens; it cannot sample a photograph. A solid or gradient
  overlay that holds 4.5:1 across the *whole* text box is the only reliable
  answer, and this stays a human check.
- `alt=""` when the image is decoration behind a headline that already carries
  the message. Describing it twice is noise for a screen reader.

## What the gate can and cannot see

`audit-markup.mjs` catches three of these mechanically: `100vh` where `svh` was
meant, `three`/R3F imported statically into a Next.js page or layout, and a
canvas animation with no reduced-motion path.

It cannot see inside a rendered canvas. Contrast, tap targets and dark mode are
all unverifiable for anything drawn in WebGL, so `responsive-check.mjs` passing
says nothing about the scene — only about the box it sits in. Everything the
canvas draws is a human check, which is the main reason the rules above cap
what it is allowed to do.
