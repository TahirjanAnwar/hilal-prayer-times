// In-app update: downloads the current app files from the public GitHub repository and
// restarts into them. Only files that differ are downloaded, and every file is checked
// against the checksum GitHub lists for it before it is used.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'TahirjanAnwar/hilal-prayer-times';
const BRANCH = 'main';
const PAGE = `https://github.com/${REPO}`;
const MAX_FILE = 40 * 1024 * 1024;

// The app files: every .js in the top folder except boot.js, package.json, src/ and assets/.
const wanted = (p) => !p.includes('..') && !p.includes('\\') && !p.startsWith('/') && p !== 'boot.js'
  && (/^[^/]+\.js$/.test(p) || p === 'package.json' || p.startsWith('src/') || p.startsWith('assets/'));

const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

async function get(url, accept) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'HilalPrayerTimes-Updater', Accept: accept || '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

let busy = false;

// Returns { status: 'latest' | 'ready' | 'installer' | 'dev' | 'error', version?, error? }.
// 'ready' means the new files are in place and the app should restart.
async function run(onProgress = () => {}) {
  const shell = global.hilalShell;
  if (!app.isPackaged || !shell) return { status: 'dev' };
  if (busy) return { status: 'error', error: 'busy' };
  busy = true;
  let tmp = null;
  try {
    const commit = (await (await get(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, 'application/vnd.github.sha')).text()).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('unexpected answer from GitHub');
    const tree = await (await get(`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`, 'application/vnd.github+json')).json();
    const files = (tree.tree || []).filter((e) => e.type === 'blob' && wanted(e.path));
    if (tree.truncated || !files.some((e) => e.path === 'main.js') || !files.some((e) => e.path === 'package.json')) throw new Error('incomplete file list');

    const local = (p) => path.join(shell.active, ...p.split('/'));
    const changed = files.filter((e) => {
      try { return gitSha(fs.readFileSync(local(e.path))) !== e.sha; } catch { return true; }
    });
    if (!changed.length) return { status: 'latest' };

    const download = async (e) => {
      if (e.size > MAX_FILE) throw new Error(`${e.path} is too large`);
      const url = `https://raw.githubusercontent.com/${REPO}/${commit}/${e.path.split('/').map(encodeURIComponent).join('/')}`;
      const buf = Buffer.from(await (await get(url)).arrayBuffer());
      if (gitSha(buf) !== e.sha) throw new Error(`${e.path} did not match its checksum`);
      return buf;
    };

    // package.json first: it says whether this update fits the installed program.
    const fetched = new Map();
    const pkgEntry = changed.find((e) => e.path === 'package.json');
    let version = null;
    if (pkgEntry) {
      const buf = await download(pkgEntry);
      const pkg = JSON.parse(buf.toString('utf8'));
      if ((pkg.shell || 1) > shell.version) return { status: 'installer', version: pkg.version };
      version = pkg.version;
      fetched.set('package.json', buf);
    }

    const root = path.join(app.getPath('userData'), 'updates');
    tmp = path.join(root, `${commit}.tmp`);
    fs.rmSync(tmp, { recursive: true, force: true });
    let done = 0;
    onProgress({ done, total: changed.length });
    for (const e of files) {
      const isChanged = changed.includes(e);
      const buf = fetched.get(e.path) || (isChanged ? await download(e) : fs.readFileSync(local(e.path)));
      const dest = path.join(tmp, ...e.path.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      if (isChanged) onProgress({ done: ++done, total: changed.length });
    }

    let final = path.join(root, commit);
    if (path.resolve(final) === path.resolve(shell.active)) final = path.join(root, `${commit}-${Date.now()}`);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
    tmp = null;
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ dir: path.basename(final), commit, tries: 0 }));
    return { status: 'ready', version };
  } catch (e) {
    return { status: 'error', error: e && e.message ? e.message : String(e) };
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left for next time */ } }
    busy = false;
  }
}

// Removes older downloaded copies; called once the app has started properly.
function cleanup() {
  const shell = global.hilalShell;
  if (!app.isPackaged || !shell) return;
  shell.bootOk();
  const root = path.join(app.getPath('userData'), 'updates');
  try {
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      if (name !== 'current.json' && path.resolve(full) !== path.resolve(shell.active)) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch { /* no updates folder yet */ }
}

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { return app.getVersion(); }
}

module.exports = { run, cleanup, version, PAGE };
