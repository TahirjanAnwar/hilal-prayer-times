// Small weather helpers shared by the main window and the desktop widget. The numbers come
// from the main process (Open-Meteo, always in Celsius); this file turns them into an icon
// and a text in the chosen unit.
(() => {
  const CLOUD = '<path d="M7.2 18h9.6a3.6 3.6 0 0 0 .5-7.17A5.2 5.2 0 0 0 7.3 9.9 4.1 4.1 0 0 0 7.2 18z"/>';
  const HIGH_CLOUD = '<path d="M7.2 15h9.6a3.6 3.6 0 0 0 .5-7.17A5.2 5.2 0 0 0 7.3 6.9 4.1 4.1 0 0 0 7.2 15z"/>';
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    partlyDay: '<circle cx="8" cy="7.5" r="2.6"/><path d="M8 2.2v1.3M2.7 7.5H4M4.2 3.7l.9.9M11.8 3.7l-.9.9"/><path d="M9.2 19h8.6a3.2 3.2 0 0 0 .4-6.37A4.7 4.7 0 0 0 9.3 11.8 3.7 3.7 0 0 0 9.2 19z"/>',
    partlyNight: '<path d="M10.5 3.2a4.2 4.2 0 0 0 3.9 5.5 4.3 4.3 0 0 1-3.9-5.5z"/><path d="M8.2 19h8.6a3.2 3.2 0 0 0 .4-6.37A4.7 4.7 0 0 0 8.3 11.8 3.7 3.7 0 0 0 8.2 19z"/>',
    cloud: CLOUD,
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    rain: `${HIGH_CLOUD}<path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>`,
    snow: `${HIGH_CLOUD}<path d="M8 18.5h.01M12 18.5h.01M16 18.5h.01M10 21.2h.01M14 21.2h.01"/>`,
    thunder: `${HIGH_CLOUD}<path d="M12.8 16.5l-2.3 3.2h3l-2 2.8"/>`,
  };

  // WMO weather codes, as Open-Meteo reports them.
  function kind(code, day) {
    if (code === 0) return day ? 'sun' : 'moon';
    if (code === 1 || code === 2) return day ? 'partlyDay' : 'partlyNight';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'thunder';
    if (code >= 51) return 'rain';
    return 'cloud';
  }

  // Countries that use Fahrenheit in everyday life.
  const FAHRENHEIT = ['US', 'BS', 'BZ', 'KY', 'PW', 'LR', 'FM', 'MH'];

  function unitFor(setting, countryCode) {
    if (setting === 'c' || setting === 'f') return setting;
    return FAHRENHEIT.includes(String(countryCode || '').toUpperCase()) ? 'f' : 'c';
  }

  // Fills an element with the icon and the temperature, or hides it when there is nothing to show.
  function show(el, weather, setting, countryCode) {
    if (!weather || setting === 'off') { el.hidden = true; return; }
    const unit = unitFor(setting, countryCode);
    const value = Math.round(unit === 'f' ? weather.c * 9 / 5 + 32 : weather.c);
    const key = `${kind(weather.code, weather.day)}|${value}|${unit}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind(weather.code, weather.day)]}</svg><span dir="ltr"></span>`;
      el.lastChild.textContent = `${value}°${unit.toUpperCase()}`;
    }
    el.hidden = false;
  }

  window.WX = { show, unitFor, kind };
})();
