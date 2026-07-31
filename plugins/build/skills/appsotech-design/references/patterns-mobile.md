# Flutter patterns — Phase 3

Read this for any Flutter target (`apps/mobile` on the house stack). The design
system is the same one the web surfaces use — same style, same palette, same
type pairing — expressed as `ThemeData` instead of CSS custom properties.

## One palette, two languages

`design/tokens.css` is the master. Flutter cannot read it, so the freeze step
generates the Dart copy from the same values:

```
node "$TOKENSDART" design/tokens.css -o <package>/lib/design/tokens.dart
```

**Never hand-typed alongside the CSS**, and the generator's `--check` mode is
in the gate for exactly that reason: two hand-maintained copies drift, and the
drift shows up as an app that is subtly a different product from its own
website. It lands inside `lib/` because Dart resolves library code relative to
the package, so a file at the repository root cannot be imported here.

`.dark` normally lists only the tokens it *overrides* — that is what the
cascade is for — so the generator layers dark onto light rather than emitting
dark's own keys alone. A generator that did the latter would leave holes where
the CSS has none.

```dart
// <package>/lib/design/tokens.dart — generated. Do not edit by hand.
import 'package:flutter/material.dart';

class AppColors {
  // Light
  static const background = Color(0xFFFFFFFF);
  static const foreground = Color(0xFF0F172A);
  static const primary = Color(0xFF0F172A);
  static const primaryForeground = Color(0xFFF8FAFC);
  static const muted = Color(0xFFF1F5F9);
  static const mutedForeground = Color(0xFF64748B);
  static const border = Color(0xFFE2E8F0);
  static const destructive = Color(0xFFDC2626);

  // Dark
  static const backgroundDark = Color(0xFF020617);
  static const foregroundDark = Color(0xFFF8FAFC);
  static const primaryDark = Color(0xFFF8FAFC);
  static const primaryForegroundDark = Color(0xFF0F172A);
  static const mutedDark = Color(0xFF1E293B);
  static const mutedForegroundDark = Color(0xFF94A3B8);
  static const borderDark = Color(0xFF1E293B);
  static const destructiveDark = Color(0xFFF87171);
}
```

HSL triplets convert to `Color(0xAARRGGBB)`; keep the alpha byte at `FF` unless
the token genuinely carries opacity.

## Light and dark are both required

Not an enhancement. Ship both, and let the system choose:

```dart
MaterialApp(
  theme: appTheme(Brightness.light),
  darkTheme: appTheme(Brightness.dark),
  // Follows the OS setting. Override only from an explicit in-app toggle,
  // and persist that choice — a toggle that resets on relaunch reads as a bug.
  themeMode: ThemeMode.system,
);
```

```dart
ThemeData appTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;

  final scheme = ColorScheme(
    brightness: brightness,
    primary: dark ? AppColors.primaryDark : AppColors.primary,
    onPrimary: dark ? AppColors.primaryForegroundDark : AppColors.primaryForeground,
    surface: dark ? AppColors.backgroundDark : AppColors.background,
    onSurface: dark ? AppColors.foregroundDark : AppColors.foreground,
    error: dark ? AppColors.destructiveDark : AppColors.destructive,
    onError: dark ? AppColors.foregroundDark : AppColors.background,
    secondary: dark ? AppColors.mutedDark : AppColors.muted,
    onSecondary: dark ? AppColors.mutedForegroundDark : AppColors.mutedForeground,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    textTheme: _textTheme(scheme),
    // 48dp is the Material floor and the one Flutter will not enforce for you
    // inside a custom GestureDetector.
    materialTapTargetSize: MaterialTapTargetSize.padded,
  );
}
```

**Never branch on brightness inside a widget.** `Theme.of(context).colorScheme`
is the only source — a widget that reads
`MediaQuery.platformBrightnessOf(context)` to pick its own colour ignores an
in-app toggle and is wrong exactly when the user has overridden the system.

The dark palette is not the light one inverted. Pure black backgrounds with
pure white text are harsh on OLED; the token file's dark block is a designed
palette, and it passes the same 4.5:1 gate.

## Type

Same pairing as the web surfaces. Load the fonts through `google_fonts` or
bundle them; do not substitute a system face and call it close enough.

```dart
TextTheme _textTheme(ColorScheme scheme) => TextTheme(
  displayLarge: GoogleFonts.spaceGrotesk(fontSize: 56, height: 1.1, color: scheme.onSurface),
  headlineLarge: GoogleFonts.spaceGrotesk(fontSize: 32, height: 1.2, color: scheme.onSurface),
  titleLarge: GoogleFonts.spaceGrotesk(fontSize: 20, height: 1.3, color: scheme.onSurface),
  bodyLarge: GoogleFonts.workSans(fontSize: 16, height: 1.5, color: scheme.onSurface),
  bodyMedium: GoogleFonts.workSans(fontSize: 14, height: 1.5, color: scheme.onSurface),
  labelSmall: GoogleFonts.workSans(fontSize: 12, height: 1.4, color: scheme.onSurface),
);
```

**16px is the body floor**, matching the web scale. Do not use `textScaleFactor`
to compensate for a small base — the user's own accessibility text scaling
multiplies whatever you set, so a small base becomes unreadable for them and
merely cramped for everyone else.

Never hardcode a `fontSize` in a widget. Use `Theme.of(context).textTheme`.

## Responsive on mobile too

A phone app still meets a tablet, a foldable, and a phone in landscape.

```dart
Widget build(BuildContext context) {
  return LayoutBuilder(
    builder: (context, constraints) {
      if (constraints.maxWidth >= 900) return _TabletLayout();   // tablet / foldable open
      if (constraints.maxWidth >= 600) return _WideLayout();     // large phone, landscape
      return _PhoneLayout();
    },
  );
}
```

Use `LayoutBuilder` constraints, not `MediaQuery.sizeOf(context)`, for anything
inside a layout — `MediaQuery` reports the *window*, so a widget in a split-view
pane or a side sheet sizes itself for space it does not have.

- Respect `SafeArea` — notches and gesture bars are not padding you may reuse.
- 48×48dp minimum tap target, with 8dp between adjacent targets.
- Nothing critical in the bottom-left/right corners on a large phone: that is
  outside comfortable thumb reach.
- Test at 320dp wide, in landscape, and at the largest OS text scale.

## Motion

The same rule as the web: animate transform and opacity, never layout.

Honour the OS reduce-motion setting:

```dart
final reduceMotion = MediaQuery.of(context).disableAnimations;

// Keep the fade, drop the movement. Reduced motion means fewer and gentler
// animations, not none — zeroing every duration removes the feedback that
// tells the user their tap registered.
AnimatedOpacity(
  duration: const Duration(milliseconds: 200),
  opacity: visible ? 1 : 0,
  child: AnimatedSlide(
    duration: const Duration(milliseconds: 200),
    offset: reduceMotion ? Offset.zero : slideFrom,
    child: child,
  ),
);
```

`disableAnimations` is the Flutter equivalent of `prefers-reduced-motion`, and
it is set by a real accessibility preference — ignoring it can cause actual
nausea, not just annoyance.

## States

Every screen that loads has four states, and all four ship:

| State | What it shows |
|---|---|
| Loading | A skeleton shaped like the content, not a bare spinner |
| Empty | What this is, and the action that fills it |
| Error | What failed and what to do — never a raw exception |
| Loaded | The content |

Offline is a real state on mobile. If a screen must work offline, say so in
`docs/domain.md` and show queued writes as pending rather than as saved.
