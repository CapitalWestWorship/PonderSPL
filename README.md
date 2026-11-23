# Ponder SPL — Acoustic & Sound Pressure Analyzer

**Ponder SPL** *(v2.1.1)* is a standalone acoustic measurement app for macOS. It ships as a single universal `.app` that runs natively on both **Apple Silicon** and **Intel** Macs, with no external dependencies.

The name comes from the Latin *pondera*, "to weigh": the app weighs sound. It implements the IEC 61672-1 frequency weightings (L<sub>A</sub>, L<sub>C</sub>, L<sub>Z</sub>), and adds tools for live sound mixing (FOH): C − A bass monitoring, a time window you can set for each tile, and scheduled logging.

---

## Features

1. **Breakout HUD window**
   - A separate window you can park on an external monitor above the mixing console.
   - **Always on Top** pin: float over other apps, or behave as a normal window.
   - 1–6 modular tiles, each with its own metric and time window.
2. **Modular hero tiles with independent time windows**
   - Any metric (L<sub>A</sub>, L<sub>C</sub>, L<sub>Z</sub>, C − A, L<sub>Cpk</sub>) with any speed or Leq window: **Slow, Fast, 1s, 5s, 10s, 30s, 1m, 5m, 10m, 15m, Total**.
3. **Scheduled logging**
   - Unattended sessions (e.g. *"Sunday Morning Service"*, *"Friday Youth Night"*, *"Overnight Noise Compliance"*).
   - Recurrence: **Weekly** (select days), **One-off** (specific date) or **Daily**.
   - Log files are named by event and time, and start and stop on their own.
4. **3-second logging rate**: covers a full service at roughly 250 KB per 3-hour run.
5. **Log format toggle**
   - **CSV (`.csv`)**: opens directly in Excel, Numbers or Google Sheets.
   - **Text (`.txt`)**: Smaart-style tab-delimited, with a session metadata header.
6. **Optional sleep prevention**: keeps the Mac awake (`IOPMAssertion`) *only* while a log is recording.
7. **Mic calibration**: load a calibration file (see `sample_calibration/` for a UMIK-1 example).

---

## Installing

1. Open `PonderSPL_v2.1.1.dmg`.
2. Drag **PonderSPL** onto the **Applications** shortcut.
3. The first time you open it, **right-click the app → Open**. The app is ad-hoc signed rather than notarized, so macOS Gatekeeper warns about it. You can also click **Open Anyway** in System Settings → Privacy & Security.
4. Click **OK** when macOS asks for microphone access.

## Where logs are saved

`~/Documents/Ponder_Logs/`, with files named `Ponder_Log_<event>_<time>.csv` / `.txt`.
Logs from older versions in `~/Documents/Pondera_Logs/` are moved here automatically on first launch.

---

## Building from source

Requires the Xcode Command Line Tools (`xcode-select --install`).

```bash
./scripts/build.sh
```

This compiles arm64 and x86_64 binaries, merges them into a universal binary, assembles and ad-hoc signs `PonderSPL.app`, then packages `PonderSPL_v<version>.dmg`. The version comes from `CFBundleShortVersionString` in `resources/Info.plist`, so bump it there for a new release.

## Project layout

| Path | Contents |
|---|---|
| `src/DSP/` | SPL engine, IEC weighting filters, biquads, mic calibration |
| `src/Audio/` | Core Audio device selection and capture |
| `src/Logging/` | CSV/TXT logger and the event scheduler |
| `src/UI/` | App delegate and the main/HUD window controllers (WebKit hosts) |
| `ui/` | HTML/CSS/JS interface for the main window (`index.html`) and HUD (`hud.html`) |
| `resources/` | `Info.plist` and app icon |
| `scripts/build.sh` | Build + DMG script |
| `archive/` | Earlier builds (ProSPLMeter v1, Pondera SPL v2.0, Ponder SPL v2.1 original DMG) |
