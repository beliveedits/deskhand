var H = require('./helpers'), fs = require('fs'), os = require('os'), path = require('path');
var D = require('../src/doctor'), P = require('../src/platform');
var eq = H.eq, ok = H.ok;
function home() { var h = fs.mkdtempSync(path.join(os.tmpdir(), 'dhd-')); ['Downloads', 'Documents', 'Desktop', 'Pictures'].forEach(function (d) { fs.mkdirSync(path.join(h, d)); }); return h; }
function fakeRun(table) {
  var calls = [];
  async function one(spec) { var key = spec.ps ? 'ps' : spec.osa ? 'osa' : spec.cmd; var v = table[key]; if (typeof v === 'function') v = v(spec); return v || { ok: false, code: 1, stdout: '', stderr: 'no' }; }
  var r = async function (spec) {
    calls.push(spec);
    if (spec.candidates) { var last = null; for (var i = 0; i < spec.candidates.length; i++) { last = await one(spec.candidates[i]); if (last.ok) return last; } return last; }
    return one(spec);
  };
  r.calls = calls; return r;
}

(async function () {
  H.group('doctor');
  await H.tAsync('Windows: everything works', async function () {
    var h = home(); var run = fakeRun({ ps: function (s) { var t = P.psScript(s); if (/PSVersionTable/.test(t)) return { ok: true, stdout: '5.1.22621.1' }; if (/Measure-Object/.test(t)) return { ok: true, stdout: '184' }; if (/Win32_Battery/.test(t)) return { ok: true, stdout: '{"EstimatedChargeRemaining":77,"BatteryStatus":1}' }; if (/Shell\.Application/.test(t)) return { ok: true, stdout: JSON.stringify({ desktop: path.join(h, 'Desktop'), documents: path.join(h, 'Documents'), pictures: path.join(h, 'Pictures'), videos: h, music: h, downloads: path.join(h, 'Downloads') }) }; return { ok: false }; } });
    var r = await D.runChecks({ os: 'win32', run: run, which: function (n) { return n === 'shutdown.exe' ? 'C:\\Windows\\System32\\shutdown.exe' : null; }, home: h, dataDir: path.join(h, '.dh') });
    eq(r.filter(function (x) { return x.status === 'fail'; }), []); ok(r.some(function (x) { return /PowerShell runs/.test(x.name); })); ok(r.some(function (x) { return /184 apps/.test(x.detail); })); ok(r.some(function (x) { return x.name === 'Battery' && /77%/.test(x.detail); }));
  });
  await H.tAsync('Windows: PowerShell blocked is a clear failure', async function () {
    var h = home(); var r = await D.runChecks({ os: 'win32', run: fakeRun({}), which: function () { return null; }, home: h, dataDir: path.join(h, '.dh') });
    var f = r.filter(function (x) { return x.status === 'fail'; }); eq(f.length, 1); ok(/PowerShell does not run/.test(f[0].name)); ok(/policy/.test(f[0].fix));
  });
  await H.tAsync('macOS', async function () {
    var h = home(); var run = fakeRun({ osa: { ok: true, stdout: 'ok' }, pmset: { ok: true, stdout: " -InternalBattery-0 (id=1)\t64%; charging; 1:10 remaining present: true" } });
    var r = await D.runChecks({ os: 'darwin', run: run, which: function (n) { return '/usr/bin/' + n; }, home: h, dataDir: path.join(h, '.dh') });
    eq(r.filter(function (x) { return x.status === 'fail'; }), []); ok(r.some(function (x) { return x.name === 'Battery' && /64%/.test(x.detail); })); ok(r.some(function (x) { return x.status === 'info' && /Screen Recording/.test(x.detail); }));
    var bad = await D.runChecks({ os: 'darwin', run: fakeRun({}), which: function () { return null; }, home: h, dataDir: path.join(h, '.dh') }); ok(bad.some(function (x) { return x.status === 'fail' && /osascript/.test(x.name); }));
  });
  await H.tAsync('Linux: lists exactly what is missing', async function () {
    var h = home(); var have = { 'xdg-open': 1, pactl: 1, systemctl: 1, pkill: 1, xclip: 1 };
    var r = await D.runChecks({ os: 'linux', run: fakeRun({}), which: function (n) { return have[n] ? '/usr/bin/' + n : null; }, home: h, dataDir: path.join(h, '.dh') });
    var by = function (n) { return r.filter(function (x) { return x.name === n; })[0]; };
    eq(by('Volume and mute').status, 'ok'); ok(/pactl/.test(by('Volume and mute').detail)); eq(by('Play, pause, next').status, 'warn'); ok(/playerctl/.test(by('Play, pause, next').fix)); eq(by('Screenshots').status, 'warn'); eq(by('Clipboard').status, 'ok'); eq(by('Notifications for timers').status, 'warn');
  });
  await H.tAsync('--live runs only the three harmless tests', async function () {
    var h = home(); var run = fakeRun({ 'notify-send': { ok: true }, 'wl-copy': { ok: true }, 'gnome-screenshot': function (s) { fs.writeFileSync(s.args[s.args.length - 1], new Array(300).join('x')); return { ok: true }; } });
    var r = await D.runChecks({ os: 'linux', live: true, run: run, which: function (n) { return '/usr/bin/' + n; }, home: h, dataDir: path.join(h, '.dh') });
    var live = r.filter(function (x) { return /^Live:/.test(x.name); }); eq(live.length, 3); eq(live.map(function (x) { return x.status; }), ['ok', 'ok', 'ok']);
    var sent = run.calls.map(function (c) { return c.cmd || (c.candidates && c.candidates[0].cmd) || 'x'; }); eq(sent.length, 3); ok(sent.every(function (c) { return /^(notify-send|wl-copy|gnome-screenshot)$/.test(c); }));
    var none = fakeRun({}); await D.runChecks({ os: 'linux', live: false, run: none, which: function () { return null; }, home: h, dataDir: path.join(h, '.dh') }); eq(none.calls.length, 0);
  });
  await H.tAsync('the report and exit code', async function () {
    var h = home(), lines = []; var code = await D.doctor({ os: 'win32', run: fakeRun({}), which: function () { return null; }, home: h, dataDir: path.join(h, '.dh'), log: function (l) { lines.push(l); } }); eq(code, 1); ok(lines.some(function (l) { return /\[FAIL\]/.test(l); }));
    lines = []; code = await D.doctor({ os: 'linux', run: fakeRun({}), which: function (n) { return '/usr/bin/' + n; }, home: h, dataDir: path.join(h, '.dh'), log: function (l) { lines.push(l); } }); eq(code, 0);
  });
  await H.tAsync('which() finds programs on a PATH and ignores missing ones', async function () {
    var d = fs.mkdtempSync(path.join(os.tmpdir(), 'dhw-')); var f = path.join(d, 'toolx'); fs.writeFileSync(f, '#!/bin/sh\n'); fs.chmodSync(f, 0o755); fs.writeFileSync(path.join(d, 'plain'), 'x'); fs.chmodSync(path.join(d, 'plain'), 0o644);
    eq(D.which('toolx', 'linux', { PATH: d + ':/nonexistent' }), f); eq(D.which('plain', 'linux', { PATH: d }), null); eq(D.which('nope', 'linux', { PATH: d }), null);
  });
  H.done('doctor');
})();
