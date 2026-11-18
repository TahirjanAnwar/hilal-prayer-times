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

  window.HIJRI = { ramadan, noon };
})();
