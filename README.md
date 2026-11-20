# Hilal Prayer Times

Desktop app for Windows and macOS: the five daily prayers with adhan, a Juma row on Fridays, countdowns, and an AI assistant for Islamic questions. Languages (20): English, Uyghur, Arabic, Urdu, Hindi, Indonesian, Turkish, Uzbek, Russian, Dutch, German, French, Spanish, Italian, Portuguese, Norwegian, Swedish, Finnish, Japanese and Korean.

## Download

Windows: get the latest `Hilal-Prayer-Times-Setup-<version>.exe` from the [Releases page](https://github.com/TahirjanAnwar/hilal-prayer-times/releases/latest) and run it. After that, new versions arrive through Settings → Updates inside the app.

macOS: get `Hilal-Prayer-Times-<version>.dmg` from the same page. It runs on macOS 12 (Monterey) and later, on Intel and Apple Silicon. It is built by GitHub Actions and is not notarized, so the first time right-click the app and choose Open.

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

The Mac build is packed with Electron 43 (`-c.electronVersion` in the `dist:mac` script) because Electron 44 and later need macOS 13, and Electron 43 is the last line that runs on macOS 12. Windows uses the Electron version in `devDependencies`. Keep the app code to APIs that Electron 43 has.

The logo lives in `assets/logo.svg`; after changing it run `npm run icons`.

## How it works

- Prayer times are calculated on the computer with the `adhan` library; no internet is needed once a location is saved.
- Automatic location uses the internet connection (ipwho.is, then ipapi.co) and gives the city, not the street. City search uses Open-Meteo geocoding.
- The app keeps running in the system tray so the adhan can play. Quit from the tray icon menu.
- "Start when the computer starts" registers the installed app with Windows/macOS login items. It is not applied when running with `npm start`.
- The AI assistant calls the Claude API (`claude-opus-5-5`) with the key saved in Settings. The key is encrypted with the operating system's keychain and never leaves the computer except to call the API. No key is included in this repository: each user creates their own at console.anthropic.com and adds it under Settings → AI assistant.

## Unsigned installers

The installers are not code-signed. Windows SmartScreen shows "Windows protected your PC" (choose More info, Run anyway). On macOS, right-click the app and choose Open the first time. Signing needs a paid certificate (Apple Developer Program for macOS, a code-signing certificate for Windows).

## Desktop widget

A small window on the desktop shows the next prayer and a countdown (`src/widget.html`). It can be dragged anywhere and remembers its place. It has no close button and refuses Alt+F4; it is switched off under Settings → General, which on a child's computer needs the parent PIN. By default it sits on the desktop behind other windows; "Keep the widget above other windows" changes that.

### Hadith and dua on the widget

Below the countdown the widget shows a hadith and a short dua (`src/wisdom.js`), changing once a day or every 1, 3, 6 or 12 hours (Settings → General).

- Hadiths: only from Sahih al-Bukhari and Sahih Muslim, given as the meaning in simple words, with the collection named. On a child's computer only the ones marked for children are shown (parents, helping at home, manners).
- Duas: verses of the Quran, with the Arabic text and the verse number.
- The translations were written for this app and have not been reviewed by a scholar. Corrections are welcome.
- The glass look is a see-through grey tint; Windows 10 cannot blur what is behind a window.

## Updates

Settings → Updates → **Update** downloads the current app files from the `main` branch of this repository (`updater.js`), checks each file against the checksum GitHub lists for it, and restarts into them. Only changed files are downloaded. The downloaded copy lives in the user's app-data folder; `boot.js` starts it instead of the installed copy and falls back to the installed copy if it fails to start twice.

The updater replaces the top-level `*.js` files (except `boot.js`), `package.json`, `src/` and `assets/`. A change to `boot.js`, the npm dependencies, the Electron version or `build/keyblock.exe` needs a new installer: raise `"shell"` in package.json and `SHELL` in boot.js, and older installs will say so. If you fork the project, change `REPO` in `updater.js`.

From version 1.7.0 the app also looks for a new version by itself, half a minute after it starts, then every half hour, and when its window is opened. When there is one, the main window comes up with a message and a short sound: **Update now** or **Later** (asks again after a day). On a child's computer the update needs the parent PIN. It can be switched off in Settings → Updates.

## Colours and Ramadan counter

The round button at the top switches between Automatic (Day from sunrise until Maghrib, Night after it), Day, Night, Relaxed (warm, low-contrast colours), Dark Glass and Light Glass; Settings also offers "Same as the computer". Under the countdown the app shows the days until Ramadan, or the day of Ramadan and the days left. The Islamic dates are calculated (Umm al-Qura calendar) and can differ by a day from a local moon sighting; Settings → Calculation has a correction of up to two days.

In the two glass looks the main window is see-through: the desktop shows behind it, and Settings → General → **Glass transparency** (0–100%) sets how much. That window has no system title bar (the header has its own minimise and close buttons and moves the window) and cannot be resized. The desktop behind it is not blurred.

The dua on the widget has a play button: it plays the verse from Quran.com (recited by Mishari Rashid al-Afasy, streamed from verses.quran.com, so it needs internet) and lights up each word as it is recited, in the Arabic text and in a line that spells the dua in English letters. A speed button beside it switches between 0.5×, 0.75×, 1× and 1.25×; the choice is remembered. The word timings come from the Quran.com API and are stored in `src/wisdom.js`.

## Weather

Next to the city name, and on the widget, the app shows the temperature and a weather icon for the chosen place. The reading comes from [Open-Meteo](https://open-meteo.com) (no account needed) and is refreshed every 15 minutes; only the coordinates of the place, rounded to about a kilometre, are sent. Settings → General has the unit (Automatic, °C, °F) and can switch it off.

## Family mode (child lock)

Set up in Settings → Family. One computer is the parent's, the others are children's; all use the same parent PIN and the same home network.

- A child's computer (Windows only) shows a full-screen lock from each prayer time for 15 minutes. The keyboard is blocked by `build/keyblock.exe` (source: `scripts/keyblock.cs`, rebuild with `npm run keyblock`). Windows does not let any program block Ctrl+Alt+Del.
- The lock ends when the time is up, when the parent presses Unlock in the Family tab, or when the parent PIN is entered on the lock screen's number pad.
- The parent's Family tab lists the children's computers, sets the lock length and which prayers lock, and shows alerts: app closed unexpectedly, Task Manager opened, wrong PIN five times, unlocked with the PIN.
- On a child's computer, Settings and quitting need the parent PIN, a Windows scheduled task restarts the app within a minute if it is closed, and "Block Task Manager" (administrator password needed) switches Task Manager off for that Windows account.
- Link: each child broadcasts a signed status message over UDP port 47815 every 3 seconds and the parent answers it. Nothing leaves the home network. The parent's computer must allow the app through Windows Firewall.
- Limits: a child who signs in with an administrator account, or who deletes the app's settings folder, can get around the lock; the parent then sees that computer as offline. Give children a standard Windows account.

## Reward score

Part of family mode, meant to encourage children to pray.

- 15 minutes before each prayer that locks, a child's computer shows a reminder ("Allah's reward is waiting for you").
- Each prayer lock creates a record. The parent answers "Prayed" or "Not prayed" in the Family tab; the app cannot see whether a child prayed. "+ Prayer" adds one that was prayed while the computer was off.
- A confirmed prayer adds 10 to that child's score. The number comes from Quran 6:160 (a good deed is rewarded with ten like it) and is shown as "at least 10 hasanat"; the app does not claim to know the full reward. No text gives a fixed total for one prayer.
- The scoreboard (Family tab, also visible on the children's computers) shows this week's score and the total. The weekly score starts again every Monday and last week's winner is shown; the total never goes down.

## Adhan sounds

Fajr always plays `assets/fajr.mp3`. The other prayers play one of `assets/adhan-1.mp3` to `adhan-7.mp3`, chosen in Settings (or your own audio file). The recordings were supplied by the app owner.

## License

The source code is under the MIT license (see LICENSE). The adhan recordings in `assets/*.mp3` are not covered by it.

## Quran

The Quran tab lists the 114 surahs. Opening one shows the Arabic text with a translation in the app's language under each verse, and plays the recitation of Mishari Rashid al-Afasy while each word lights up as it is recited. Click a word or a verse to recite from there; the bar at the bottom has previous and next verse, a speed button (0.5× to 1.25×) and a button that repeats the current verse. The app remembers where you stopped and offers to continue from the Prayer times page.

The text, the translations and the word timings come from [Quran.com](https://quran.com) and are kept on the computer after a surah has been read once; the audio is streamed, so listening needs an internet connection.

## Islamic days

Clicking the Ramadan line under the countdown opens a list of the coming days of the Islamic year with the days left and the date. The dates are calculated with the Umm al-Qura calendar (see `src/hijri.js`) and follow the Hijri date adjustment in Settings; the real day depends on the moon sighting and can differ by a day.
