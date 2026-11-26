var H = require('./helpers'), C = require('../src/calc'), K = require('../src/clock');
var t = H.t, eq = H.eq, ok = H.ok, near = H.near;

H.group('evaluate');
[['1+2', 3], ['2*3+4', 10], ['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-5+2', -3], ['10/4', 2.5], ['10 mod 3', 1], ['2(3+4)', 14], ['sqrt(16)', 4],
 ['100+10%', 110], ['100-10%', 90], ['50%*200', 100], ['1,000+500', 1500], ['5k+2k', 7000], ['2 lakh + 3 lakh', 500000], ['1 crore / 4', 2500000], ['sin(30)', 0.5],
 ['pi*2', 2 * Math.PI], ['2pi', 2 * Math.PI], ['abs(-3)', 3], ['round(2.6)', 3], ['--3', 3], ['.5+.5', 1], ['3 million', 3e6]
].forEach(function (c) { t(c[0], function () { near(C.evaluate(c[0]), c[1], 1e-9); }); });
['1/0', '5 mod 0', '2+', '(1+2', '1+2)', 'foo(3)', 'sqrt 4', 'process.exit()', '1;2', 'alert(1)', '', '2**', 'a', 'sqrt(-1)', '9^9^9^9', 'x'].forEach(function (b) {
  t('rejects ' + JSON.stringify(b), function () { var threw = false; try { C.evaluate(b); } catch (e) { threw = true; ok(e.calc, 'friendly error'); } ok(threw); });
});
t('long input refused', function () { var threw = false; try { C.evaluate(new Array(300).join('1+')); } catch (e) { threw = true; } ok(threw); });
t('deep nesting refused', function () { var s = new Array(60).join('(') + '1' + new Array(60).join(')'); var threw = false; try { C.evaluate(s); } catch (e) { threw = true; ok(e.calc); } ok(threw); });
t('no code execution', function () { var threw = false; try { C.evaluate('constructor'); } catch (e) { threw = true; } ok(threw); });

H.group('natural');
[['15% of 2400', 360], ['15 percent of 2400', 360], ['what is 15 percent of 200', 30], ['add 18% to 1000', 1180], ['add 18 percent gst to 1000', 1180], ['20% off 500', 400],
 ['20 percent discount on 500', 400], ['increase 100 by 10%', 110], ['reduce 200 by 25 percent', 150], ['subtract 10% from 50', 45], ['30 is what percent of 120', 25],
 ['what percent is 30 of 120', 25], ['12 * (3 + 4)', 84], ['2 plus 2', 4], ['10 divided by 4', 2.5], ['2 to the power of 10', 1024], ['square root of 144', 12], ['9 squared', 81],
 ['5 lakh plus 2 lakh', 700000], ['2 crore / 4', 5000000], ['5 times 6 minus 2', 28], ['3 x 4', 12], ['100 + 10%', 110], ['7 minus 10', -3], ['1,200 plus 300', 1500], ['2 cubed', 8],
 ['10 percent of 5 lakh', 50000]
].forEach(function (c) { t(c[0], function () { var r = C.natural(c[0]); ok(r, 'parsed'); near(r.value, c[1], 1e-9); }); });
['open chrome', '42', 'volume 50', 'set timer for 5 minutes', 'hello'].forEach(function (b) { t('not a sum: ' + b, function () { eq(C.natural(b), null); }); });

H.group('fmtNum');
t('format', function () { eq(C.fmtNum(1234567.891, 'en-US'), '1,234,567.891'); eq(C.fmtNum(0.1 + 0.2, 'en-US'), '0.3'); eq(C.fmtNum(0), '0'); eq(C.fmtNum(5, 'en-US'), '5'); eq(C.fmtNum(1234567, 'en-IN'), '12,34,567'); eq(C.fmtNum(3.10685596, 'en-US'), '3.106856'); });

H.group('convert');
function cv(v, a, b) { var r = C.convert(v, a, b); return r.error ? r : r.value; }
[[5, 'km', 'miles', 3.1068559611866697], [72, 'f', 'c', 22.22222222222222], [100, 'c', 'f', 212], [0, 'k', 'c', -273.15], [1, 'gb', 'mb', 1000], [1, 'gib', 'mib', 1024],
 [10, 'kg', 'pounds', 22.046226218487757], [1, 'mile', 'km', 1.609344], [60, 'mph', 'km/h', 96.56064], [1, 'acre', 'hectares', 0.4046856422], [2, 'hours', 'minutes', 120],
 [500, 'ml', 'cups', 2.113376], [12, 'inches', 'cm', 30.48], [6, 'feet', 'm', 1.8288], [1, 'gallon', 'liters', 3.785411784], [100, 'kmh', 'mph', 62.13711922373339], [1, 'week', 'days', 7],
 [1, 'tonne', 'kg', 1000], [16, 'oz', 'lb', 1], [3, 'tbsp', 'tsp', 9], [1, 'sq ft', 'm2', 0.09290304]
].forEach(function (c) { t(c[0] + ' ' + c[1] + ' -> ' + c[2], function () { near(cv(c[0], c[1], c[2]), c[3], Math.abs(c[3]) * 1e-6 + 1e-9); }); });
t('wrong dimension', function () { var r = C.convert(5, 'kg', 'km'); ok(r.error && /can't convert/.test(r.error)); });
t('unknown unit', function () { ok(C.convert(5, 'florps', 'km').error); ok(C.convert(5, 'km', 'usd').error); });
t('parse', function () {
  eq(C.parseConvert('convert 5 km to miles'), { value: 5, from: 'km', to: 'miles' });
  eq(C.parseConvert('72 f in celsius'), { value: 72, from: 'f', to: 'celsius' });
  eq(C.parseConvert('how many cm in 3 inches'), { value: 3, from: 'inches', to: 'cm' });
  eq(C.parseConvert('how many feet in a mile'), { value: 1, from: 'mile', to: 'feet' });
  eq(C.parseConvert('what is 10 kg in pounds'), { value: 10, from: 'kg', to: 'pounds' });
  eq(C.parseConvert('convert 98.6 °f to c'), { value: 98.6, from: 'f', to: 'c' });
  eq(C.parseConvert('convert 1,500 ml to l'), { value: 1500, from: 'ml', to: 'l' });
  eq(C.parseConvert('open chrome'), null);
});
t('degrees celsius alias', function () { near(cv(100, 'degrees celsius', 'degrees fahrenheit'), 212, 1e-9); });

H.group('frames');
t('seconds to frames', function () { var r = C.parseFrames('how many frames in 2.5 seconds at 30 fps'); eq(r.kind, 'frames'); eq(r.frames, 75); });
t('frames to seconds', function () { var r = C.parseFrames('how many seconds is 120 frames at 24 fps'); eq(r.kind, 'seconds'); near(r.seconds, 5, 1e-9); });
t('timecode', function () { var r = C.parseFrames('timecode for 1500 frames at 25 fps'); eq(r.kind, 'tc'); eq(r.value, '00:01:00:00'); });
t('timecode non-drop at 29.97', function () { eq(C.framesToTimecode(1800, 29.97), '00:01:00:00'); near(C.framesToSeconds(1800, 29.97), 60.06, 1e-3); });
t('23.976', function () { eq(C.secondsToFrames(24, 23.976), 575); });
t('minutes', function () { eq(C.parseFrames('frames in 2 minutes at 24 fps').frames, 2880); });
t('timecode to frames', function () { eq(C.timecodeToFrames('00:01:30:12', 24), 90 * 24 + 12); eq(C.timecodeToFrames('bad', 24), null); eq(C.framesToTimecode(90000, 30), '00:50:00:00'); });
t('tc to frames phrase', function () { eq(C.parseFrames('how many frames is 00:00:10:00 at 25 fps').frames, 250); });
t('bad fps', function () { ok(C.parseFrames('frames in 2 seconds at 500 fps').error); eq(C.parseFrames('frames in 2 seconds at 0 fps').error !== undefined || C.parseFrames('frames in 2 seconds at 0 fps') === null, true); });
t('not frames', function () { eq(C.parseFrames('open chrome'), null); });

H.group('clock');
var fixed = new Date(Date.UTC(2026, 10, 26, 20, 0, 0)); // 20:00 UTC = 01:30 IST next day
t('tokyo', function () { var r = K.timeIn('Tokyo', fixed, 'Asia/Kolkata'); eq(r.time, '5:00 am'); eq(r.label, 'Tokyo'); ok(/Fri 27 Nov/.test(r.text)); });
t('new york', function () { var r = K.timeIn('new york', fixed); eq(r.time, '3:00 pm'); });
t('london winter', function () { eq(K.timeIn('london', fixed).time, '8:00 pm'); });
t('relative day', function () { ok(/tomorrow for you/.test(K.timeIn('tokyo', new Date(Date.UTC(2026, 10, 26, 18, 0, 0)), 'America/New_York').text)); });
t('yesterday for you', function () { ok(/yesterday for you/.test(K.timeIn('new york', new Date(Date.UTC(2026, 10, 26, 2, 0, 0)), 'Asia/Tokyo').text)); });
t('india', function () { eq(K.timeIn('india', fixed).time, '1:30 am'); eq(K.timeIn('IST', fixed).label, 'India'); });
t('unknown city', function () { eq(K.timeIn('atlantis', fixed), null); });
t('local text', function () { eq(K.localTimeText(new Date(2026, 10, 26, 14, 5), 'en-US'), 'It is 2:05 pm.'); ok(/Thursday, November 26, 2026/.test(K.localDateText(new Date(2026, 10, 26, 14, 5), 'en-US'))); });

H.done('calc');
