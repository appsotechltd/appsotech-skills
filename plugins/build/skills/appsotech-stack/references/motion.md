# Motion

Distilled from **emilkowalski/skills** (`review-animations/STANDARDS.md` and
`improve-animations/AUDIT.md`), MIT © Emil Kowalski —
github.com/emilkowalski/skills.

It occupies one row of the precedence table and does not touch the others: no
colour, no type scale, no spacing. On performance it agrees with elite exactly
— `transform` and `opacity` only — and goes deeper everywhere else.

**Token values live in `design-tokens.md`. This file says which to use where,
and everything else about motion.** One table of values, one table of usage;
two timing tables is how a component ends up at 160ms while a token says 150ms.

## First: should it animate at all?

The gate can tell you an animation is built correctly. It cannot tell you it
should exist. Ask this before the rest of the file applies.

| How often the user sees it | Decision |
|---|---|
| 100+ times/day — keyboard shortcuts, command palette toggle | **No animation. Ever.** |
| Tens of times/day — hover, list navigation | Remove, or reduce drastically |
| Occasional — modals, drawers, toasts | Standard animation |
| Rare / first-run — onboarding, celebration | Delight is allowed |

**Never animate a keyboard-initiated action.** It repeats hundreds of times a
day and animation makes it feel slow and disconnected. Raycast's command
palette has no open/close animation, and that is the correct choice, not an
oversight.

Valid reasons for motion: spatial consistency, state indication, explanation,
feedback, preventing a jarring change. *"It looks good"* on a frequently-seen
element is not one. **The strongest fix is often to delete the animation.**

## Duration — which token for what

`design-tokens.md` defines the scale. This is the mapping:

| Element | Token |
|---|---|
| Button press feedback | `--duration-fast` (100ms) |
| Tooltip, small popover | `--duration-fast` → `--duration-normal` |
| Dropdown, select | `--duration-normal` (200ms) |
| Modal, drawer | `--duration-slow` (300ms) |
| Page transition, marketing | `--duration-slower` (500ms) |

**UI motion stays under 300ms.** A 180ms dropdown feels more responsive than a
400ms one. Drawers may reach `--duration-slower` because they travel further,
and that is the only routine exception.

Faster spinners make a load *feel* faster at identical real duration. Tooltips
after the first should skip both delay and animation — that alone makes a
toolbar feel quicker.

## Easing

| Situation | Token |
|---|---|
| Entering **or** exiting | `--ease-out` |
| Moving or morphing on screen | `--ease-in-out` |
| Hover, colour change | `--ease-default` |
| Constant motion — marquee, progress | `linear` |
| Drawers, sheets | `--ease-drawer` |

**Never `ease-in` on UI.** It starts slow, delaying the exact moment the user
is watching. `ease-out` at 200ms *feels* faster than `ease-in` at 200ms.

This departs from elite §2, which assigned `--ease-in` to exiting elements.
Emil's argument wins on the specific claim — an exit that starts slow reads as
lag — so `--ease-out` covers both directions and `--ease-in` is not used. The
token still exists; nothing should reference it.

The browser's built-in curves are too weak for UI. `design-tokens.md` carries
strong custom ones. Find new curves at easing.dev rather than hand-rolling.

## Physicality

- **Never `scale(0)`.** Start at `scale(0.9–0.97)` with `opacity: 0`. Nothing
  in the real world appears out of nothing.
- **Scale popovers from their trigger**, not their centre — set
  `transform-origin` from the trigger position. **Modals are exempt:** they
  appear centred in the viewport, so `transform-origin: center` is right.
- **Press feedback** on anything pressable: `transform: scale(0.97)` on
  `:active` with `--duration-fast`. Keep it in 0.95–0.98.

## Interruptibility

CSS **transitions** can be retargeted mid-flight; **keyframes restart from
zero**. Anything triggered rapidly — toasts arriving, toggles — must use
transitions or it visibly stutters when re-triggered.

```css
.toast { transition: transform var(--duration-slow) var(--ease-out); }
```

`@starting-style` gives entry animation with no JS:

```css
.toast {
  opacity: 1; transform: translateY(0);
  transition: opacity var(--duration-slow) var(--ease-out),
              transform var(--duration-slow) var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(100%); }
}
```

Springs carry velocity through an interruption, so they suit gestures a user
may reverse mid-motion. Apple-style config is easier to reason about:
`{ type: "spring", duration: 0.5, bounce: 0.2 }`. Keep bounce at 0.1–0.3 and
reserve visible bounce for drag-to-dismiss.

## Performance

Everything here agrees with `design-tokens.md`; these are the specifics.

- **Animate `transform` and `opacity` only.** `width`, `height`, `margin`,
  `padding`, `top`, `left` trigger layout **and** paint **and** composite.
- **`transition: all` is always a finding.** It animates properties you did not
  choose, off the GPU.
- **Framer Motion's `x`/`y`/`scale` shorthands are not hardware-accelerated** —
  they run on the main thread and drop frames under load. Use the full string:
  `animate={{ transform: "translateX(100px)" }}`.
- **Do not drive child transforms from a CSS variable on the parent.** It
  recalculates styles for every child. Set `transform` on the element itself.
- CSS beats rAF-based JS under load, because it runs off the main thread. Use
  CSS for predetermined motion, springs/JS for gesture-driven motion.
- Keep transition-time `filter: blur()` under 20px — expensive, especially in
  Safari.

## Reduced motion

**Reduced motion means fewer and gentler animations, not zero.** Keep
transitions that aid comprehension; remove movement and position changes. An
implementation that nukes all feedback is itself a finding — the user loses the
signal that anything happened.

```css
@media (prefers-reduced-motion: reduce) {
  .element { transition: opacity var(--duration-fast) var(--ease-default); }
}
```

```jsx
const reduce = useReducedMotion();
// Drop the movement, keep the fade.
<motion.div
  initial={{ opacity: 0, y: reduce ? 0 : 20 }}
  animate={{ opacity: 1, y: 0 }}
/>
```

Also gate hover motion, because touch fires a false hover on tap:

```css
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); }
}
```

## Gestures

- **Dismiss on velocity, not distance.** `Math.abs(distance) / elapsedMs > 0.11`
  — a flick should be enough without crossing a threshold.
- **Damp at boundaries.** Dragging past a natural edge moves less the further
  it goes. Friction, not an invisible wall.
- **Capture the pointer** once a drag starts, so it survives leaving the bounds.
- **Ignore extra touch points** after a drag begins, or it jumps.

## Stagger

30–80ms between items in a group entrance. Longer feels slow. Stagger is
decorative — **never block interaction while it plays.**

## Cohesion

Match motion to the product's personality: a dashboard stays crisp and fast, a
consumer app can be bouncier. Mismatched personality across components is a
finding, and so are five hand-typed cubic-beziers that almost match — curves
and durations belong in `design/tokens.css` like every other value.

## Debugging when the feel is uncertain

Bump the duration 2–5× and watch: do colours crossfade cleanly, does easing
stop abruptly, is `transform-origin` right, do coordinated properties stay in
sync. Chrome's Animations panel shows timing drift frame by frame. Test
gestures on a real device. Look again the next day — imperfections invisible
while building surface later.
