# Web patterns — Phase 3

Vendored from **elite-frontend-ux** §4–7, with the responsive section expanded.
Read this when the work is a dashboard, a landing page, or a Tailwind/React
component. Skip it otherwise.

## Responsive — mobile, tablet, desktop

**Every web surface adapts to all three.** Not "works on mobile" — reads as
though it was designed for whichever screen it is on. A desktop layout
squeezed narrow is not responsive; it is a desktop layout that fits.

Mobile-first: base styles are the mobile case, and each breakpoint layers up.
Writing desktop-first and overriding downward produces the squeezed result
above, because the small screen only ever gets subtraction.

```html
<div class="
  flex flex-col            /* mobile: stack */
  md:flex-row              /* tablet+: side by side */
  gap-4 md:gap-6 lg:gap-8
  p-4 md:p-6 lg:p-8
">
```

| Breakpoint | Width | Design for |
|---|---|---|
| base | <640px | Phone portrait. One column, thumb-reachable actions. |
| `sm` | 640px | Large phone / phone landscape. |
| `md` | 768px | **Tablet portrait.** The one most often skipped. |
| `lg` | 1024px | Tablet landscape / small laptop. Sidebars appear here. |
| `xl` | 1280px | Desktop. |
| `2xl` | 1536px | Wide desktop — cap the measure, do not stretch text. |

**Tablet is a design, not an interpolation.** At `md` a dashboard sidebar
usually collapses to icons rather than disappearing, a two-column form becomes
one, and a data table becomes cards. Jumping straight from mobile stack to
desktop grid leaves 768–1023px looking like a stretched phone — the single most
common responsive failure.

Rules that hold at every width:

- **No horizontal scrolling of content.** Wide things — tables, code blocks,
  diagrams — scroll inside their own `overflow-x-auto` container; the page body
  never does.
- Tap targets stay ≥44×44px at every breakpoint, including desktop.
- Body text never below 16px on mobile — smaller triggers iOS zoom-on-focus.
- Images `max-w-full`; never a fixed pixel width that exceeds a phone.
- Test the extremes: 320px wide, longest plausible content, and empty state.

## Dark mode

Required on every web surface. Driven by the tokens, never by per-component
overrides.

```html
<html class="dark">   <!-- toggle this class -->
```

```css
/* Tailwind reads the tokens; components never name a colour. */
.bg-background { background: hsl(var(--background)); }
```

Because components consume tokens only, dark mode is a token swap and nothing
else. A component with `bg-white` in it is a component that is broken in dark
mode and will not be caught until someone looks.

Honour the system preference on first load, then let an explicit toggle win and
persist. Re-run the contrast gate against the dark block — a palette that
passes in light routinely fails inverted.

## SaaS dashboard patterns

```
┌─────────────────────────────────────────────────┐
│ Top Bar (56-64px): Logo, Search, User Menu      │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │  Main Content Area                   │
│ 240-280px│  (breadcrumbs if deep nav)           │
│ collapsed│                                      │
│ 64-80px  │  Cards / Data / Forms                │
└──────────┴──────────────────────────────────────┘
```

On mobile the sidebar becomes a drawer or a bottom bar — never a permanently
visible 240px column eating half a phone.

| Scenario | Pattern |
|---|---|
| 10+ sections | Collapsible sidebar |
| 3–6 sections | Top navigation |
| Secondary nav | Tabs (max 6) |
| Deep hierarchy | Breadcrumbs |

Content hierarchy:

1. **Value-first metrics** — "You saved 4 hours" beats a raw number
2. **Actionable insights** — what should the user do next?
3. **Progressive disclosure** — summary, then detail on demand
4. **Role-based views** — different personas need different data

Data visualisation: semantic colours (red negative, green positive) **with a
pattern or icon backup for colourblind users**; legends always; axis labels
mandatory; long labels truncated with a tooltip.

Empty states:

```jsx
// GOOD
<EmptyState
  icon={<InboxIcon />}
  title="No messages yet"
  description="When you receive messages, they'll appear here."
  action={<Button>Compose message</Button>}
/>

// BAD
<p>No data</p>
```

Settings: bucket + side panel for complex cases; destructive actions grouped in
a "Danger Zone" at the bottom; destructive confirmations require typing and a
specific button label ("Delete account", not "Yes").

Toasts: 4–5s default, 6s minimum for accessibility, roughly 500ms per word plus
3s base, always dismissible.

## Landing page patterns

Above the fold, within the viewport: a clear headline (5–10 words), a
supporting subheadline, **one** primary CTA, and a visual.

```
1. Hero   2. Social proof   3. Problem/solution   4. Features (3-4 max)
5. Testimonials   6. Pricing   7. FAQ   8. Final CTA   9. Footer
```

CTA buttons: ≥44px high, padding 2× font size, high contrast, action verbs in
the first person ("Get my free trial" beats "Sign up"), 2–5 words, one primary
per viewport.

Social proof placement: logo bar straight after the hero, testimonials near
points of objection, stats near pricing, trust badges near forms.

Pricing: 3–4 tiers maximum, recommended tier highlighted, annual/monthly toggle
showing the saving, checkmarks for scanning, a CTA on every tier. On mobile the
recommended tier goes first, not the cheapest.

Forms: single column (120% fewer errors than multi-column), minimal fields (4
vs 11 converts 120% better), never ask for a phone number unless essential (58%
abandon), labels above inputs, validate on blur rather than while typing.

## Tailwind

The `cn()` helper is required for conditional classes:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Never build class names dynamically** — Tailwind purges what it cannot see as
a literal:

```typescript
// BROKEN
<div className={`bg-${color}-500`} />

// CORRECT
const colorMap = { blue: "bg-blue-500", red: "bg-red-500" };
<div className={colorMap[color]} />
```

Variants via CVA:

```typescript
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        default: "h-10 px-4 py-2",
        lg: "h-11 px-8 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);
```

Note every size clears 44px of touch target once padding is counted — `h-9`
alone does not, so `sm` buttons need surrounding padding on touch surfaces.

## React

Compound components over prop soup:

```tsx
<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
</Tabs>
```

Respect reduced motion:

```tsx
const reduce = useReducedMotion();

// Drop the movement, KEEP the fade. Reduced motion means fewer and gentler
// animations, not zero — an implementation that removes all feedback leaves
// the user with no signal that anything happened, which is its own failure.
<motion.div
  initial={{ opacity: 0, y: reduce ? 0 : 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2 }}
/>
```

Gate hover motion too — touch fires a false hover on tap:

```css
@media (hover: hover) and (pointer: fine) {
  .card:hover { transform: scale(1.02); }
}
```

See `references/motion.md` for durations, easing and the frequency rule that
decides whether an element should animate at all.

Loading states: skeleton screens beat spinners, because a skeleton tells the
user what is about to arrive.

```tsx
<div className="animate-pulse">
  <div className="h-4 bg-muted rounded w-3/4 mb-2" />
  <div className="h-4 bg-muted rounded w-1/2" />
</div>
```
