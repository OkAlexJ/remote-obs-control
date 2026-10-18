# Remote OBS Control — Desktop App

## Run it (development)
```
npm install
npm start
```
This opens the real app in an Electron window on your PC.

## Build the Windows installer (.exe)
Run this **on a Windows PC** (packaging a Windows installer reliably needs a
Windows machine, or Wine on Linux/Mac — that step can't be done from a sandbox):
```
npm install
npm run build:win
```
The installer lands in `dist\Remote OBS Control Setup <version>.exe`. It's a
normal NSIS installer — Next-Next-Finish, with desktop/Start Menu shortcuts.

There's also `npm run build:win-portable` for a single portable .exe that
needs no installation.

## What's actually implemented in this pass

- **Real Electron app**, not a website in a wrapper: separate main/renderer/preload
  processes, `contextIsolation` on, no Node access from the page itself.
- **Window state memory** — size, position, and maximized state persist across
  launches (`main.js`, saved to your Windows user-data folder).
- **Netflix-style profile launcher** on startup — pick a profile, it loads that
  profile's saved data and auto-connects to its linked OBS instance.
- **Profiles** — name, description, emoji avatar, last-used time, linked OBS
  connection. Create / edit / delete from the launcher.
- **Global OBS connections**, reusable across profiles — add once ("Streaming
  PC", "Laptop", etc.), pick which one each profile uses.
- **Encrypted passwords** — OBS WebSocket passwords are encrypted at rest via
  Electron's `safeStorage` (backed by Windows' DPAPI / macOS Keychain / Linux
  keyring), decrypted only in the main process right when a profile connects.
  The renderer never reads or stores the encrypted blob.
- **Per-profile data** — the soundboard (boards, buttons, sound library), the
  audio-activity graph's custom line colors, scene hotkeys, and the activity
  log are all stored per profile, on disk (`store-<profileId>.json` in your
  user-data folder). Switching profiles switches all of this.
- **Toast notifications** — small popups in the corner for connect/disconnect,
  scene changes, and profile switches.
- **Activity log** — a running, timestamped list of what's happened (scene
  changes, source show/hide, sounds played, connect/disconnect), with a Clear
  button. Lives in its own panel below the soundboard.
- **Global search (Ctrl+K)** — a command palette to jump to any scene, toggle
  any source, or play any soundboard button by typing its name.
- **Quick profile switcher (Ctrl+P)** — a small popup to jump straight to
  another profile without going back to the full launcher screen.
- **Scene hotkeys** — click the ⌨ button on any scene tab to bind a key
  combo that goes live on that scene from anywhere in the app. Conflict
  detection against both scene hotkeys and soundboard hotkeys.
- **Audio Activity line colors** — click the small color swatch next to any
  source in the Audio Activity legend to recolor its line; it's saved with
  the profile.
- Everything from before (scene/source control, transforms, soundboard
  playback via the hidden browser-source pool, etc.) still works unchanged.

## Latest polish pass

- New look: gradient backdrop, glow on the active scene, smoother buttons, focus rings, styled scrollbars, pulsing LIVE dot
- **Duplicate** button in the profile editor (copies the soundboard too)
- Esc closes the profile editor; Enter in the name box saves
- Single-instance lock, no white flash on launch, blocked pop-ups/navigation

## Big update

- **5 themes** (Violet, Ocean, Sunset, Forest, Light) — click 🎨 or press Ctrl+Shift+T; remembered next launch
- **Profile export / import** — Export button in the profile editor, Import button on the launcher (OBS password is never put in the file)
- **Keep on top** pin — 📌 or Ctrl+T, handy when OBS or a game is full screen next to it
- **Shortcuts help** — press ? or click the ? button
- Bigger scene thumbnails, rounder stage, cleaner spacing

## What's NOT built yet

Still-large pieces from your original doc, deliberately left for a later pass:

- Macro system (multi-step actions, visual editor, delays/conditions)
- Media library (centralized image/video management beyond soundboard sounds)
- Customizable widget-based dashboard / multiple pages
- First-launch setup wizard
- Multi-OBS *simultaneous* control (one profile = one active connection at a
  time — that's what profile switching covers, but there's no side-by-side
  dual-OBS view)

## Notes / honesty about trade-offs

- The connection **status dot** on each profile card in the launcher reflects
  whether a connection is *linked*, not a live ping — it doesn't open a socket
  just to render the grid.
- If Electron's `safeStorage.isEncryptionAvailable()` is false (rare — some
  Linux setups without a keyring), it falls back to base64 rather than true
  encryption. That's flagged in code (`main.js`) so it's not a silent
  weakening of the security you asked for.
- The soundboard's "playing" pulse animation still uses a timer estimate, not
  a real playback-finished signal — noted before, unchanged.
- The activity log caps at 200 entries per profile (oldest drop off) to keep
  the saved file small.
