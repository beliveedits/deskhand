/* Deskhand maths: a small safe calculator (no eval), natural-language sums, unit conversion, and frame/timecode maths for editors.
   Pure functions. Works in Node and in the browser (window.DeskhandLib.calc). */
(function (g, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { g.DeskhandLib = g.DeskhandLib || {}; g.DeskhandLib.calc = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCALES = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9 };
  var FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10, exp: Math.exp,
    sin: function (x) { return Math.sin(x * Math.PI / 180); }, cos: function (x) { return Math.cos(x * Math.PI / 180); }, tan: function (x) { return Math.tan(x * Math.PI / 180); }
  };
  var CONSTS = { pi: Math.PI, e: Math.E };

  function fail(msg) { var e = new Error(msg); e.calc = true; throw e; }

  function tokenize(src) {
    var s = String(src).toLowerCase();
    if (s.length > 200) fail('That sum is too long.');
    while (/\d,\d{3}/.test(s)) s = s.replace(/(\d),(\d{3})/g, '$1$2');
    var out = [], i = 0, m;
    while (i < s.length) {
      var ch = s[i];
      if (ch === ' ') { i++; continue; }
      if ((m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i)))) {
        var v = parseFloat(m[0]); i += m[0].length;
        var sc = /^\s*(k|thousand|lakhs?|lacs?|crores?|millions?|billions?)\b/.exec(s.slice(i));
        if (sc) { v *= SCALES[sc[1]]; i += sc[0].length; }
        out.push({ t: 'n', v: v }); continue;
      }
      if (/[a-z]/.test(ch)) { m = /^[a-z]+/.exec(s.slice(i)); out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ('+-*/^()%'.indexOf(ch) >= 0) { out.push({ t: ch }); i++; continue; }
      fail('I can only do sums with numbers, + - * / ^ and brackets.');
    }
    return out;
  }

  function evaluate(src) {
    var toks = tokenize(src), p = 0, depth = 0;
    if (!toks.length) fail('There is nothing to calculate.');
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function expr() {
      if (++depth > 40) fail('That sum is nested too deeply.');
      var left = term();
      for (;;) {
        var tk = peek();
        if (tk && (tk.t === '+' || tk.t === '-')) {
          next();
          var r = term();
          var rv = r.v;
          if (r.pct) rv = left.v * r.v;   // 100 + 10% means 110, as on a pocket calculator
          left = { v: tk.t === '+' ? left.v + rv : left.v - rv };
        } else break;
      }
      depth--;
      return left;
    }
    function term() {
      var left = power();
      for (;;) {
        var tk = peek();
        if (tk && (tk.t === '*' || tk.t === '/' || (tk.t === 'id' && (tk.v === 'mod' || tk.v === 'x')))) {
          next();
          var r = power();
          var rv = r.v;
          if (tk.t === '/') { if (rv === 0) fail('That divides by zero.'); left = { v: left.v / rv }; }
          else if (tk.t === 'id' && tk.v === 'mod') { if (rv === 0) fail('That divides by zero.'); left = { v: left.v % rv }; }
          else left = { v: left.v * rv };
        } else if (tk && (tk.t === '(' || (tk.t === 'id' && (FUNCS[tk.v] || CONSTS[tk.v] !== undefined))) ) {
          var r2 = power(); left = { v: left.v * r2.v };      // 2(3+4), 2pi
        } else break;
      }
      return left;
    }
    function power() {
      var base = unary();
      var tk = peek();
      if (tk && tk.t === '^') { next(); var ex = power(); var v = Math.pow(base.v, ex.v); return { v: v }; }
      return base;
    }
    function unary() {
      var tk = peek();
      if (tk && tk.t === '-') { next(); var u = unary(); return { v: -u.v, pct: u.pct }; }
      if (tk && tk.t === '+') { next(); return unary(); }
      return postfix();
    }
    function postfix() {
      var a = atom();
      var tk = peek();
      if (tk && tk.t === '%') { next(); return { v: a.v / 100, pct: true }; }
      return a;
    }
    function atom() {
      var tk = next();
      if (!tk) fail('That sum looks unfinished.');
      if (tk.t === 'n') return { v: tk.v };
      if (tk.t === '(') { var e = expr(); var c = next(); if (!c || c.t !== ')') fail('A bracket is not closed.'); return e; }
      if (tk.t === 'id') {
        if (CONSTS[tk.v] !== undefined) return { v: CONSTS[tk.v] };
        if (FUNCS[tk.v]) {
          var o = next();
          if (!o || o.t !== '(') fail('Put brackets after ' + tk.v + ', like ' + tk.v + '(16).');
          var arg = expr(); var cl = next();
          if (!cl || cl.t !== ')') fail('A bracket is not closed.');
          var rv = FUNCS[tk.v](arg.v);
          if (!isFinite(rv)) fail('That has no real answer.');
          return { v: rv };
        }
        fail('I do not know "' + tk.v + '" in a sum.');
      }
      fail('That sum does not make sense.');
    }
    var res = expr();
    if (p < toks.length) fail('That sum does not make sense.');
    if (!isFinite(res.v)) fail('That answer is too large.');
    return res.v;
  }

  function fmtNum(n, locale) {
    if (!isFinite(n)) return String(n);
    if (n === 0) return '0';
    var a = Math.abs(n);
    if (a >= 1e15 || a < 1e-6) return Number(n.toPrecision(6)).toExponential().replace('e+', ' x 10^').replace('e-', ' x 10^-');
    var r = Number(n.toPrecision(12));
    try { return r.toLocaleString(locale || 'en-US', { maximumFractionDigits: 6 }); } catch (e) { return String(r); }
  }

  // Turns spoken maths into an expression the evaluator understands.
  function wordsToExpr(text) {
    var s = ' ' + String(text).toLowerCase().replace(/\?+$/, '') + ' ';
    s = s.replace(/\bsquare root of\s+(\d+(?:\.\d+)?)/g, ' sqrt($1) ');
    s = s.replace(/\s(\d+(?:\.\d+)?)\s*(?:squared)\b/g, ' ($1^2) ').replace(/\s(\d+(?:\.\d+)?)\s*(?:cubed)\b/g, ' ($1^3) ');
    s = s.replace(/\b(?:multiplied by|times|into)\b/g, ' * ').replace(/\b(?:divided by|over)\b/g, ' / ')
      .replace(/\b(?:to the power of|raised to|to the power)\b/g, ' ^ ').replace(/\b(?:plus|add)\b/g, ' + ').replace(/\b(?:minus|less|take away|subtract)\b/g, ' - ')
      .replace(/\b(?:per ?cent|percent)\b/g, '%').replace(/\bmodulo\b/g, ' mod ');
    s = s.replace(/(\d)\s*[x×]\s*(\d)/g, '$1 * $2').replace(/÷/g, '/').replace(/−/g, '-');
    return s.replace(/\s+/g, ' ').trim();
  }

  var NUM = '(\\d[\\d,]*(?:\\.\\d+)?(?:\\s*(?:k|thousand|lakhs?|lacs?|crores?|millions?|billions?)\\b)?)';
  function num(s) { return evaluate(s); }

  // Returns {value, expr, text} for sums like "15% of 2400", "add 18% to 1000", "20% off 500", "12 * (3 + 4)". Null if it is not a sum.
  function natural(text) {
    var s = String(text).toLowerCase().replace(/\?+$/, '').trim(), m, v;
    if (!/\d/.test(s) && !/^(?:pi|e)$/.test(s)) return null;
    if ((m = new RegExp('^' + NUM + '\\s*(?:%|percent|per cent)\\s*(?:off|discount)\\s+(?:on |from )?' + NUM + '$').exec(s))) {
      v = num(m[2]) * (1 - num(m[1]) / 100); return { value: v, expr: m[1] + '% off ' + m[2] };
    }
    if ((m = new RegExp('^(?:add|plus|include)\\s+' + NUM + '\\s*(?:%|percent|per cent)\\s*(?:[a-z]+\\s+)?(?:to|on)\\s+' + NUM + '$').exec(s)) ||
        (m = new RegExp('^(?:increase|raise)\\s+' + NUM + '\\s+by\\s+' + NUM + '\\s*(?:%|percent|per cent)$').exec(s))) {
      var isAdd = /^(?:add|plus|include)/.test(s);
      var pc = isAdd ? m[1] : m[2], base = isAdd ? m[2] : m[1];
      v = num(base) * (1 + num(pc) / 100); return { value: v, expr: base + ' + ' + pc + '%' };
    }
    if ((m = new RegExp('^(?:subtract|take|remove)\\s+' + NUM + '\\s*(?:%|percent|per cent)\\s*(?:[a-z]+\\s+)?(?:from|off)\\s+' + NUM + '$').exec(s)) ||
        (m = new RegExp('^(?:reduce|decrease|cut)\\s+' + NUM + '\\s+by\\s+' + NUM + '\\s*(?:%|percent|per cent)$').exec(s))) {
      var isSub = /^(?:subtract|take|remove)/.test(s);
      var pc2 = isSub ? m[1] : m[2], base2 = isSub ? m[2] : m[1];
      v = num(base2) * (1 - num(pc2) / 100); return { value: v, expr: base2 + ' - ' + pc2 + '%' };
    }
    if ((m = new RegExp('^(?:what is )?' + NUM + '\\s*(?:%|percent|per cent)\\s+of\\s+(.+)$').exec(s))) {
      var rest = wordsToExpr(m[2]);
      v = num(m[1]) / 100 * evaluate(rest); return { value: v, expr: m[1] + '% of ' + m[2] };
    }
    if ((m = new RegExp('^' + NUM + '\\s+is\\s+what\\s+(?:%|percent|per cent)\\s+of\\s+' + NUM + '$').exec(s)) ||
        (m = new RegExp('^what\\s+(?:%|percent|per cent)\\s+(?:is|of)\\s+' + NUM + '\\s+(?:is|of)\\s+' + NUM + '$').exec(s))) {
      var d = num(m[2]); if (d === 0) fail('That divides by zero.');
      v = num(m[1]) / d * 100; return { value: v, expr: m[1] + ' as a % of ' + m[2], pct: true };
    }
    var e = wordsToExpr(s);
    if (!/^[\d\s.,+\-*/^()%a-z]+$/.test(e) || !/\d|pi\b/.test(e)) return null;
    // must contain an operator, a function or a bracket: a bare number is not a sum
    if (!/[+\-*/^%()]|\bmod\b|\b(?:sqrt|abs|round|floor|ceil|ln|log|exp|sin|cos|tan)\b/.test(e)) return null;
    v = evaluate(e);
    return { value: v, expr: e };
  }

  // ---- unit conversion --------------------------------------------------------------------------------
  var U = {}; // alias -> {dim, key}
  var DIMS = {
    length: { base: 'm', f: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
    mass: { base: 'kg', f: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 } },
    volume: { base: 'l', f: { ml: 0.001, l: 1, tsp: 0.00492892159375, tbsp: 0.01478676478125, cup: 0.2365882365, floz: 0.0295735295625, pt: 0.473176473, qt: 0.946352946, gal: 3.785411784 } },
    data: { base: 'b', f: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776 } },
    time: { base: 's', f: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800 } },
    speed: { base: 'mps', f: { mps: 1, kmh: 1 / 3.6, mph: 0.44704, kn: 1852 / 3600 } },
    area: { base: 'm2', f: { m2: 1, km2: 1e6, ft2: 0.09290304, acre: 4046.8564224, ha: 10000 } },
    temp: { base: 'c', f: { c: 1, f: 1, k: 1 } }
  };
  var NAMES = {
    mm: 'millimeters', cm: 'centimeters', m: 'meters', km: 'kilometers', in: 'inches', ft: 'feet', yd: 'yards', mi: 'miles',
    mg: 'milligrams', g: 'grams', kg: 'kilograms', t: 'tonnes', oz: 'ounces', lb: 'pounds', st: 'stone',
    ml: 'milliliters', l: 'liters', tsp: 'teaspoons', tbsp: 'tablespoons', cup: 'cups', floz: 'fluid ounces', pt: 'pints', qt: 'quarts', gal: 'US gallons',
    b: 'bytes', kb: 'kilobytes', mb: 'megabytes', gb: 'gigabytes', tb: 'terabytes', kib: 'kibibytes', mib: 'mebibytes', gib: 'gibibytes', tib: 'tebibytes',
    ms: 'milliseconds', s: 'seconds', min: 'minutes', h: 'hours', d: 'days', wk: 'weeks',
    mps: 'meters per second', kmh: 'km/h', mph: 'mph', kn: 'knots',
    m2: 'square meters', km2: 'square kilometers', ft2: 'square feet', acre: 'acres', ha: 'hectares',
    c: 'degrees Celsius', f: 'degrees Fahrenheit', k: 'kelvin'
  };
  function alias(dim, key, list) { list.forEach(function (a) { U[a] = { dim: dim, key: key }; }); }
  alias('length', 'mm', ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']);
  alias('length', 'cm', ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']);
  alias('length', 'm', ['m', 'meter', 'meters', 'metre', 'metres']);
  alias('length', 'km', ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);
  alias('length', 'in', ['in', 'inch', 'inches']);
  alias('length', 'ft', ['ft', 'foot', 'feet']);
  alias('length', 'yd', ['yd', 'yds', 'yard', 'yards']);
  alias('length', 'mi', ['mi', 'mile', 'miles']);
  alias('mass', 'mg', ['mg', 'milligram', 'milligrams']);
  alias('mass', 'g', ['g', 'gram', 'grams', 'gm', 'gms']);
  alias('mass', 'kg', ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms']);
  alias('mass', 't', ['tonne', 'tonnes', 'metric ton', 'metric tons']);
  alias('mass', 'oz', ['oz', 'ounce', 'ounces']);
  alias('mass', 'lb', ['lb', 'lbs', 'pound', 'pounds']);
  alias('mass', 'st', ['stone']);
  alias('volume', 'ml', ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
  alias('volume', 'l', ['l', 'liter', 'liters', 'litre', 'litres']);
  alias('volume', 'tsp', ['tsp', 'teaspoon', 'teaspoons']);
  alias('volume', 'tbsp', ['tbsp', 'tablespoon', 'tablespoons']);
  alias('volume', 'cup', ['cup', 'cups']);
  alias('volume', 'floz', ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']);
  alias('volume', 'pt', ['pt', 'pint', 'pints']);
  alias('volume', 'qt', ['qt', 'quart', 'quarts']);
  alias('volume', 'gal', ['gal', 'gallon', 'gallons']);
  alias('data', 'b', ['byte', 'bytes']);
  alias('data', 'kb', ['kb', 'kilobyte', 'kilobytes']);
  alias('data', 'mb', ['mb', 'megabyte', 'megabytes']);
  alias('data', 'gb', ['gb', 'gigabyte', 'gigabytes', 'gig', 'gigs']);
  alias('data', 'tb', ['tb', 'terabyte', 'terabytes']);
  alias('data', 'kib', ['kib', 'kibibyte', 'kibibytes']);
  alias('data', 'mib', ['mib', 'mebibyte', 'mebibytes']);
  alias('data', 'gib', ['gib', 'gibibyte', 'gibibytes']);
  alias('data', 'tib', ['tib', 'tebibyte', 'tebibytes']);
  alias('time', 'ms', ['ms', 'millisecond', 'milliseconds']);
  alias('time', 's', ['s', 'sec', 'secs', 'second', 'seconds']);
  alias('time', 'min', ['min', 'mins', 'minute', 'minutes']);
  alias('time', 'h', ['h', 'hr', 'hrs', 'hour', 'hours']);
  alias('time', 'd', ['d', 'day', 'days']);
  alias('time', 'wk', ['wk', 'wks', 'week', 'weeks']);
  alias('speed', 'mps', ['m/s', 'mps', 'meters per second', 'metres per second']);
  alias('speed', 'kmh', ['km/h', 'kmh', 'kph', 'kmph', 'kilometers per hour', 'kilometres per hour']);
  alias('speed', 'mph', ['mph', 'miles per hour']);
  alias('speed', 'kn', ['kn', 'knot', 'knots']);
  alias('area', 'm2', ['m2', 'sq m', 'sqm', 'square meter', 'square meters', 'square metre', 'square metres']);
  alias('area', 'km2', ['km2', 'sq km', 'square kilometer', 'square kilometers', 'square kilometre', 'square kilometres']);
  alias('area', 'ft2', ['ft2', 'sq ft', 'sqft', 'square foot', 'square feet']);
  alias('area', 'acre', ['acre', 'acres']);
  alias('area', 'ha', ['ha', 'hectare', 'hectares']);
  alias('temp', 'c', ['c', 'celsius', 'centigrade', 'degrees celsius', 'degree celsius', 'deg c']);
  alias('temp', 'f', ['f', 'fahrenheit', 'degrees fahrenheit', 'degree fahrenheit', 'deg f']);
  alias('temp', 'k', ['k', 'kelvin']);

  function unitOf(word) {
    var w = String(word).toLowerCase().replace(/\u00b0/g, '').replace(/\s+/g, ' ').trim();
    return Object.prototype.hasOwnProperty.call(U, w) ? U[w] : null;
  }

  function convert(value, fromWord, toWord) {
    var a = unitOf(fromWord), b = unitOf(toWord);
    if (!a) return { error: 'I do not know the unit "' + fromWord + '".' };
    if (!b) return { error: 'I do not know the unit "' + toWord + '".' };
    if (a.dim !== b.dim) return { error: "You can't convert " + NAMES[a.key] + ' into ' + NAMES[b.key] + '.' };
    var out;
    if (a.dim === 'temp') {
      var c = a.key === 'c' ? value : a.key === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
      out = b.key === 'c' ? c : b.key === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    } else {
      out = value * DIMS[a.dim].f[a.key] / DIMS[b.dim].f[b.key];
    }
    return { value: out, from: a.key, to: b.key, fromName: NAMES[a.key], toName: NAMES[b.key] };
  }

  var UNIT_WORDS = '[a-z°/ ]{1,30}?';
  // "convert 5 km to miles", "72 f in celsius", "how many cm in 3 inches", "what is 10 kg in pounds"
  function parseConvert(text) {
    var s = String(text).toLowerCase().replace(/\?+$/, '').trim(), m;
    s = s.replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d)\s*°\s*/g, '$1 ');
    if ((m = new RegExp('^how many (' + UNIT_WORDS + ') (?:are |is )?(?:there )?in (?:(\\d+(?:\\.\\d+)?|an?|one) )?(' + UNIT_WORDS + ')$').exec(s))) {
      var q = m[2] ? (/^\d/.test(m[2]) ? parseFloat(m[2]) : 1) : 1;
      return { value: q, from: m[3].trim(), to: m[1].trim() };
    }
    if ((m = new RegExp('^(?:convert |what is |whats |how much is )?(-?\\d+(?:\\.\\d+)?)\\s*(' + UNIT_WORDS + ')\\s+(?:to|in|into|as)\\s+(' + UNIT_WORDS + ')$').exec(s))) {
      return { value: parseFloat(m[1]), from: m[2].trim(), to: m[3].trim() };
    }
    return null;
  }

  // ---- frames and timecode (non-drop) -------------------------------------------------------------------
  var TRUE_FPS = { 23.976: 24000 / 1001, 23.98: 24000 / 1001, 29.97: 30000 / 1001, 59.94: 60000 / 1001 };
  function trueFps(f) { return TRUE_FPS[f] || f; }
  function nominalFps(f) { return Math.round(f); }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function framesToTimecode(frames, fps) {
    var nf = nominalFps(fps), total = Math.max(0, Math.round(frames));
    var ff = total % nf, secs = Math.floor(total / nf), ss = secs % 60, mm = Math.floor(secs / 60) % 60, hh = Math.floor(secs / 3600);
    return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + ':' + pad(ff);
  }
  function timecodeToFrames(tc, fps) {
    var m = /^(\d+):(\d{2}):(\d{2}):(\d{2})$/.exec(String(tc).trim());
    if (!m) return null;
    var nf = nominalFps(fps);
    return ((+m[1] * 3600) + (+m[2] * 60) + (+m[3])) * nf + (+m[4]);
  }
  function secondsToFrames(sec, fps) { return Math.round(sec * trueFps(fps)); }
  function framesToSeconds(frames, fps) { return frames / trueFps(fps); }

  // "how many frames in 2.5 seconds at 30 fps", "how many seconds is 120 frames at 24 fps", "timecode for 1500 frames at 25 fps"
  function parseFrames(text) {
    var s = String(text).toLowerCase().replace(/\?+$/, '').trim(), m;
    var fpsM = /\b(?:at|@)\s*(\d+(?:\.\d+)?)\s*(?:fps|frames per second|frame rate)\b/.exec(s) || /\b(\d+(?:\.\d+)?)\s*fps\b/.exec(s);
    if (!fpsM) return null;
    var fps = parseFloat(fpsM[1]);
    if (!(fps > 0 && fps <= 240)) return { error: 'Frame rate should be between 1 and 240.' };
    var body = s.replace(fpsM[0], ' ').replace(/\s+/g, ' ').trim();
    if ((m = /(?:timecode|time code|tc)\b.*?(\d+)\s*frames?/.exec(body)) || (m = /(\d+)\s*frames?\b.*\b(?:in|as|to)\s+(?:timecode|time code|tc)/.exec(body))) {
      var fr = parseInt(m[1], 10);
      return { kind: 'tc', frames: fr, fps: fps, value: framesToTimecode(fr, fps) };
    }
    if ((m = /(\d{1,3}:\d{2}:\d{2}:\d{2})/.exec(body)) && /frames?/.test(body)) {
      var f2 = timecodeToFrames(m[1], fps);
      return { kind: 'tcframes', timecode: m[1], fps: fps, frames: f2 };
    }
    if ((m = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/.exec(body)) && /frames?/.test(body)) {
      var sec = parseFloat(m[1]) * (/^m/.test(m[2]) ? 60 : 1);
      return { kind: 'frames', seconds: sec, fps: fps, frames: secondsToFrames(sec, fps) };
    }
    if ((m = /(\d+)\s*frames?\b/.exec(body)) && /seconds?|secs?|long|duration|time/.test(body)) {
      var f3 = parseInt(m[1], 10);
      return { kind: 'seconds', frames: f3, fps: fps, seconds: framesToSeconds(f3, fps) };
    }
    return null;
  }

  return { evaluate: evaluate, natural: natural, wordsToExpr: wordsToExpr, fmtNum: fmtNum, convert: convert, parseConvert: parseConvert, unitOf: unitOf,
    parseFrames: parseFrames, framesToTimecode: framesToTimecode, timecodeToFrames: timecodeToFrames, secondsToFrames: secondsToFrames, framesToSeconds: framesToSeconds, DIMS: DIMS, NAMES: NAMES };
});
