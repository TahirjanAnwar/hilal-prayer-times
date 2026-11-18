// Islamic (Umm al-Qura) calendar helpers, shared by the main window and the desktop widget.
// The dates are calculated, so they can differ by a day from a local moon sighting; the
// `adjust` value (-2..2 days, from Settings) shifts them.
(() => {
  const DAY = 86400000;
  const hijriFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', calendar: 'islamic-umalqura', numberingSystem: 'latn', day: 'numeric', month: 'numeric', year: 'numeric',
  });
  const hijri = (ms) => {
    const o = {};
    for (const p of hijriFmt.formatToParts(new Date(ms))) if (p.type === 'day' || p.type === 'month') o[p.type] = parseInt(p.value, 10);
    return o;
  };

  // Noon (UTC) of the city's calendar day, shifted by `adjust` days. Working with whole
  // days at noon keeps the day count right across clock changes.
  function noon(tz, adjust = 0, now = Date.now()) {
    const o = {};
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' });
    for (const p of f.formatToParts(new Date(now))) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return Date.UTC(o.year, o.month - 1, o.day, 12) + (adjust || 0) * DAY;
  }

  let cache = { key: null, value: null };

  // During Ramadan: { inRamadan: true, day, left }. Otherwise: { inRamadan: false, until }.
  function ramadan(tz, adjust = 0, now = Date.now()) {
    const base = noon(tz, adjust, now);
    const key = `${base}`;
    if (cache.key === key) return cache.value;
    const today = hijri(base);
    let value;
    if (today.month === 9) {
      let left = 0;
      while (left < 31 && hijri(base + (left + 1) * DAY).month === 9) left++;
      value = { inRamadan: true, day: today.day, left };
    } else {
      let until = 1;
      while (until < 400 && hijri(base + until * DAY).month !== 9) until++;
      value = { inRamadan: false, until };
    }
    cache = { key, value };
    return value;
  }

  // The days of the Islamic year the app lists: [name key, Hijri month, Hijri day].
  const EVENTS = [
    ['dayRamadan', 9, 1], ['dayLastTen', 9, 20], ['dayEidFitr', 10, 1], ['dayDhulHijjah', 12, 1],
    ['dayArafah', 12, 9], ['dayEidAdha', 12, 10], ['dayNewYear', 1, 1], ['dayAshura', 1, 10],
  ];
  let upCache = { key: null, value: null };

  // The next time each day comes: [{ id, days (from today), ms (noon UTC of that date) }], soonest
  // first. The white days are the 13th to 15th of a month (not in Ramadan, when every day is a
  // fast, and not in Dhul Hijjah, where the 13th is a day on which fasting is not allowed).
  function upcoming(tz, adjust = 0, now = Date.now()) {
    const base = noon(tz, adjust, now);
    if (upCache.key === base) return upCache.value;
    const real = noon(tz, 0, now);
    const found = {};
    for (let d = 0; d < 400; d++) {
      const h = hijri(base + d * DAY);
      if (!('dayWhite' in found) && h.day >= 13 && h.day <= 15 && h.month !== 9 && h.month !== 12) found.dayWhite = d;
      for (const [id, month, day] of EVENTS) if (!(id in found) && h.month === month && h.day === day) found[id] = d;
    }
    const value = Object.entries(found).map(([id, days]) => ({ id, days, ms: real + days * DAY })).sort((a, b) => a.days - b.days);
    upCache = { key: base, value };
    return value;
  }

  window.HIJRI = { ramadan, noon, upcoming };
})();
