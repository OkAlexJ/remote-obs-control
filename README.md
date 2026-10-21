# Remote OBS Control — Desktop App

Control OBS on another PC (over your LAN or Tailscale) through obs-websocket v5: scenes, sources,
audio, streaming/recording, a soundboard and macros — with per-person profiles.

## Run it
```
npm install
npm start
```

### Try it without OBS
A fake OBS ships with the project, so you can click around without a second PC:
```
npm run mock-obs
```
Then connect to host `localhost`, port `4456`, password `test` (port 4456 so it never clashes with a real OBS on 4455).

## Build the Windows installer
```
npm run build:win            # dist\Remote OBS Control Setup <version>.exe
npm run build:win-portable   # single portable .exe
```

## Make it yours (⚙ Settings, or Ctrl+,)
- **Layout** — switch any panel on/off, or pick a preset: *Essentials* (default), *Button deck* (big buttons, no editor) or *Everything*. Saved per profile. Click any panel title to collapse it.
- **Look** — theme, your own accent color, compact or comfortable density, soundboard/macro button size.
- **Behavior** — auto-connect, stream start/stop confirmation, scene thumbnails, pop-up notifications, keep on top, preview refresh rate.
- Once connected, the address fields fold away (✎ to change them).

## Features

**Connection**
- Profiles launcher (Netflix-style) — each profile has its own soundboard, macros, hotkeys, graph settings,
  Twitch settings and activity log. Number keys 1–9 open a profile.
- Saved OBS connections with **Test connection**, editable host/port/password, and passwords
  encrypted with the OS keychain (Electron `safeStorage`).
- **Auto-reconnect** with back-off if the link drops; clear messages for wrong password / unreachable host.
- 💾 button saves whatever you typed in the top bar back into the profile.

**Live control**
- **Go Live / Record / Pause / Replay buffer (+ Save clip) / Virtual cam** with running timers.
- Live **stats**: FPS, CPU, RAM, dropped frames, stream bitrate (turns yellow/red on congestion).
- **Studio mode**: preview vs. live badges, Transition button, transition type + duration.
- Scenes: thumbnails, double-click to go live, right-click to rename/delete, ＋ Scene, per-scene hotkeys.
- **Everything syncs both ways** — changes made directly in OBS (scene switches, mutes, volumes,
  source visibility, moved sources, new/removed sources) show up immediately.

**Layout editor**
- Drag sources, resize with 8 handles (Shift = keep aspect, Ctrl = from center), **snapping** to edges/centre
  (hold Alt to disable), arrow-key nudging, Delete to remove, Ctrl+scroll to zoom.
- Correct for OBS alignment, bounding boxes and **rotation**.
- Drag-and-drop **layer reordering**, right-click menu (bring to front, fit, center…).
- Properties: scale/position/rotation, Fit / Center / Reset, **filters on/off**, media playback + scrub, source settings.
- Add existing sources, browser/image/text/**color** sources, or upload an HTML/image file from this PC.
- 📸 Save a full-resolution screenshot of a scene.

**Audio**
- Mixer with **dB faders** (double-click = 0 dB), meters with peak hold, mute.
- Activity graph (line/area/bars/dots), crisp on high-DPI screens; selection and colours saved per profile.

**Soundboard**
- Multiple boards, drag to reorder, drag a tile onto another board's tab to move it, right-click menu.
- Upload / URL / reuse sounds; preview locally; loop / restart-instead-of-stack; hotkeys.
- Real sound lengths are measured, so the "playing" glow lasts the right time; click a looping sound to stop it.

**⚡ Macros (new)**
- Chain steps: go live on scene, preview, transition, show/hide/toggle source, mute/unmute/toggle,
  set volume, change a text source, play a sound, stop sounds, wait, start/stop stream, record
  (start/stop/pause/resume), save replay, virtual cam. Hotkeys, test-run, duplicate.

**✨ Bald filter**
- *Add a source → Bald filter*: AI hair detection removes the hair, fills the background back in and draws a shaded scalp textured with your own forehead skin, following your head (~45–50 fps).
- Placed over the webcam automatically; toggle it with 👁. The app serves the filter itself (127.0.0.1:47821), so keep it open while using it.
  - **OBS on this PC** (connect to `localhost`): works out of the box.
  - **OBS on another PC**: goes through Tailscale, privately. Run once on the PC with this app: `tailscale serve --bg http://127.0.0.1:47821` (needs HTTPS certificates enabled for your tailnet). The other PC must be on the same tailnet. Undo with `tailscale serve --https=443 off`.
- OBS must be started with `--enable-media-stream` so browser sources may use the camera. First start downloads the face/hair models (needs internet).
- Try it on a photo: open `renderer/filters/bald-filter.html#{"test":"<image url>"}` from a local server.

**📱 Fake iPhone notifications**
- iOS-style banner that slides down on the live scene with a chime (synthesized, toggleable), light or dark.
- 10 one-click presets (Mom, card declined, Screen Time, AirTag…) or write your own sender + message; also a macro step.
- Uses one "Fake Notification" browser source, created on top of the live scene the first time.

**🗣️ Text to speech**
- Type anything and it's said on stream with Windows' built-in voices (David, Zira). 🎧 previews it just for you first.
- **ASMR whisper** style: breathy close-mic whisper, slower, warm, drifting ear to ear, with a little room.
- Plays through a hidden "Text to Speech" source set to *Monitor and Output*, so it's on the stream **and** the streamer hears it through OBS monitoring.
- Also a macro step.

**Everywhere**
- **Ctrl+K** command palette (scenes, sources, mutes, sounds, macros, stream/record actions…).
- **Ctrl+P** profile switcher, **Ctrl+,** settings, **Ctrl+Shift+T** next theme, **Ctrl+T** keep on top, **?** help.
- Twitch: open the stream and chat in their own windows; optional live viewer count/title/uptime
  (token stored encrypted, requests made from the main process).

## Notes / trade-offs
- If `safeStorage` isn't available (rare, some Linux setups) secrets fall back to base64 and are marked `b64:` in the file.
- Soundboard sounds play through hidden 8×8 browser sources ("Soundboard Player N") in the live scene; they're hidden
  from the app's sources list and mixer. Keep sound files under 10 MB — each play sends the file to OBS.
- The audio graph shows volume over time, not a frequency spectrum (obs-websocket doesn't expose FFT data).
- For testing, `ROC_USER_DATA=<folder>` makes the app use a throwaway data folder.

## Project layout
```
main.js            Electron main process (storage, encryption, dialogs, Twitch windows)
preload.js         The only bridge the page gets (window.desktop)
renderer/
  index.html       Markup
  styles.css       Themes + styles
  js/util.js       Helpers, dialogs, context menu, toasts, per-profile storage, activity log
  js/obs.js        obs-websocket connection, requests, events, auto-reconnect
  js/hotkeys.js    Hotkey recording/conflicts + the single keyboard handler
  js/scenes.js     Scenes, studio mode, transitions
  js/stage.js      Layout editor, sources list, properties panel, adding sources
  js/audio.js      Mixer, meters, activity graph
  js/outputs.js    Stream / record / replay / virtual cam + stats
  js/soundboard.js Soundboard
  js/macros.js     Macros
  js/twitch.js     Twitch
  js/settings.js   Settings: panel layout/presets, theme, accent, density, behavior
  js/palette.js    Command palette, profile switcher, help
  js/profiles.js   Profile launcher + editor
  js/main.js       Startup and connect/disconnect wiring
tools/mock-obs.js  Fake OBS for development
```
