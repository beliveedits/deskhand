/* Deskhand text helpers: cleaning a spoken or typed command, number words, durations and clock times.
   Pure functions with no file, network or process access. Works in Node and in the browser (window.DeskhandLib.text). */
(function (g, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { g.DeskhandLib = g.DeskhandLib || {}; g.DeskhandLib.text = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var NW = Object.keys(ONES).concat(Object.keys(TENS), ['hundred', 'thousand']).join('|');
  // words after which a bare "one" is a pronoun ("the first one", "that one"), not the number 1
  var ONE_SKIP = /^(the|that|this|which|first|second|third|fourth|fifth|each|every|any|no|another|last|next|previous|which|what|big|small)$/;

  function collapse(s) {
    return String(s == null ? '' : s).replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  }

  // "Hey Deskhand, could you please open Chrome for me." -> "open Chrome"
  function clean(raw) {
    var s = collapse(raw);
    var before;
    s = s.replace(/^(?:(?:hey|ok|okay|hi|hello|yo)[ ,]+)?(?:desk\s?-?hand|jarvis)\b[ ,.:!-]+(?=\S)/i, '');
    s = s.replace(/^(?:hey|ok|okay|yo)[ ,]+(?=\w)/i, function (m, off) { return ''; });
    do {
      before = s;
      s = s.replace(/^(?:please|kindly|just|so|now|then|and|also|um+|uh+|hmm+)[ ,]+/i, '');
      s = s.replace(/^(?:can|could|would|will) you(?: please| kindly)?[ ,]+/i, '');
      s = s.replace(/^(?:i(?:'d| would| want| need| wanna)(?: you)? (?:like )?(?:you )?to |i(?:'d| would) like to |i want you to |i need you to |go ahead and |let's |lets |you should |you can )/i, '');
    } while (s !== before);
    s = s.replace(/[.!?]+$/g, '');
    do {
      before = s;
      s = s.replace(/[ ,]+(?:please|thanks|thank you|for me|right now|now)$/i, '').replace(/[.!?]+$/g, '');
    } while (s !== before);
    s = s.trim();
    s = s.replace(/\b(what|who|where|how|when|that|there|here|it|let)'s\b/gi, function (m, w) { return w + ' is'; });
    return s;
  }

  // Reads a run of number words starting at words[i]. Returns {value, next} or null.
  // kind: 'u' units 1-9, 't' teens and ten, 'T' tens, 'H' after hundred or thousand. "ten fifteen" is two numbers, "twenty five" is one.
  function readNumber(words, i) {
    var total = 0, cur = 0, seen = false, j = i, kind = null;
    for (; j < words.length; j++) {
      var w = words[j].toLowerCase();
      var parts = w.split('-');
      if (parts.length === 2 && TENS[parts[0]] && ONES[parts[1]] > 0 && ONES[parts[1]] < 10 && (kind === null || kind === 'H')) {
        cur += TENS[parts[0]] + ONES[parts[1]]; seen = true; kind = 'u'; continue;
      }
      if (Object.prototype.hasOwnProperty.call(ONES, w)) {
        var v = ONES[w], k = v >= 10 ? 't' : 'u';
        if (kind === 'T' ? !(v > 0 && v < 10) : (kind === 'u' || kind === 't')) break;
        cur += v; seen = true; kind = k; continue;
      }
      if (Object.prototype.hasOwnProperty.call(TENS, w)) {
        if (kind === 'u' || kind === 't' || kind === 'T') break;
        cur += TENS[w]; seen = true; kind = 'T'; continue;
      }
      if (w === 'hundred' && seen && cur > 0 && cur < 10) { cur = cur * 100; kind = 'H'; continue; }
      if (w === 'thousand' && seen) { total += (cur || 1) * 1000; cur = 0; kind = 'H'; continue; }
      if (w === 'and' && seen && kind === 'H' && j + 1 < words.length && (ONES[words[j + 1].toLowerCase()] !== undefined || TENS[words[j + 1].toLowerCase()] !== undefined)) { continue; }
      break;
    }
    if (!seen) return null;
    return { value: total + cur, next: j };
  }

  // "volume to fifty five" -> "volume to 55". Leaves every other word as it was.
  function numberWords(s) {
    var words = String(s).split(' '), out = [];
    for (var i = 0; i < words.length;) {
      var r = readNumber(words, i);
      if (r) {
        var single = r.next === i + 1 && words[i].toLowerCase() === 'one';
        if (single && i > 0 && ONE_SKIP.test(words[i - 1].toLowerCase())) { out.push(words[i]); i++; continue; }
        out.push(String(r.value)); i = r.next; continue;
      }
      out.push(words[i]); i++;
    }
    return out.join(' ');
  }

  // ---- durations ----------------------------------------------------------------------------------
  var UNIT_MS = { w: 604800000, d: 86400000, h: 3600000, m: 60000, s: 1000 };
  function unitKey(u) {
    u = u.toLowerCase();
    if (/^w/.test(u)) return 'w';
    if (/^d/.test(u)) return 'd';
    if (/^h/.test(u)) return 'h';
    if (/^m/.test(u)) return 'm';
    return 's';
  }
  var NUMW = '(?:(?:' + NW + ')(?:[\\s-]+(?:and\\s+)?(?:' + NW + '))*)';
  var QTY = '(?:\\d+(?:\\.\\d+)?|half\\s+an?|an?|' + NUMW + ')';
  var LONG_UNIT = '(?:weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)';
  var PIECE_RE = new RegExp(
    '(?:\\b(' + QTY + ')\\s+and\\s+a\\s+half\\s*(' + LONG_UNIT + ')\\b' +                       // 2 and a half hours
    '|\\bhalf\\s+(?:an?\\s+)?(hour|minute)\\b' +                                                      // half an hour
    '|\\b(' + QTY + ')\\s*(' + LONG_UNIT + ')\\b(\\s+and\\s+a\\s+half\\b)?' +                         // 10 minutes, an hour and a half
    '|(?<![\\d.])(\\d+(?:\\.\\d+)?)(h|m|s)(?![a-z]))', 'gi');

  function qtyValue(q) {
    q = q.toLowerCase().trim();
    if (/^\d/.test(q)) return parseFloat(q);
    if (/^half/.test(q)) return 0.5;
    if (q === 'a' || q === 'an') return 1;
    var r = readNumber(q.split(/\s+/), 0);
    return r ? r.value : NaN;
  }

  // Finds a length of time in the text. Returns {ms, start, end} or null.
  function parseDuration(text) {
    var s = String(text), pieces = [], m;
    PIECE_RE.lastIndex = 0;
    while ((m = PIECE_RE.exec(s))) {
      var ms = 0;
      if (m[1] !== undefined) ms = (qtyValue(m[1]) + 0.5) * UNIT_MS[unitKey(m[2])];
      else if (m[3] !== undefined) ms = 0.5 * UNIT_MS[unitKey(m[3])];
      else if (m[4] !== undefined) { ms = qtyValue(m[4]) * UNIT_MS[unitKey(m[5])]; if (m[6]) ms += 0.5 * UNIT_MS[unitKey(m[5])]; }
      else if (m[7] !== undefined) ms = parseFloat(m[7]) * UNIT_MS[unitKey(m[8])];
      if (!isFinite(ms) || ms <= 0) continue;
      pieces.push({ ms: ms, start: m.index, end: m.index + m[0].length });
    }
    if (!pieces.length) return null;
    var cur = pieces[0], total = cur.ms, end = cur.end;
    for (var i = 1; i < pieces.length; i++) {
      var gap = s.slice(end, pieces[i].start);
      if (/^\s*(?:,|and)?\s*$/i.test(gap)) { total += pieces[i].ms; end = pieces[i].end; } else break;
    }
    var start = cur.start;
    var lead = /(?:\b(?:in|for|after|within)\s+)$/i.exec(s.slice(0, start));
    if (lead) start -= lead[0].length;
    return { ms: Math.round(total), start: start, end: end };
  }

  function fmtDuration(ms) {
    var t = Math.round(ms / 1000);
    if (t < 1) return 'less than a second';
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60, out = [];
    if (h) out.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m) out.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (s && !h) out.push(s + (s === 1 ? ' second' : ' seconds'));
    return out.join(' ');
  }

  // ---- clock times ----------------------------------------------------------------------------------
  var HOURW = '(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  var CLOCK_RE = new RegExp(
    '\\b(?:(tomorrow|today|tonight)\\s+)?(?:at\\s+)?' +
    '(?:(noon|midnight)|(' + HOURW + ')(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)|at\\s+(' + HOURW + ')(?::(\\d{2}))?(?!\\d)|(\\d{1,2}):(\\d{2})(?!\\d))' +
    '(?:\\s+(tomorrow|today|tonight))?', 'i');

  function hourValue(h) {
    h = String(h).toLowerCase();
    if (/^\d/.test(h)) return parseInt(h, 10);
    return ONES[h];
  }

  function startOfDay(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }

  // Finds a time of day. "at 6pm", "tomorrow at 9:30 am", "at 17:45", "at noon". Returns {at: Date, start, end, exact} or null.
  // "at 6" with no am or pm is read as the next 6 o'clock that comes, morning or evening.
  function parseClock(text, now) {
    now = now || new Date();
    var s = String(text), m = CLOCK_RE.exec(s);
    if (!m) return null;
    var day = (m[1] || m[10] || '').toLowerCase();
    var h, min = 0, ampm = null, exact = true;
    if (m[2]) { h = m[2].toLowerCase() === 'noon' ? 12 : 0; ampm = 'x'; if (!m[1] && !/\bat\s+(?:noon|midnight)/i.test(m[0]) && !/^(?:noon|midnight)/i.test(m[0].trim())) { /* bare word, still fine */ } }
    else if (m[3]) { h = hourValue(m[3]); min = m[4] ? parseInt(m[4], 10) : 0; ampm = m[5].toLowerCase().charAt(0); }
    else if (m[6]) { h = hourValue(m[6]); min = m[7] ? parseInt(m[7], 10) : 0; ampm = null; }
    else if (m[8]) { h = parseInt(m[8], 10); min = parseInt(m[9], 10); ampm = h > 12 || h === 0 || /^0/.test(m[8]) ? 'h24' : null; }
    if (h === undefined || isNaN(h) || min > 59) return null;
    if (ampm === 'p' || ampm === 'a') { if (h < 1 || h > 12) return null; if (ampm === 'p' && h < 12) h += 12; if (ampm === 'a' && h === 12) h = 0; }
    else if (ampm === 'x') { /* noon or midnight, h already set */ }
    else if (ampm === 'h24') { if (h > 23) return null; }
    else if (ampm === null) {
      if (h > 23) return null;
      if (h > 12) { /* already 24 hour */ } else { exact = false; }
    }
    var base = startOfDay(now);
    if (day === 'tomorrow') base.setDate(base.getDate() + 1);
    var at;
    if (exact || day === 'tomorrow') {
      var hh = h;
      if (!exact) hh = (h >= 7 && h <= 11) || h === 0 ? h : (h === 12 ? 12 : (h <= 6 ? h + 12 : h));
      at = new Date(base.getTime()); at.setHours(hh, min, 0, 0);
      if (day !== 'tomorrow' && at <= now) at.setDate(at.getDate() + 1);
    } else {
      // ambiguous: the sooner of the morning or evening instance
      var h12 = h % 12;
      var a = new Date(base.getTime()); a.setHours(h12, min, 0, 0);
      var b = new Date(base.getTime()); b.setHours(h12 + 12, min, 0, 0);
      var cands = [a, b];
      [a, b].forEach(function (c) { var n = new Date(c.getTime()); n.setDate(n.getDate() + 1); cands.push(n); });
      cands = cands.filter(function (c) { return c > now; }).sort(function (x, y) { return x - y; });
      at = cands[0];
    }
    return { at: at, start: m.index, end: m.index + m[0].length, exact: exact };
  }

  // Finds either "in 10 minutes" or "at 6pm". Returns {at, ms, start, end, kind} or null.
  function parseWhen(text, now) {
    now = now || new Date();
    var d = parseDuration(text), c = parseClock(text, now);
    if (d && c) { if (c.start < d.start && c.exact) d = null; else c = null; }
    if (d) return { at: new Date(now.getTime() + d.ms), ms: d.ms, start: d.start, end: d.end, kind: 'duration' };
    if (c) return { at: c.at, ms: c.at - now, start: c.start, end: c.end, kind: 'clock', exact: c.exact };
    return null;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtClock(d) {
    var h = d.getHours(), ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 || 12;
    return h12 + ':' + pad2(d.getMinutes()) + ' ' + ap;
  }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtDay(d, now) {
    now = now || new Date();
    var a = startOfDay(d).getTime(), b = startOfDay(now).getTime(), diff = Math.round((a - b) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  }
  function fmtWhen(d, now) { return fmtClock(d) + ' ' + fmtDay(d, now); }

  function pluralize(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  return { collapse: collapse, clean: clean, readNumber: readNumber, numberWords: numberWords, parseDuration: parseDuration,
    parseClock: parseClock, parseWhen: parseWhen, fmtDuration: fmtDuration, fmtClock: fmtClock, fmtDay: fmtDay, fmtWhen: fmtWhen,
    pluralize: pluralize, DAYS: DAYS, MONTHS: MONTHS, startOfDay: startOfDay, NW: NW };
});
