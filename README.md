# Hilal Prayer Times

Desktop app for Windows and macOS: the five daily prayers with adhan, a Juma row on Fridays, countdowns, and an AI assistant for Islamic questions. English, Uyghur and Dutch.

## Run and build

```bash
npm install
npm start
```

Windows installer (`dist/Hilal-Prayer-Times-Setup-<version>.exe`):

```bash
npm run dist:win
```

macOS `.dmg`: a Mac is required, so GitHub builds it. Push this folder to a GitHub repository, open the **Actions** tab, run **Build installers**, and download the `.dmg` (and `.exe`) from the finished run. Pushing a tag such as `v1.0.0` starts the same build.

The logo lives in `assets/logo.svg`; after changing it run `npm run icons`.

## How it works

- Prayer times are calculated on the computer with the `adhan` library; no internet is needed once a location is saved.
- Automatic location uses the internet connection (ipwho.is, then ipapi.co) and gives the city, not the street. City search uses Open-Meteo geocoding.
- The app keeps running in the system tray so the adhan can play. Quit from the tray icon menu.
- "Start when the computer starts" registers the installed app with Windows/macOS login items. It is not applied when running with `npm start`.
- The AI assistant calls the Claude API (`claude-opus-5-5`) with the key saved in Settings. The key is encrypted with the operating system's keychain and never leaves the computer except to call the API. No key is included in this repository: each user creates their own at console.anthropic.com and adds it under Settings → AI assistant.

## Unsigned installers

The installers are not code-signed. Windows SmartScreen shows "Windows protected your PC" (choose More info, Run anyway). On macOS, right-click the app and choose Open the first time. Signing needs a paid certificate (Apple Developer Program for macOS, a code-signing certificate for Windows).

## Updates

Settings → Updates → **Update** downloads the current app files from the `main` branch of this repository (`updater.js`), checks each file against the checksum GitHub lists for it, and restarts into them. Only changed files are downloaded. The downloaded copy lives in the user's app-data folder; `boot.js` starts it instead of the installed copy and falls back to the installed copy if it fails to start twice.

The updater replaces the top-level `*.js` files (except `boot.js`), `package.json`, `src/` and `assets/`. A change to `boot.js`, the npm dependencies, the Electron version or `build/keyblock.exe` needs a new installer: raise `"shell"` in package.json and `SHELL` in boot.js, and older installs will say so. If you fork the project, change `REPO` in `updater.js`.

## Family mode (child lock)

Set up in Settings → Family. One computer is the parent's, the others are children's; all use the same parent PIN and the same home network.

- A child's computer (Windows only) shows a full-screen lock from each prayer time for 15 minutes. The keyboard is blocked by `build/keyblock.exe` (source: `scripts/keyblock.cs`, rebuild with `npm run keyblock`). Windows does not let any program block Ctrl+Alt+Del.
- The lock ends when the time is up, when the parent presses Unlock in the Family tab, or when the parent PIN is entered on the lock screen's number pad.
- The parent's Family tab lists the children's computers, sets the lock length and which prayers lock, and shows alerts: app closed unexpectedly, Task Manager opened, wrong PIN five times, unlocked with the PIN.
- On a child's computer, Settings and quitting need the parent PIN, a Windows scheduled task restarts the app within a minute if it is closed, and "Block Task Manager" (administrator password needed) switches Task Manager off for that Windows account.
- Link: each child broadcasts a signed status message over UDP port 47815 every 3 seconds and the parent answers it. Nothing leaves the home network. The parent's computer must allow the app through Windows Firewall.
- Limits: a child who signs in with an administrator account, or who deletes the app's settings folder, can get around the lock; the parent then sees that computer as offline. Give children a standard Windows account.

## Adhan sounds

Fajr always plays `assets/fajr.mp3`. The other prayers play one of `assets/adhan-1.mp3` to `adhan-7.mp3`, chosen in Settings (or your own audio file). The recordings were supplied by the app owner.

## License

The source code is under the MIT license (see LICENSE). The adhan recordings in `assets/*.mp3` are not covered by it.
