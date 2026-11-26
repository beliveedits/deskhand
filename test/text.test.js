var H = require('./helpers'), T = require('../src/text');
var t = H.t, eq = H.eq, ok = H.ok;

H.group('clean');
[
  ['Hey Deskhand, could you please open Chrome for me.', 'open Chrome'],
  ['hey desk hand open notepad', 'open notepad'],
  ['Deskhand: what is the time?', 'what is the time'],
  ['please set a timer for 5 minutes', 'set a timer for 5 minutes'],
  ['Can you please turn the volume down?', 'turn the volume down'],
  ["I'd like you to open spotify", 'open spotify'],
  ['I want you to take a screenshot', 'take a screenshot'],
  ['okay open chrome', 'open chrome'],
  ["what's the date", 'what is the date'],
  ["let's open downloads", 'open downloads'],
  ['open chrome please', 'open chrome'],
  ['open chrome, thanks!', 'open chrome'],
  ['  open   chrome  ', 'open chrome'],
  ['Note: Buy cables.', 'Note: Buy cables']
].forEach(function (c) { t(c[0], function () { eq(T.clean(c[0]), c[1]); }); });

H.group('numberWords');
[
  ['volume to fifty', 'volume to 50'], ['volume to fifty five', 'volume to 55'], ['volume to twenty-five', 'volume to 25'],
  ['a timer for two minutes', 'a timer for 2 minutes'], ['one hundred and twenty', '120'], ['two thousand twenty five', '2025'],
  ['open the first one', 'open the first one'], ['open chrome', 'open chrome'], ['set volume to one hundred', 'set volume to 100'],
  ['a hundred', 'a hundred'], ['three plus four', '3 plus 4'], ['nineteen', '19'], ['twenty one apples', '21 apples'],
  ['that one', 'that one'], ['one more', '1 more'], ['ten fifteen', '10 15']
].forEach(function (c) { t(c[0] + ' -> ' + c[1], function () { eq(T.numberWords(c[0]), c[1]); }); });

H.group('parseDuration');
function dur(s) { var d = T.parseDuration(s); return d ? d.ms / 1000 : null; }
[
  ['in 10 minutes', 600], ['for 25 minutes', 1500], ['5 min', 300], ['90 seconds', 90], ['an hour', 3600], ['a minute', 60],
  ['half an hour', 1800], ['half hour', 1800], ['an hour and a half', 5400], ['two and a half hours', 9000],
  ['1 hour 30 minutes', 5400], ['1 hour and 30 minutes', 5400], ['1h30m', 5400], ['90s', 90], ['25m', 1500], ['1.5 hours', 5400],
  ['ten minutes', 600], ['twenty five minutes', 1500], ['two hours', 7200], ['an hour and 15 minutes', 4500], ['in 2 hrs', 7200],
  ['45 secs', 45], ['half a minute', 30], ['in 2 days', 172800], ['a day', 86400], ['1 week', 604800], ['in 3 days and 2 hours', 266400], ['two days', 172800]
].forEach(function (c) { t(c[0], function () { eq(dur(c[0]), c[1]); }); });
t('no duration', function () { eq(T.parseDuration('open chrome'), null); eq(T.parseDuration('buy 5 apples'), null); });
t('span covers the "in"', function () { var d = T.parseDuration('remind me to call mom in 10 minutes'); eq('remind me to call mom in 10 minutes'.slice(0, d.start).trim(), 'remind me to call mom'); });
t('two separate durations are not merged', function () { eq(dur('5 minutes then call bob in 10 minutes'), 300); });

H.group('parseClock');
function at(s, now) { var c = T.parseClock(s, now); return c ? [c.at.getHours(), c.at.getMinutes(), Math.round((T.startOfDay(c.at) - T.startOfDay(now)) / 86400000)] : null; }
var now = new Date(2026, 10, 26, 14, 30, 0); // Thu 26 Nov 2026 14:30
[
  ['at 6pm', [18, 0, 0]], ['at 6 pm', [18, 0, 0]], ['at 6:15pm', [18, 15, 0]], ['at 9am', [9, 0, 1]], ['at 5pm', [17, 0, 0]],
  ['at 17:45', [17, 45, 0]], ['at noon', [12, 0, 1]], ['at midnight', [0, 0, 1]], ['tomorrow at 9am', [9, 0, 1]],
  ['tomorrow at 9', [9, 0, 1]], ['tomorrow at 3', [15, 0, 1]], ['at 6', [18, 0, 0]], ['at 3', [15, 0, 0]], ['at six pm', [18, 0, 0]],
  ['at 12:30 pm', [12, 30, 1]], ['at 12 am', [0, 0, 1]], ['tomorrow 7am', [7, 0, 1]], ['at 2:45 pm', [14, 45, 0]], ['at 2:45 am', [2, 45, 1]]
].forEach(function (c) { t(c[0], function () { eq(at(c[0], now), c[1]); }); });
t('no clock', function () { eq(T.parseClock('open chrome', now), null); eq(T.parseClock('volume to 50', now), null); });
t('bad hour rejected', function () { eq(T.parseClock('at 25pm', now), null); });

H.group('parseWhen');
t('duration', function () { var w = T.parseWhen('remind me in 10 minutes to stretch', now); eq(w.kind, 'duration'); eq(w.ms, 600000); });
t('clock', function () { var w = T.parseWhen('remind me at 6pm to stretch', now); eq(w.kind, 'clock'); eq(w.at.getHours(), 18); });
t('none', function () { eq(T.parseWhen('hello there', now), null); });

H.group('format');
t('fmtDuration', function () { eq(T.fmtDuration(90000), '1 minute 30 seconds'); eq(T.fmtDuration(3600000), '1 hour'); eq(T.fmtDuration(5400000), '1 hour 30 minutes'); eq(T.fmtDuration(45000), '45 seconds'); });
t('fmtClock', function () { eq(T.fmtClock(new Date(2026, 0, 1, 0, 5)), '12:05 am'); eq(T.fmtClock(new Date(2026, 0, 1, 13, 0)), '1:00 pm'); eq(T.fmtClock(new Date(2026, 0, 1, 12, 0)), '12:00 pm'); });
t('fmtDay', function () { eq(T.fmtDay(new Date(2026, 10, 26, 20), now), 'today'); eq(T.fmtDay(new Date(2026, 10, 27, 1), now), 'tomorrow'); eq(T.fmtDay(new Date(2026, 10, 30, 1), now), 'Monday 30 Nov'); });

H.done('text');
