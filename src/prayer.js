// Prayer time calculation (runs in the main process, fully offline).
const adhan = require('adhan');

const METHODS = [
  'MuslimWorldLeague', 'Turkey', 'Egyptian', 'Karachi', 'UmmAlQura', 'Dubai',
  'MoonsightingCommittee', 'NorthAmerica', 'Kuwait', 'Qatar', 'Singapore', 'Tehran',
];

const COUNTRY_METHOD = {
  TR: 'Turkey',
  US: 'NorthAmerica', CA: 'NorthAmerica',
  SA: 'UmmAlQura', YE: 'UmmAlQura', BH: 'UmmAlQura', OM: 'UmmAlQura',
  EG: 'Egyptian', SY: 'Egyptian', LB: 'Egyptian', IQ: 'Egyptian', JO: 'Egyptian',
  LY: 'Egyptian', SD: 'Egyptian', DZ: 'Egyptian', TN: 'Egyptian', MA: 'Egyptian',
  PK: 'Karachi', IN: 'Karachi', BD: 'Karachi', AF: 'Karachi',
  AE: 'Dubai', KW: 'Kuwait', QA: 'Qatar',
  SG: 'Singapore', MY: 'Singapore', ID: 'Singapore', BN: 'Singapore',
  IR: 'Tehran',
  GB: 'MoonsightingCommittee',
};

function resolveMethod(method, countryCode) {
  if (METHODS.includes(method)) return method;
  return COUNTRY_METHOD[(countryCode || '').toUpperCase()] || 'MuslimWorldLeague';
}

function tzParts(tz, date) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const o = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

// Calendar date (y, m, d) in the city's timezone.
function cityDate(tz, date = new Date()) {
  const p = tzParts(tz, date);
  return { y: p.year, m: p.month, d: p.day };
}

function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Wall-clock time in a timezone -> epoch milliseconds.
function zonedToEpoch(tz, y, m, d, hh, mm) {
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = tzParts(tz, new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wall - shown;
  }
  return guess;
}

function safeTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

// Returns [{id, time}] for one calendar day at the location, sorted by time.
function computeDay(loc, settings, ymd) {
  const tz = safeTz(loc.tz);
  const coords = new adhan.Coordinates(loc.lat, loc.lon);
  const params = adhan.CalculationMethod[resolveMethod(settings.method, loc.countryCode)]();
  params.madhab = settings.madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coords);
  // adhan reads the local Y/M/D of the Date it is given.
  const pt = new adhan.PrayerTimes(coords, new Date(ymd.y, ymd.m - 1, ymd.d, 12), params);

  const events = [];
  for (const id of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    const t = pt[id] && pt[id].getTime();
    if (Number.isFinite(t)) events.push({ id, time: t });
  }
  const isFriday = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay() === 5;
  if (isFriday) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(settings.jumaTime || '');
    if (m) events.push({ id: 'juma', time: zonedToEpoch(tz, ymd.y, ymd.m, ymd.d, +m[1], +m[2]) });
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

function qibla(loc) {
  return Math.round(adhan.Qibla(new adhan.Coordinates(loc.lat, loc.lon)));
}

module.exports = { METHODS, resolveMethod, cityDate, addDays, computeDay, qibla, safeTz };
