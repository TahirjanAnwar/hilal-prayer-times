// Family mode: a parent's computer and children's computers on the same home network.
// At prayer time a child's computer shows a full-screen lock; the parent can unlock it
// from the family panel and gets an alert when the app on a child's computer is closed.
//
// Link: each child broadcasts a small signed status message every few seconds; the parent
// answers it with settings and commands. Messages are signed with a key made from the
// shared parent PIN, so only computers that know the PIN can talk to each other.
const { app, BrowserWindow, Notification, screen, safeStorage } = require('electron');
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = 47815;
const LINK_SALT = 'hilal-family-link-v1';
const LOCK_IDS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'juma'];
const ONLINE_MS = 12000;
const ADMIN_MS = 10 * 60000;
const WATCH_TASK = 'Hilal Prayer Times Watch';
const TM_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
const IS_WIN = process.platform === 'win32';

const defaultCfg = () => ({ rev: 0, lockMinutes: 15, lockFor: Object.fromEntries(LOCK_IDS.map((id) => [id, true])) });
const fresh = () => ({
  role: 'none', // 'none' | 'parent' | 'child'
  deviceId: crypto.randomBytes(8).toString('hex'),
  key: null, // hex, made from the PIN
  cfg: defaultCfg(),
  children: {}, // parent: id -> { name, lastSeen }
  alerts: [], // parent: { id, ts, childId, name, type }
  events: [], // child: not yet delivered to the parent
  lockUntil: 0,
  lockPrayer: null,
  lockKey: null,
  clearedKey: null, // the prayer lock that already ended or was unlocked
});

let ctx = null; // { settings(), save(), strings(), iconPath(), preload, changed() }
let fam = fresh();
let adminUntil = 0;
let pinFails = 0;
let pinBlockedUntil = 0;

let sock = null;
let beatTimer = null;
let linkError = null;
const liveKids = new Map(); // parent: id -> { addr, port, seq, lastSeen, locked, left, prayer }
const pending = new Map(); // parent: id -> command waiting for that child
let nonces = [];
let lastParentSeen = 0;
let lastParentAddr = null;

let lockWins = [];
let guardTimer = null;
let blocker = null;
let aliveTimer = null;
let tmTimer = null;
let tmOpen = false;
let taskMgrOff = false;

const softLock = () => !app.isPackaged && !!process.env.HILAL_SOFT_LOCK; // small test window instead of full screen
const isLocked = () => fam.lockUntil > Date.now();
const isAdmin = () => adminUntil > Date.now();
const deriveKey = (pin) => crypto.scryptSync(String(pin), LINK_SALT, 32).toString('hex');

// ---------- storage (kept encrypted inside settings.json) ----------
function load() {
  const box = ctx.settings().familyEnc;
  fam = fresh();
  if (!box) return;
  try {
    const buf = Buffer.from(box.data, 'base64');
    const raw = JSON.parse(box.enc ? safeStorage.decryptString(buf) : buf.toString('utf8'));
    fam = { ...fam, ...raw, cfg: sanitizeCfg(raw.cfg) || defaultCfg() };
  } catch { /* unreadable: start without family mode */ }
}

function persist() {
  const text = JSON.stringify(fam);
  ctx.settings().familyEnc = safeStorage.isEncryptionAvailable()
    ? { enc: true, data: safeStorage.encryptString(text).toString('base64') }
    : { enc: false, data: Buffer.from(text, 'utf8').toString('base64') };
  ctx.save();
}

function sanitizeCfg(c) {
  if (!c || typeof c !== 'object') return null;
  const out = defaultCfg();
  out.rev = Number.isFinite(c.rev) ? c.rev : 0;
  if (Number.isFinite(c.lockMinutes)) out.lockMinutes = Math.min(120, Math.max(1, Math.round(c.lockMinutes)));
  for (const id of LOCK_IDS) if (c.lockFor && typeof c.lockFor[id] === 'boolean') out.lockFor[id] = c.lockFor[id];
  return out;
}

// ---------- what the window sees ----------
function view() {
  const now = Date.now();
  return {
    role: fam.role,
    isWin: IS_WIN,
    adminOk: isAdmin(),
    name: os.hostname(),
    cfg: fam.cfg,
    children: Object.entries(fam.children).map(([id, c]) => {
      const live = liveKids.get(id);
      const online = !!live && now - live.lastSeen < ONLINE_MS;
      return {
        id, name: c.name, online, lastSeen: live ? live.lastSeen : c.lastSeen,
        locked: online && live.locked,
        left: online && live.locked ? Math.max(0, live.left - (now - live.lastSeen)) : 0,
        prayer: online ? live.prayer : null,
        unlocking: pending.has(id),
      };
    }),
    alerts: fam.alerts,
    locked: isLocked(),
    parentSeen: now - lastParentSeen < ONLINE_MS + 3000,
    taskMgrOff,
    linkError,
  };
}

const changed = () => ctx.changed(view());

// ---------- PIN ----------
function pinMatches(pin) {
  if (!fam.key || typeof pin !== 'string') return false;
  const a = Buffer.from(deriveKey(pin), 'hex');
  const b = Buffer.from(fam.key, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns { ok, wait } where wait is the number of seconds until the next try is allowed.
function tryPin(pin) {
  const now = Date.now();
  if (now < pinBlockedUntil) return { ok: false, wait: Math.ceil((pinBlockedUntil - now) / 1000) };
  if (pinMatches(pin)) { pinFails = 0; return { ok: true, wait: 0 }; }
  pinFails += 1;
  if (pinFails >= 5) {
    pinFails = 0;
    pinBlockedUntil = now + 60000;
    if (fam.role === 'child') addEvent('pinfail');
    return { ok: false, wait: 60 };
  }
  return { ok: false, wait: 0 };
}

function auth(pin) {
  const r = tryPin(pin);
  if (r.ok) adminUntil = Date.now() + ADMIN_MS;
  changed();
  return r;
}

function lockAdmin() {
  if (!adminUntil) return;
  adminUntil = 0;
  changed();
}

// ---------- signed messages ----------
function seal(obj) {
  const p = JSON.stringify(obj);
  const m = crypto.createHmac('sha256', Buffer.from(fam.key, 'hex')).update(p).digest('hex');
  return Buffer.from(JSON.stringify({ p, m }));
}

function unseal(buf) {
  try {
    if (!fam.key || buf.length > 16000) return null;
    const { p, m } = JSON.parse(buf.toString('utf8'));
    if (typeof p !== 'string' || typeof m !== 'string') return null;
    const want = crypto.createHmac('sha256', Buffer.from(fam.key, 'hex')).update(p).digest();
    const got = Buffer.from(m, 'hex');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    return JSON.parse(p);
  } catch { return null; }
}

function stopNet() {
  clearInterval(beatTimer);
  beatTimer = null;
  if (sock) { try { sock.close(); } catch { /* already closed */ } }
  sock = null;
  liveKids.clear();
  pending.clear();
}

// ---------- parent side ----------
function startParent() {
  linkError = null;
  sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', (e) => { linkError = e.code || String(e); stopNet(); changed(); });
  sock.on('message', onChildBeacon);
  sock.bind(PORT);
  beatTimer = setInterval(changed, 3000); // keeps "online / time left" fresh in the panel
}

function onChildBeacon(buf, rinfo) {
  const b = unseal(buf);
  if (!b || b.t !== 'b' || typeof b.id !== 'string' || b.id === fam.deviceId) return;
  const live = liveKids.get(b.id) || {};
  if (!(b.seq > (live.seq || 0))) return; // old or repeated message
  const now = Date.now();
  const name = String(b.name || 'PC').slice(0, 60);
  liveKids.set(b.id, { addr: rinfo.address, port: rinfo.port, seq: b.seq, lastSeen: now, locked: !!b.locked, left: Number(b.left) || 0, prayer: LOCK_IDS.includes(b.prayer) ? b.prayer : null });

  let dirty = false;
  const known = fam.children[b.id];
  if (!known || known.name !== name) dirty = true;
  fam.children[b.id] = { name, lastSeen: now };

  const ack = [];
  for (const ev of Array.isArray(b.events) ? b.events.slice(0, 20) : []) {
    if (!ev || typeof ev.id !== 'string') continue;
    ack.push(ev.id);
    if (fam.alerts.some((a) => a.id === ev.id)) continue;
    const alert = { id: ev.id, ts: Number(ev.ts) || now, childId: b.id, name, type: String(ev.type) };
    fam.alerts.unshift(alert);
    fam.alerts.length = Math.min(fam.alerts.length, 100);
    dirty = true;
    notifyAlert(alert);
  }
  if (!b.locked) pending.delete(b.id);
  if (dirty) persist();

  const reply = seal({ t: 'a', id: b.id, nonce: b.nonce, ack, cfg: fam.cfg, cmd: pending.get(b.id) || null });
  if (sock) sock.send(reply, rinfo.port, rinfo.address, () => {});
  changed();
}

function notifyAlert(alert) {
  if (!Notification.isSupported()) return;
  const s = ctx.strings();
  const n = new Notification({ title: alert.name, body: s[alertKey(alert.type)] || alert.type, icon: ctx.iconPath() });
  n.on('click', ctx.showWindow);
  n.show();
}
const alertKey = (type) => ({ killed: 'alKilled', taskmgr: 'alTaskmgr', pinfail: 'alPinfail', pinunlock: 'alPinunlock' })[type];

// ---------- child side ----------
function broadcastAddrs() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.internal || (i.family !== 'IPv4' && i.family !== 4)) continue;
      const a = i.address.split('.').map(Number);
      const m = i.netmask.split('.').map(Number);
      out.add(a.map((x, k) => (x | (~m[k] & 255))).join('.'));
    }
  }
  if (lastParentAddr) out.add(lastParentAddr);
  return [...out];
}

function startChild() {
  linkError = null;
  sock = dgram.createSocket('udp4');
  sock.on('error', (e) => { linkError = e.code || String(e); });
  sock.on('message', onParentAnswer);
  sock.bind(0, () => {
    try { sock.setBroadcast(true); } catch { /* keep going with direct messages */ }
    beat();
    beatTimer = setInterval(beat, 3000);
  });
}

function beat() {
  if (!sock || fam.role !== 'child') return;
  const nonce = crypto.randomBytes(8).toString('hex');
  nonces.push(nonce);
  nonces = nonces.slice(-10);
  const now = Date.now();
  const msg = seal({
    t: 'b', id: fam.deviceId, name: os.hostname(), seq: now, nonce,
    locked: isLocked(), left: Math.max(0, fam.lockUntil - now), prayer: fam.lockPrayer,
    events: fam.events.slice(0, 20),
  });
  for (const addr of broadcastAddrs()) {
    try { sock.send(msg, PORT, addr, () => {}); } catch { /* network down: try again next time */ }
  }
}

function onParentAnswer(buf, rinfo) {
  const a = unseal(buf);
  if (!a || a.t !== 'a' || a.id !== fam.deviceId || !nonces.includes(a.nonce)) return;
  const wasSeen = Date.now() - lastParentSeen < ONLINE_MS + 3000;
  lastParentSeen = Date.now();
  lastParentAddr = rinfo.address;
  let dirty = false;
  if (Array.isArray(a.ack) && a.ack.length) {
    const before = fam.events.length;
    fam.events = fam.events.filter((e) => !a.ack.includes(e.id));
    dirty = fam.events.length !== before;
  }
  const cfg = sanitizeCfg(a.cfg);
  if (cfg && cfg.rev > fam.cfg.rev) { fam.cfg = cfg; dirty = true; }
  if (dirty) persist();
  if (a.cmd && a.cmd.type === 'unlock' && isLocked()) endLock('parent');
  else if (dirty || !wasSeen) changed();
}

function addEvent(type, ts = Date.now()) {
  fam.events.push({ id: crypto.randomBytes(8).toString('hex'), ts, type });
  fam.events = fam.events.slice(-50);
  persist();
  beat();
}

// ---------- lock screen ----------
function startLock(until, prayer, key) {
  fam.lockUntil = until;
  fam.lockPrayer = prayer;
  fam.lockKey = key;
  persist();
  showLock();
  beat();
  changed();
}

function showLock() {
  if (guardTimer) return;
  buildLockWindows();
  startBlocker();
  guardTimer = setInterval(guard, 700);
}

function buildLockWindows() {
  for (const w of lockWins) if (!w.isDestroyed()) w.destroy();
  const soft = softLock();
  const displays = soft ? [screen.getPrimaryDisplay()] : screen.getAllDisplays();
  lockWins = displays.map((d) => {
    const w = new BrowserWindow({
      ...(soft ? { width: 820, height: 580 } : { ...d.bounds, frame: false, fullscreen: true, kiosk: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, closable: false }),
      show: true,
      backgroundColor: '#0f2238',
      title: 'Hilal Prayer Times',
      icon: ctx.iconPath(),
      webPreferences: { preload: ctx.preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    w.setMenu(null);
    if (!soft) w.setAlwaysOnTop(true, 'screen-saver');
    w.on('close', (e) => { if (isLocked()) e.preventDefault(); });
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.loadFile(path.join(__dirname, 'src', 'lock.html'));
    return w;
  });
}

// Keeps the lock on top and ends it when the time is up.
function guard() {
  if (!isLocked()) { endLock('expired'); return; }
  if (softLock()) return;
  if (lockWins.some((w) => w.isDestroyed())) { buildLockWindows(); return; }
  lockWins.forEach((w, i) => {
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.setAlwaysOnTop(true, 'screen-saver');
    w.moveTop();
    if (i === 0 && !lockWins.some((x) => x.isFocused())) w.focus();
  });
}

function startBlocker() {
  if (!IS_WIN || softLock() || blocker) return;
  const exe = app.isPackaged ? path.join(process.resourcesPath, 'keyblock.exe') : path.join(__dirname, 'build', 'keyblock.exe');
  if (!fs.existsSync(exe)) return;
  try {
    const child = spawn(exe, [String(process.pid)], { stdio: 'ignore', windowsHide: true });
    blocker = child;
    child.on('error', () => { if (blocker === child) blocker = null; });
    child.on('exit', () => {
      if (blocker !== child) return;
      blocker = null;
      if (isLocked()) setTimeout(() => { if (isLocked()) startBlocker(); }, 1000);
    });
  } catch { blocker = null; }
}

function endLock(reason) {
  if (fam.lockKey) fam.clearedKey = fam.lockKey;
  fam.lockUntil = 0;
  fam.lockPrayer = null;
  fam.lockKey = null;
  clearInterval(guardTimer);
  guardTimer = null;
  const b = blocker;
  blocker = null;
  if (b) { try { b.kill(); } catch { /* already gone */ } }
  for (const w of lockWins) if (!w.isDestroyed()) w.destroy();
  lockWins = [];
  if (reason === 'pin') addEvent('pinunlock'); else persist();
  beat();
  changed();
}

function lockInfo() {
  const s = ctx.strings();
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, s[k]]));
  return {
    until: fam.lockUntil,
    prayer: fam.lockPrayer,
    test: !fam.lockPrayer,
    lang: ctx.settings().language,
    wait: Math.max(0, Math.ceil((pinBlockedUntil - Date.now()) / 1000)),
    strings: pick(['dir', 'appName', 'timeFor', 'lockSub', 'lockLeft', 'lockParent', 'lockTest', 'pinEnter', 'pinWrong', 'pinWait', 'unlock', 'cancel', ...LOCK_IDS]),
  };
}

function lockPin(pin) {
  if (!isLocked()) return { ok: true, wait: 0 };
  const r = tryPin(pin);
  if (r.ok) endLock('pin');
  return r;
}

// Called every second by the app with today's prayer plan.
function tick(plan, now) {
  if (fam.role !== 'child' || isLocked()) return;
  const span = fam.cfg.lockMinutes * 60000;
  for (const e of [...plan.yesterday, ...plan.today]) {
    if (!fam.cfg.lockFor[e.id] || now < e.time || now >= e.time + span) continue;
    const key = `${e.id}:${e.time}`;
    if (key !== fam.clearedKey) startLock(e.time + span, e.id, key);
    return;
  }
}

// ---------- child: notice when the app was closed or Task Manager is opened ----------
const aliveFile = () => path.join(app.getPath('userData'), 'alive.json');
const writeAlive = (clean) => { try { fs.writeFileSync(aliveFile(), JSON.stringify({ ts: Date.now(), clean })); } catch { /* not critical */ } };

function checkLastExit() {
  try {
    const prev = JSON.parse(fs.readFileSync(aliveFile(), 'utf8'));
    const bootTime = Date.now() - os.uptime() * 1000;
    // Still running at prev.ts, never said goodbye, and the computer has not restarted since.
    if (prev && prev.clean === false && prev.ts > bootTime) addEvent('killed', prev.ts);
  } catch { /* first run */ }
}

function markCleanExit() {
  if (fam.role === 'child') writeAlive(true);
}

function watchTaskManager() {
  if (!IS_WIN) return;
  tmTimer = setInterval(() => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq Taskmgr.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
      const open = !err && /taskmgr\.exe/i.test(out || '');
      if (open && !tmOpen) addEvent('taskmgr');
      tmOpen = open;
      if (open && isLocked() && !softLock()) execFile('taskkill', ['/IM', 'Taskmgr.exe', '/F'], { windowsHide: true }, () => {});
    });
  }, 4000);
}

// A Windows scheduled task that starts the app again within a minute if it was closed.
function setWatchdog(on) {
  if (!IS_WIN || !app.isPackaged) return;
  if (!on) { execFile('schtasks', ['/delete', '/tn', WATCH_TASK, '/f'], { windowsHide: true }, () => {}); return; }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const user = `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ''}${os.userInfo().username}`;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
      <StartBoundary>2025-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>${esc(process.execPath)}</Command><Arguments>--hidden --watch</Arguments></Exec>
  </Actions>
</Task>`;
  const file = path.join(app.getPath('temp'), 'hilal-watch-task.xml');
  try {
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
    execFile('schtasks', ['/create', '/tn', WATCH_TASK, '/xml', file, '/f'], { windowsHide: true }, () => fs.rm(file, () => {}));
  } catch { /* the app still starts at sign-in */ }
}

// ---------- Task Manager on/off for this Windows account (needs an administrator) ----------
function queryTaskMgr() {
  return new Promise((resolve) => {
    if (!IS_WIN) { resolve(false); return; }
    execFile('reg', ['query', `HKCU\\${TM_KEY}`, '/v', 'DisableTaskMgr'], { windowsHide: true }, (err, out) => {
      taskMgrOff = !err && /0x1\b/.test(out || '');
      resolve(taskMgrOff);
    });
  });
}

function setTaskMgrBlocked(block) {
  return new Promise((resolve) => {
    if (!IS_WIN || !isAdmin()) { resolve(view()); return; }
    execFile('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }, (err, out) => {
      const sid = !err && (/"(S-1-[0-9-]+)"/.exec(out || '') || [])[1];
      if (!sid) { resolve(view()); return; }
      // The setting lives in a protected part of this account's registry, so Windows asks
      // for an administrator. It is written for this account even if another one approves.
      const key = `HKU\\${sid}\\${TM_KEY}`;
      const args = block ? ['add', key, '/v', 'DisableTaskMgr', '/t', 'REG_DWORD', '/d', '1', '/f'] : ['delete', key, '/v', 'DisableTaskMgr', '/f'];
      const list = args.map((a) => `'${a}'`).join(',');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process reg.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${list}`],
        { windowsHide: true }, async () => { await queryTaskMgr(); changed(); resolve(view()); });
    });
  });
}

// ---------- roles ----------
function startRole() {
  if (fam.role === 'parent') startParent();
  if (fam.role === 'child') {
    checkLastExit();
    writeAlive(false);
    aliveTimer = setInterval(() => writeAlive(false), 5000);
    startChild();
    watchTaskManager();
    setWatchdog(true);
    queryTaskMgr().then(changed);
    if (isLocked()) showLock();
  }
}

function stopRole() {
  stopNet();
  clearInterval(aliveTimer);
  clearInterval(tmTimer);
  aliveTimer = null;
  tmTimer = null;
}

function setup(role, pin) {
  if (fam.role !== 'none') return { ok: false, error: 'pinWrong' };
  if (role !== 'parent' && !(role === 'child' && IS_WIN)) return { ok: false, error: 'childWinOnly' };
  if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return { ok: false, error: 'pinBad' };
  fam.key = deriveKey(pin);
  fam.role = role;
  fam.cfg = defaultCfg();
  if (role === 'parent') fam.cfg.rev = Date.now();
  persist();
  adminUntil = Date.now() + ADMIN_MS;
  startRole();
  ctx.roleChanged();
  return { ok: true };
}

function leave() {
  if (!isAdmin()) return false;
  if (fam.role === 'child') {
    if (isLocked()) endLock('admin');
    setWatchdog(false);
    writeAlive(true);
  }
  stopRole();
  fam = { ...fresh(), deviceId: fam.deviceId };
  adminUntil = 0;
  persist();
  ctx.roleChanged();
  return true;
}

function setCfg(patch) {
  if (fam.role !== 'parent' || !isAdmin()) return;
  const next = sanitizeCfg({ ...fam.cfg, ...patch, lockFor: { ...fam.cfg.lockFor, ...((patch && patch.lockFor) || {}) } });
  next.rev = Date.now();
  fam.cfg = next;
  persist();
  changed();
}

function unlockChild(id) {
  if (fam.role !== 'parent' || !isAdmin() || !fam.children[id]) return;
  const cmd = { type: 'unlock', cid: crypto.randomBytes(4).toString('hex') };
  pending.set(id, cmd);
  setTimeout(() => { if (pending.get(id) === cmd) { pending.delete(id); changed(); } }, 30000);
  changed();
}

function forgetChild(id) {
  if (fam.role !== 'parent' || !isAdmin()) return;
  delete fam.children[id];
  liveKids.delete(id);
  pending.delete(id);
  persist();
  changed();
}

function clearAlerts() {
  if (fam.role !== 'parent' || !isAdmin()) return;
  fam.alerts = [];
  persist();
  changed();
}

function testLock() {
  if (fam.role !== 'child' || !isAdmin() || isLocked()) return;
  startLock(Date.now() + 20000, null, null);
}

function init(context) {
  ctx = context;
  load();
  screen.on('display-added', () => { if (guardTimer) buildLockWindows(); });
  screen.on('display-removed', () => { if (guardTimer) buildLockWindows(); });
  startRole();
}

module.exports = {
  init, view, tick, auth, lockAdmin, setup, leave, setCfg, unlockChild, forgetChild, clearAlerts,
  testLock, setTaskMgrBlocked, lockInfo, lockPin, markCleanExit,
  role: () => fam.role,
  isLocked,
  // A child's computer needs the parent PIN before settings can be changed.
  guarded: () => fam.role === 'child' && !isAdmin(),
};
