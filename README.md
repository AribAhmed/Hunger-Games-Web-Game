# District Survival — Firebase edition

This game runs on your own Firebase project, so anyone with the link can
play from their own phone/computer — no Claude account needed. As of this
update, game creation and joining are **concurrency-safe**: two or more
people creating or joining games at the same moment can no longer corrupt
each other's game, and the app can no longer get permanently stuck on a
loading screen — it always has a way out.

## What's in this folder

```
firebase.json           Hosting + Database config (tells Firebase CLI what to deploy)
database.rules.json     Realtime Database security rules
.firebaserc              Which Firebase project this folder deploys to
public/
  index.html             The whole game (one file — UI, game engine, everything)
  firebase-config.js      Your project's Firebase config. EDIT THIS ONE FILE.
```

You will only ever need to hand-edit **`public/firebase-config.js`** and
**`.firebaserc`**. Everything else can be deployed as-is.

## 1. Create the Firebase project (one-time, in the browser)

1. Go to https://console.firebase.google.com → **Add project** → follow the
   prompts (Google Analytics is optional, you can skip it).
2. In the left sidebar: **Build → Authentication → Get started →
   Sign-in method** tab → enable **Anonymous**. Save.
3. In the left sidebar: **Build → Realtime Database → Create database** →
   pick a location → start in **locked mode** (the rules file in this folder
   replaces the default rules, so locked mode is fine).
4. In the left sidebar: **Project settings** (gear icon) → **General** tab →
   scroll to **Your apps** → click the **`</>`** (web) icon → register an app
   (any nickname) → **do not** check "Firebase Hosting" in that wizard, you'll
   set that up via the CLI below → copy the `firebaseConfig` object shown.

## 2. Install tools (Windows)

Open **PowerShell** (Start menu → type `PowerShell`).

```powershell
# Node.js is required by the Firebase CLI. Skip if `node -v` already works.
winget install OpenJS.NodeJS.LTS

# Close and reopen PowerShell after installing Node, then:
node -v
npm -v

# Install the Firebase CLI
npm install -g firebase-tools

# Sign in — this opens a browser window
firebase login
```

## 3. Configure this project

1. Open `public/firebase-config.js` in a text editor and replace the
   the Firebase config in `public/firebase-config.js` is already set to the `hunger-games-1f090` web app.
2. Open `.firebaserc` and replace `hunger-games-1f090`
   with your actual Firebase **project ID** (found in Project settings →
   General → "Project ID", not the display name).

## 4. Test it locally (Windows)

From PowerShell, `cd` into this folder (the one with `firebase.json` in it),
then:

```powershell
firebase emulators:start --only hosting
```

This serves `public/` at **http://localhost:5000**. It talks to your **real**
Firebase Authentication and Realtime Database (not a local emulator for
those), so anonymous sign-in and multiplayer sync are fully live even while
testing locally. Press `Ctrl+C` in PowerShell to stop.

Open the browser's DevTools console (F12) while testing — every game
creation, join, sync error, retry, and reset logs a line prefixed with
`[GAME CREATE]`, `[GAME JOIN]`, `[GAME LOAD]`, `[FIREBASE]`, `[CONNECTION]`,
`[RECOVERY]`, or `[BOOT]`, which is the fastest way to see what actually
happened during a test. To silence this in a real deployment, open
`public/index.html`, find `const Log = { on: true, ...`, and change it to
`on: false`.

## 5. Deploy

```powershell
firebase deploy --only hosting,database
```

The terminal prints your live URL, something like
`https://YOUR-PROJECT-ID.web.app`. Share that link — anyone who opens it gets
signed in anonymously and can create or join games, no Claude account or
Google sign-in required.

To ship a later change, just re-run `firebase deploy --only hosting,database`
from this folder. **The `--only database` part matters** — if you ever edit
`database.rules.json`, redeploying without it means your new rules never
actually take effect on the live project.

## How multiplayer works now (concurrency-safe architecture)

- On load, every visitor is silently signed in with **Firebase Anonymous
  Authentication** — a unique UID with no email/password/Google account.
- **Two identifiers per game, not one:**
  - `gameId` — a Firebase **push key** (`db.ref('games').push().key`).
    Firebase generates these itself; they are for all practical purposes
    globally unique and are *never* chosen or guessed by a client. This is
    the actual database storage key: `/games/{gameId}/state`. Because
    nobody ever has to "pick" a gameId, two people creating games at the
    same instant cannot possibly collide on it.
  - `code` — the short 4-letter code players type in to join. A client
    *does* pick this one, so claiming it is done through an atomic Realtime
    Database **transaction** against `/gameCodes/{CODE}`. Exactly one
    caller's transaction can ever win a given code; everyone else's
    transaction aborts (because the code already has a value) and the app
    quietly generates a new code and retries (up to 6 times). The database
    rules also enforce this server-side (see below), so it isn't just
    "client promises to behave."
- **Joining is also a transaction**, against that game's `players` map. The
  transaction (a) checks whether this Firebase UID already holds a live
  slot in the game — if so, it hands back that *same* slot instead of
  creating a second one (this is what stops a refresh/reconnect from
  duplicating a player), and (b) otherwise adds a new player. Because it's
  a real transaction, two people joining at the exact same moment can never
  overwrite each other's slot.
- Every Firebase call (auth, reads, writes, transactions) is wrapped in a
  10–12 second timeout. Nothing can hang forever waiting on the network.
- Every live subscription is tagged with an internal "epoch" number. If you
  leave a game, reset, or start loading a different one, the epoch bumps —
  any callback still in flight from the *old* subscription checks the epoch
  and quietly does nothing instead of overwriting whatever you're looking
  at now. This is what stops a slow-finishing load of Game A from
  clobbering Game B if you backed out and started Game B in the meantime.
- Game state lives at `/games/{gameId}/state`; photo submissions live at
  `/games/{gameId}/photoData/{id}` (kept separate so they don't bloat every
  sync); lightweight bookkeeping (`code`, `createdAt`, `lastActiveAt`) lives
  at `/games/{gameId}/meta`, for future cleanup tooling.
- Every document read from Firebase is validated before it's used. A
  missing or malformed document routes to the same recovery screen as a
  network failure — it never gets handed to the game's renderer, which is
  what used to be able to crash the app outright.
- If Firebase isn't configured yet (placeholder values still in
  `firebase-config.js`) or isn't reachable, the game automatically falls
  back to a single-device local mode instead of breaking, so you can still
  open `public/index.html` directly in a browser to sanity-check it.

## Startup lifecycle (the "Loading Arena…" fix)

Startup is now an explicit state machine instead of one long unguarded
`await` chain:

```
INITIALIZING → (auth)
CONNECTING   → (implicit inside INITIALIZING, kept as a phase name for clarity)
LOADING_GAME → (only if you have a saved session to resume)
READY        → normal app
ERROR        → Retry / Start Fresh, always reachable
RESETTING    → transient, while Start Fresh tears things down
```

Every phase has a hard timeout and every step is wrapped in try/catch. If
anything fails or times out, the app lands on `ERROR` with two buttons —
**Retry** (try the exact same step again) and **Start Fresh** (see below) —
never back on a bare "Loading the arena…" with no way out. If a phase is
taking more than ~6 seconds, the loading screen itself grows a "Cancel and
start fresh" link, so you're never stuck waiting even before the hard
timeout fires. If the game document you're subscribed to is deleted or
becomes corrupted *while you're playing* (not just at boot), the same
`ERROR` screen takes over immediately instead of the app crashing on bad
data.

## "Start Fresh" / "Reset session"

Reachable from: the landing screen ("Having trouble? Reset session"), the
in-game Case File sheet ("Game acting up? Reset session"), and automatically
offered on the `ERROR` screen. It:

1. Invalidates the current epoch (any in-flight Firebase callback becomes a
   no-op, even if it resolves later).
2. Unsubscribes every active Firebase listener.
3. Clears this device's saved session (`localStorage`) — never touches
   anyone else's game.
4. Resets the app's in-memory state and returns to the landing screen.

None of this makes a network call, so it works **even if Firebase is
completely unreachable** — it's pure client-side teardown.

## Files changed

- **`store.js`** — the only file that talks to the backend, and now the
  bulk of this update: `createGame`/`joinGame`/`claimPlayerSlot`/`reconnect`
  (new, transaction-based), `validateGameState` (new), `withTimeout` (new,
  wraps every Firebase call), epoch-guarded `subscribe`/`unsubscribe`,
  connection-status tracking via `.info/connected`, bounded-retry `flush()`
  instead of retrying forever silently, and `resetLocal()` for Start Fresh.
- **`ui_c.js`** — `boot()` replaced by an explicit state machine
  (`runBoot()`/`setBootPhase()`/`onGameInvalid()`/`doStartFresh()`);
  `create.submit`, `join.find`, `join.submit`, `lobby.add` rewritten to use
  the new transactional Store methods, with a double-submit guard
  (`UI.busy`) and user-visible error messages instead of failing silently.
- **`ui_a.js`** — new `UI.boot`/`UI.conn`/`UI.busy` state, the `vBoot()`
  recovery/loading screen, the `connPill()` connection-status indicator, a
  "Reset session" link on the landing screen, and the create-game screen now
  shows a real error message and busy state instead of nothing.
- **`ui_b.js`** — a matching "Reset session" escape hatch added to the
  in-game Case File sheet.
- **`head.html`** — CSS for the connection pill and the loading/error
  screens.
- **`database.rules.json`** — see below.
- Game mechanics, missions, duels, and every other screen are untouched.

## Security rules

```jsonc
{
  "rules": {
    "gameCodes": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('gameId').val() === newData.child('gameId').val())"
      }
    },
    "games": {
      "$gameId": { ".read": "auth != null", ".write": "auth != null" }
    },
    ".read": false,
    ".write": false
  }
}
```

The `gameCodes` rule is the important addition: a code can be **written for
the first time by anyone signed in**, or **re-written with the identical
`gameId` it already has** (safe for retries), but **never overwritten with a
different `gameId`**. That means the "only one client can claim a code" rule
is enforced by Firebase itself, not just trusted client-side transaction
logic — even a modified/malicious client cannot steal an existing code.

`/games/{gameId}` still allows any signed-in (including anonymous) user to
read/write the whole game document, same trade-off as before: there's no
Cloud Functions backend here to validate individual field-level writes, so
"signed in" is the enforcement boundary, not "is one of this game's
players." This keeps the "just share a code" flow simple. If you want
per-player write restrictions later (e.g. a player can only ever write their
own player object, only the host can trigger events), that requires
restructuring how moves are written and/or adding Cloud Functions — happy to
do that as a follow-up if you want it.

## Game cleanup (stale/abandoned games)

Every game now stamps `createdAt` and `lastActiveAt` (Firebase server
timestamps, so they can't be spoofed by a client's clock) at
`/games/{gameId}/meta`. That's the hook for cleanup, but **actually deleting
old games on a schedule requires a Cloud Function** (a `functions/` project
on Firebase's pay-as-you-go "Blaze" plan) — there's no way for a page nobody
has open to run cleanup code on its own. This project doesn't include one,
to avoid pushing you onto a paid plan without asking. If/when you want it,
the pattern is: a scheduled Cloud Function that reads `/games/*/meta`,
and deletes any game where `lastActiveAt` is older than, say, 24 hours. Let
me know if you'd like that added.

## Testing the concurrency fixes

TEST 1–3 and 10 need two or three browser windows open to your **deployed**
(or `firebase emulators:start --only hosting`, which uses your real backend)
URL at once — private/incognito windows are the easiest way to get separate
anonymous identities, since normal tabs of the same browser share one
anonymous sign-in.

| Test | Steps | Expected |
|---|---|---|
| 1–2. Simultaneous create | Open 2–3 windows, load the page in all, click **Create a game** in all at nearly the same moment | Each gets its own working game/code; check the console for `[GAME CREATE]` lines — each shows a different `gameId` |
| 3. Simultaneous join | From two windows, join the **same** code within a second of each other | Both end up as distinct players in the same game; check the host's Players tab shows two real players, not one |
| 4. Refresh during load | Create a game, then hit refresh immediately | You either land back in the game, or see the `ERROR`/loading screen with Retry — never a frozen "Loading the arena…" |
| 5. Invalid code | On the Join screen, type a code that doesn't exist | "No game found with that code." — no hang |
| 6. Disconnect while loading | Load the page, then turn off Wi-Fi before it finishes | The pill shows Offline/Reconnecting, and after ~10–12s the loading screen offers Retry/Start Fresh |
| 7. Disconnect during play | Mid-game, turn Wi-Fi off then back on | Pill shows Offline then Reconnecting then disappears; your next move syncs once back online |
| 8. Switch games mid-load | (Manual/console test) start joining Game A, then immediately click Leave and create Game B | Game A's data never appears once you're in Game B — watch for `[FIREBASE] ignoring snapshot from stale epoch` in the console |
| 9. Corrupt/delete the document | In the Firebase console, delete `/games/{gameId}` for a game you're actively in | The app shows "This game no longer exists." with Retry/Start Fresh, not a crash |
| 10. Rapid-click Create | Click **Create a game** as fast as you can several times in a row | Exactly one game is created; extra clicks are ignored (button says "Creating…") |


## IMPORTANT: Live multiplayer setup

The app no longer silently falls back to local mode when **Live** is selected. Before testing cross-device multiplayer:

1. In Firebase Console, create/select the project.
2. Add a Web App and copy its Firebase SDK config into `public/firebase-config.js`.
3. Enable **Authentication → Sign-in method → Anonymous**.
4. Create a **Realtime Database** in the same project.
5. Deploy `database.rules.json` (or paste those rules into Realtime Database → Rules).
6. Update `.firebaserc` so `projects.default` is your Firebase project ID before using Firebase CLI deployment.
7. Deploy Hosting.

### Expected live flow

Host device: Live → Create game → Firebase writes `/gameCodes/{CODE}` and `/games/{GAME_ID}/state`.

Phone: Join with code → reads `/gameCodes/{CODE}` → reads `/games/{GAME_ID}/state` → claims a player slot → subscribes to realtime updates.

If any Firebase step fails, the UI now reports the specific setup/auth/database problem instead of displaying only “Something went wrong.”
