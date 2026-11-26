/* Deskhand clocks: the time and date in a city, using the browser or Node time-zone database (Intl). Pure, no network.
   Works in Node and in the browser (window.DeskhandLib.clock). */
(function (g, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { g.DeskhandLib = g.DeskhandLib || {}; g.DeskhandLib.clock = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CITIES = {
    'delhi': 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', 'mumbai': 'Asia/Kolkata', 'bombay': 'Asia/Kolkata', 'rajkot': 'Asia/Kolkata', 'ahmedabad': 'Asia/Kolkata',
    'bangalore': 'Asia/Kolkata', 'bengaluru': 'Asia/Kolkata', 'chennai': 'Asia/Kolkata', 'kolkata': 'Asia/Kolkata', 'hyderabad': 'Asia/Kolkata', 'pune': 'Asia/Kolkata',
    'india': 'Asia/Kolkata', 'ist': 'Asia/Kolkata',
    'new york': 'America/New_York', 'nyc': 'America/New_York', 'boston': 'America/New_York', 'miami': 'America/New_York', 'washington': 'America/New_York', 'est': 'America/New_York',
    'chicago': 'America/Chicago', 'dallas': 'America/Chicago', 'houston': 'America/Chicago', 'denver': 'America/Denver',
    'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', 'seattle': 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles', 'pst': 'America/Los_Angeles',
    'toronto': 'America/Toronto', 'vancouver': 'America/Vancouver', 'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
    'london': 'Europe/London', 'uk': 'Europe/London', 'dublin': 'Europe/Dublin', 'lisbon': 'Europe/Lisbon', 'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin', 'madrid': 'Europe/Madrid',
    'rome': 'Europe/Rome', 'amsterdam': 'Europe/Amsterdam', 'zurich': 'Europe/Zurich', 'stockholm': 'Europe/Stockholm', 'vienna': 'Europe/Vienna', 'warsaw': 'Europe/Warsaw',
    'istanbul': 'Europe/Istanbul', 'moscow': 'Europe/Moscow', 'athens': 'Europe/Athens',
    'dubai': 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', 'riyadh': 'Asia/Riyadh', 'doha': 'Asia/Qatar', 'tel aviv': 'Asia/Jerusalem', 'karachi': 'Asia/Karachi', 'lahore': 'Asia/Karachi',
    'dhaka': 'Asia/Dhaka', 'kathmandu': 'Asia/Kathmandu', 'colombo': 'Asia/Colombo', 'bangkok': 'Asia/Bangkok', 'jakarta': 'Asia/Jakarta', 'singapore': 'Asia/Singapore',
    'kuala lumpur': 'Asia/Kuala_Lumpur', 'manila': 'Asia/Manila', 'hong kong': 'Asia/Hong_Kong', 'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'taipei': 'Asia/Taipei',
    'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo', 'seoul': 'Asia/Seoul',
    'sydney': 'Australia/Sydney', 'melbourne': 'Australia/Melbourne', 'brisbane': 'Australia/Brisbane', 'perth': 'Australia/Perth', 'auckland': 'Pacific/Auckland',
    'cairo': 'Africa/Cairo', 'lagos': 'Africa/Lagos', 'nairobi': 'Africa/Nairobi', 'johannesburg': 'Africa/Johannesburg', 'cape town': 'Africa/Johannesburg',
    'utc': 'UTC', 'gmt': 'UTC'
  };
  var DISPLAY = { 'nyc': 'New York', 'la': 'Los Angeles', 'uk': 'London', 'ist': 'India', 'est': 'New York', 'pst': 'Los Angeles', 'utc': 'UTC', 'gmt': 'UTC' };

  function title(s) { return s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function zoneFor(name) {
    var k = String(name || '').toLowerCase().replace(/^the\s+/, '').replace(/[.?!]+$/, '').trim();
    if (CITIES[k]) return { zone: CITIES[k], label: DISPLAY[k] || title(k) };
    return null;
  }

  function partsIn(zone, now) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
    var o = {}; f.formatToParts(now).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function dayKey(zone, d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  // timeIn('tokyo', now, 'Asia/Kolkata') -> {label, time, day, text}
  function timeIn(name, now, homeZone) {
    var z = zoneFor(name);
    if (!z) return null;
    now = now || new Date();
    var p = partsIn(z.zone, now);
    var time = p.hour + ':' + p.minute + ' ' + p.dayPeriod.toLowerCase().replace(/\./g, '');
    var rel = '';
    if (homeZone) {
      var a = dayKey(z.zone, now), b = dayKey(homeZone, now);
      if (a > b) rel = ', which is tomorrow for you'; else if (a < b) rel = ', which is yesterday for you';
    }
    return { label: z.label, zone: z.zone, time: time, day: p.weekday + ' ' + p.day + ' ' + p.month, text: 'It is ' + time + ' in ' + z.label + ' (' + p.weekday + ' ' + p.day + ' ' + p.month + ')' + rel + '.' };
  }

  function localTimeText(now, locale) {
    now = now || new Date();
    var t = now.toLocaleTimeString(locale || 'en-US', { hour: 'numeric', minute: '2-digit' });
    return 'It is ' + t.toLowerCase() + '.';
  }
  function localDateText(now, locale) {
    now = now || new Date();
    return 'Today is ' + now.toLocaleDateString(locale || 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.';
  }

  return { CITIES: CITIES, zoneFor: zoneFor, timeIn: timeIn, localTimeText: localTimeText, localDateText: localDateText };
});
