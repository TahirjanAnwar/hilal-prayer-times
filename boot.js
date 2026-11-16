// Starts the app. If the in-app updater has downloaded a newer copy of the app files,
// that copy is used; otherwise the copy that came with the installer.
// This file is never replaced by the updater. When it changes, raise SHELL here and
// "shell" in package.json so that older installs ask for the new installer.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const SHELL = 1;
const shell = { version: SHELL, builtIn: __dirname, active: __dirname, bootOk() {} };
global.hilalShell = shell;

// Downloaded app files still use the libraries that came with the installer.
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

const updatesRoot = () => path.join(app.getPath('userData'), 'updates');
const dropUpdates = () => { try { fs.rmSync(updatesRoot(), { recursive: true, force: true }); } catch { /* nothing to remove */ } };

function newer(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function pickUpdate() {
  if (!app.isPackaged) return null; // running from source: always use these files
  const pointer = path.join(updatesRoot(), 'current.json');
  if (!fs.existsSync(pointer)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    const dir = path.join(updatesRoot(), path.basename(String(info.dir)));
    const builtIn = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const update = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const stale = newer(builtIn.version, update.version); // a newer installer was installed since
    const needsNewerShell = (update.shell || 1) > SHELL;
    const keepsFailing = (info.tries || 0) >= 2; // did not start properly twice
    if (stale || needsNewerShell || keepsFailing || !fs.existsSync(path.join(dir, 'main.js'))) { dropUpdates(); return null; }
    info.tries = (info.tries || 0) + 1;
    fs.writeFileSync(pointer, JSON.stringify(info));
    shell.bootOk = () => { info.tries = 0; try { fs.writeFileSync(pointer, JSON.stringify(info)); } catch { /* next start counts again */ } };
    return dir;
  } catch {
    dropUpdates();
    return null;
  }
}

const dir = pickUpdate();
if (dir) {
  shell.active = dir;
  try {
    require(path.join(dir, 'main.js'));
  } catch (e) {
    console.error('Downloaded update could not start, going back to the installed version', e);
    dropUpdates();
    app.relaunch();
    app.exit(0);
  }
} else {
  require('./main.js');
}
