# The Flutter app

`apps/mobile/`. Flutter 3.5, dio, riverpod, go_router, flutter_secure_storage.

## What is different about mobile

**There is no same-origin trick.** Every web surface calls `/v1` relative
because the gateway puts the API on the same origin. A packaged app has no
origin, so it needs an absolute base URL — and that URL cannot be baked in at
build time, because a build goes to a store and lives for months across
environments.

Pass it at launch:

```dart
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:8080/v1',
);
```

```bash
flutter run --dart-define=API_BASE_URL=https://stmarys.primary.akadesk.com/v1
```

**The organisation is chosen, not derived.** A web surface learns its tenant
from the hostname. The app has to ask: the learner picks or enters their
organisation, the app resolves it once and stores the resulting host. Every
request after that goes to that host.

**Tokens go in the keychain.** `flutter_secure_storage`, never
`SharedPreferences` — the latter is plain text on disk and readable on a rooted
or jailbroken device.

## Layout

```
lib/
├── main.dart
├── router.dart          # go_router, one place every route is declared
├── models/              # mirrors the Go structs
├── services/            # dio clients, one per feature
├── providers/           # riverpod
├── screens/
└── widgets/
```

`services/` mirrors the web surfaces' `services/` deliberately — same feature
names, same method names, same shapes. Two clients that disagree about what
`list` means is a bug that only shows up on one platform.

## The API client

Same two envelopes as everywhere else: `{"data": ...}` on success,
`problem+json` on error. Unwrap both in one interceptor so no call site sees
them.

```dart
final dio = Dio(BaseOptions(
  baseUrl: apiBaseUrl,
  connectTimeout: const Duration(seconds: 10),
  receiveTimeout: const Duration(seconds: 30),
));
```

Set both timeouts. Dio's defaults are effectively unbounded, and a request that
never returns on a mobile network is the most common hang there is.

Refresh the token in an interceptor, and make concurrent 401s wait on one
refresh rather than each starting their own — otherwise a screen with four
widgets fires four refreshes and three of them invalidate the winner.

## Offline

Mobile is used where the network is not. Decide per feature — not globally —
whether it must work offline, and say so in `docs/domain.md`.

Where it must: cache reads locally, queue writes, and reconcile on reconnect
with the server as the authority. Do not present a queued write as saved
without also showing it is pending; a parent who sees "saved" and later finds
it was not is the failure this avoids.

## Testing

`flutter test` for widgets and services, `mocktail` for the dio layer. Run
`flutter analyze` before reporting the app as built — it catches the null-safety
and lint failures that a CI build would otherwise find first.
