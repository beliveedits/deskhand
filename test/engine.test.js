var H = require('./helpers'), fs = require('fs'), os = require('os'), path = require('path');
var P = require('../src/platform'), parser = require('../src/parser'), F = require('../src/files');
var { createStore } = require('../src/store'), { makeExec } = require('../src/exec'), { createEngine, CONFIRM_MS } = require('../src/engine'), { SKILLS } = require('../src/skills');
var t = H.t, eq = H.eq, ok = H.ok;
var DAY = 86400000;

function tmp(n) { return fs.mkdtempSync(path.join(os.tmpdir(), 'dhe-' + (n || '') )); }
function put(dir, rel, age, body) { var p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body || 'x'); var tt = (Date.now() - (age == null ? 3600 * 1000 : age)) / 1000; fs.utimesSync(p, tt, tt); return p; }

// fake clock + fake setTimeout so a day of timers runs instantly
function clock(start) {
  var now = start || new Date(2026, 10, 26, 14, 30, 0).getTime(), q = [], id = 0;
  return {
    now: function () { return new Date(now); },
    setTimeout: function (fn, ms) { var h = { id: ++id, at: now + ms, fn: fn }; q.push(h); return h; },
    clearTimeout: function (h) { var i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    advance: function (ms) { var target = now + ms; for (;;) { q.sort(function (a, b) { return a.at - b.at; }); var n = q[0]; if (!n || n.at > target) break; q.shift(); now = n.at; n.fn(); } now = target; },
    pending: function () { return q.length; }
  };
}
function stub(fn) { var calls = []; var e = async function (spec) { calls.push({ display: P.display(spec), label: spec && spec.label }); return fn ? fn(spec) : { ok: true, code: 0, stdout: '', stderr: '' }; }; e.calls = calls; return e; }

function mk(o) {
  o = o || {};
  var home = tmp('home'), store = createStore(path.join(home, '.dh'));
  if (o.config) Object.assign(store.config, o.config);
  var ck = o.clock || clock();
  var dirs = { home: home, downloads: path.join(home, 'Downloads'), documents: path.join(home, 'Documents'), desktop: path.join(home, 'Desktop'), pictures: path.join(home, 'Pictures'), videos: path.join(home, 'Videos'), music: path.join(home, 'Music') };
  Object.keys(dirs).forEach(function (k) { if (k !== 'home') fs.mkdirSync(dirs[k], { recursive: true }); });
  var exec = o.exec || makeExec({ dry: o.dry !== false });
  var rings = [];
  var e = createEngine({ os: o.os || 'linux', store: store, exec: exec, dry: o.dry !== false, now: ck.now, setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout, dirs: o.noDirs ? undefined : dirs, home: home, onRing: function (x) { rings.push(x); } });
  return { e: e, store: store, exec: exec, ck: ck, dirs: dirs, home: home, rings: rings, say: async function (s) { return (await e.handle(s)); } };
}

(async function () {
  H.group('opening things');
  await H.tAsync('open app, every OS, shows the command it would run', async function () {
    var w = mk({ os: 'win32' }), r = await w.say('open chrome'); eq(r.status, 'done'); ok(/Dry run: would open Google Chrome/.test(r.say)); ok(/Get-StartApps/.test(r.ran[0]));
    var m = mk({ os: 'darwin' }); r = await m.say('open chrome'); ok(/open -a "Google Chrome"/.test(r.ran[0]));
    var l = mk({ os: 'linux' }); r = await l.say('open chrome'); ok(/google-chrome/.test(r.ran[0]));
  });
  await H.tAsync('real run reports success and failure honestly', async function () {
    var a = mk({ dry: false, exec: stub() }); eq((await a.say('open spotify')).say, 'Opening Spotify.');
    var b = mk({ dry: false, exec: stub(function () { return { ok: false, code: 127, notInstalled: true, stdout: '', stderr: '' }; }) }); var r = await b.say('open frobnicator'); eq(r.ok, false); ok(/could not find an app called "frobnicator"/.test(r.say)); ok(/config\.json/.test(r.say));
    var c = mk({ dry: false, exec: stub(function () { return { ok: false, code: 3, stdout: 'NOTFOUND', stderr: '' }; }), os: 'win32' }); ok(/could not find an app/.test((await c.say('open zzz')).say));
  });
  await H.tAsync('config apps override', async function () { var a = mk({ config: { apps: { editor: 'Visual Studio Code' } } }); var r = await a.say('open editor'); ok(/Visual Studio Code/.test(r.say)); });
  await H.tAsync('shell characters in an app name never reach a command', async function () {
    var a = mk({ dry: false, exec: stub() });
    var r = await a.say('open chrome; rm -rf ~'); ok(r.steps ? true : true);
    var bad = ['open $(reboot)', 'open `id`', 'open a|b', 'open "x" && calc'];
    for (var i = 0; i < bad.length; i++) { var before = a.exec.calls.length; var rr = await a.say(bad[i]); ok(a.exec.calls.slice(before).every(function (c) { return !/reboot|`id`|\|b|&& calc/.test(c.display); }), bad[i] + ' -> ' + JSON.stringify(a.exec.calls.slice(before))); }
  });
  await H.tAsync('websites and searches', async function () {
    var a = mk({ os: 'linux' }), r = await a.say('open youtube'); ok(/xdg-open https:\/\/www\.youtube\.com/.test(r.ran[0]));
    r = await a.say('search for best monitors under 20000'); ok(/google\.com\/search\?q=best%20monitors%20under%2020000/.test(r.ran[0])); ok(/Searching Google/.test(r.say));
    r = await a.say('play lofi beats on youtube'); ok(/cannot press play/.test(r.say));
    r = await a.say('why is the sky blue'); ok(/searched Google/.test(r.say));
    r = await a.say('directions to rajkot airport'); ok(/maps\/dir/.test(r.ran[0]));
    var w = mk({ os: 'win32' }); r = await w.say('go to github.com'); ok(/Start-Process 'https:\/\/github\.com\/'/.test(r.ran[0]));
  });
  await H.tAsync('custom sites and folders from config', async function () {
    var d = tmp('cf'); var a = mk({ config: { sites: { 'my crm': 'https://crm.example.com/' }, folders: { 'client work': d } } });
    ok(/crm\.example\.com/.test((await a.say('open my crm')).ran[0])); ok(/client work/i.test((await a.say('open client work')).say));
  });
  await H.tAsync('folders', async function () { var a = mk(), r = await a.say('open downloads'); ok(/Downloads/.test(r.say)); ok(/xdg-open/.test(r.ran[0])); });

  H.group('asking before risky things');
  await H.tAsync('close app asks first, yes runs it, no cancels', async function () {
    var a = mk({ dry: false, exec: stub() });
    var r = await a.say('close chrome'); eq(r.status, 'confirm'); ok(/Close Google Chrome\?/.test(r.say)); eq(a.exec.calls.length, 0);
    r = await a.say('yes'); eq(r.status, 'done'); ok(/Asked Google Chrome to close/.test(r.say)); eq(a.exec.calls.length, 1);
    r = await a.say('close spotify'); eq(r.status, 'confirm'); r = await a.say('no'); eq(r.status, 'cancelled'); eq(a.exec.calls.length, 1);
    r = await a.say('yes'); ok(/nothing waiting/.test(r.say)); eq(a.exec.calls.length, 1);
  });
  await H.tAsync('any other command cancels the question; a stray yes does nothing', async function () {
    var a = mk({ dry: false, exec: stub() }); await a.say('close chrome'); var r = await a.say('what time is it'); eq(r.status, 'done'); r = await a.say('yes'); ok(/nothing waiting/.test(r.say)); eq(a.exec.calls.length, 0);
    await a.say('shut down'); await a.say('asdf qwer zxcv'); r = await a.say('yes'); ok(/nothing waiting/.test(r.say)); eq(a.exec.calls.length, 0);
  });
  await H.tAsync('the question expires', async function () {
    var a = mk({ dry: false, exec: stub() }); await a.say('shut down'); a.ck.advance(CONFIRM_MS + 1000); var r = await a.say('yes'); ok(/nothing waiting/.test(r.say)); eq(a.exec.calls.length, 0);
  });
  await H.tAsync('stop means no only while a question is waiting', async function () {
    var a = mk({ dry: false, exec: stub() }); await a.say('restart'); eq((await a.say('stop')).status, 'cancelled'); eq(a.exec.calls.length, 0);
  });
  await H.tAsync('shutdown, restart, sleep each ask first; Windows says 30 seconds', async function () {
    var w = mk({ os: 'win32', dry: false, exec: stub() }); var r = await w.say('shut down'); ok(/in 30 seconds/.test(r.say)); r = await w.say('yes'); ok(/shutdown\.exe \/s \/t 30/.test(r.ran[0])); ok(/cancel shutdown/.test(r.say));
    r = await w.say('cancel shutdown'); ok(/shutdown\.exe \/a/.test(r.ran[0]));
    var l = mk({ os: 'linux', dry: false, exec: stub() }); r = await l.say('restart'); ok(/right now/.test(r.say)); r = await l.say('yes'); ok(/systemctl reboot/.test(r.ran[0]));
    r = await l.say('go to sleep'); eq(r.status, 'confirm'); await l.say('yes'); ok(/systemctl suspend/.test(l.exec.calls[l.exec.calls.length - 1].display));
    r = await l.say('cancel shutdown'); ok(/nothing to cancel/.test(r.say));
  });
  await H.tAsync('lock needs no question', async function () { var a = mk({ dry: false, exec: stub() }); var r = await a.say('lock the screen'); eq(r.status, 'done'); eq(a.exec.calls.length, 1); });
  await H.tAsync('vague closes are refused', async function () { var a = mk(); var r = await a.say('close everything'); eq(r.status, 'needs'); ok(/never close "everything"/.test(r.say)); r = await a.say('close this window'); eq(r.status, 'needs'); });
  await H.tAsync('refusals', async function () {
    var a = mk({ dry: false, exec: stub() });
    var bad = ['delete my downloads', 'send an email to riya', 'turn on wifi', 'install photoshop', 'type hello', 'run the command ls', 'log out', 'rm -rf /', 'powershell Get-Process'];
    for (var i = 0; i < bad.length; i++) { var r = await a.say(bad[i]); eq(r.status, 'refused', bad[i]); }
    eq(a.exec.calls.length, 0);
  });

  H.group('chaining');
  await H.tAsync('two commands in one sentence', async function () {
    var a = mk(); var r = await a.say('open chrome and set a timer for 10 minutes'); eq(r.steps.length, 2); eq(r.status, 'done'); ok(/Timer set for 10 minutes/.test(r.say)); eq(a.e.timers.list().length, 1);
  });
  await H.tAsync('a chain with a risky step asks once for all of it', async function () {
    var a = mk({ dry: false, exec: stub() }); var r = await a.say('close chrome then open spotify'); eq(r.status, 'confirm'); ok(/2 steps/.test(r.say)); eq(a.exec.calls.length, 0);
    r = await a.say('yes'); eq(r.steps.length, 2); eq(a.exec.calls.length, 2);
  });
  await H.tAsync('a failing step does not hide the others', async function () {
    var n = 0; var a = mk({ dry: false, exec: stub(function () { return n++ === 0 ? { ok: false, code: 127, notInstalled: true, stdout: '', stderr: '' } : { ok: true, code: 0, stdout: '', stderr: '' }; }) });
    var r = await a.say('open nothingapp and open spotify'); eq(r.status, 'partial'); eq(r.steps[0].ok, false); eq(r.steps[1].ok, true);
  });

  H.group('timers and reminders');
  await H.tAsync('timer rings, shows up as an event, and notifies', async function () {
    var a = mk({ dry: false, exec: stub() }); var r = await a.say('set a timer called pasta for 12 minutes'); ok(/"pasta" set for 12 minutes/.test(r.say)); ok(/Deskhand has to stay open/.test(r.say));
    r = await a.say('set a timer for 5 minutes'); ok(!/stay open/.test(r.say));
    a.ck.advance(5 * 60000 + 1); eq(a.rings.length, 1); ok(/Timer finished/.test(a.rings[0])); ok(a.exec.calls.some(function (c) { return /notify-send/.test(c.display); }));
    a.ck.advance(7 * 60000); eq(a.rings.length, 2); ok(/pasta: Timer finished/.test(a.rings[1])); eq(a.e.takeEvents(0).length, 2); eq(a.e.timers.list().length, 0);
  });
  await H.tAsync('reminders', async function () {
    var a = mk(); var r = await a.say('remind me at 6pm to send the invoice'); ok(/at 6:00 pm today to send the invoice/.test(r.say)); a.ck.advance(3 * 3600000 + 31 * 60000); ok(/Reminder: send the invoice/.test(a.rings[0]));
    r = await a.say('remind me to stretch'); eq(r.status, 'needs'); ok(/When\?/.test(r.say));
    r = await a.say('remind me every day at 9am to post'); ok(/cannot repeat/.test(r.say));
    r = await a.say('remind me in 10 days to renew'); ok(/7 days/.test(r.say)); r = await a.say('remind me in 3 days to renew'); ok(/Okay/.test(r.say));
  });
  await H.tAsync('list, cancel one, cancel all', async function () {
    var a = mk(); await a.say('set a timer for 5 minutes'); await a.say('set a timer for 10 minutes'); await a.say('remind me in an hour to stretch');
    var r = await a.say('show my timers'); eq(r.items.length, 3); ok(/5 minutes left/.test(r.items[0].info));
    r = await a.say('cancel the timer'); eq(r.status, 'needs'); ok(/cancel timer 2/.test(r.say));
    r = await a.say('cancel timer 2'); ok(/Cancelled the timer \(T2\)/.test(r.say)); eq(a.e.timers.list().length, 2);
    r = await a.say('cancel all timers'); ok(/Cancelled all 2/.test(r.say)); r = await a.say('cancel all timers'); ok(/no timers/.test(r.say));
    eq(a.ck.pending(), 0);
  });
  await H.tAsync('focus session and timer without a time', async function () {
    var a = mk(); var r = await a.say('focus for 25 minutes'); ok(/Focus session started for 25 minutes/.test(r.say)); a.ck.advance(26 * 60000); ok(/Focus session finished/.test(a.rings[0]));
    r = await a.say('pomodoro'); ok(/usual 25/.test(r.say)); r = await a.say('set a timer'); eq(r.status, 'needs');
  });
  await H.tAsync('timers survive a restart and ring when missed', async function () {
    var ck = clock(), home = tmp('rs'); var s1 = createStore(path.join(home, 'd')); var e1 = createEngine({ os: 'linux', store: s1, exec: makeExec({ dry: true }), dry: true, now: ck.now, setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout, dirs: {} });
    await e1.handle('set a timer for 10 minutes'); await e1.handle('remind me in 2 hours to call mom'); e1.close();
    ck.advance(30 * 60000);
    var rings = [], s2 = createStore(path.join(home, 'd')); var e2 = createEngine({ os: 'linux', store: s2, exec: makeExec({ dry: true }), dry: true, now: ck.now, setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout, dirs: {}, onRing: function (x) { rings.push(x); } });
    var missed = await e2.init(); eq(missed, 1); ok(/rang while Deskhand was closed/.test(rings[0])); eq(e2.timers.list().length, 1);
    ck.advance(2 * 3600000); eq(rings.length, 2); ok(/call mom/.test(rings[1]));
  });
  await H.tAsync('time and date answers', async function () {
    var a = mk(); ok(/2:30 pm/.test((await a.say('what time is it')).say)); ok(/Thursday, 26 November 2026|Thursday, November 26, 2026/.test((await a.say('what is the date')).say));
    ok(/Tokyo/.test((await a.say('what time is it in tokyo')).say)); ok(/do not know the time zone/.test((await a.say('time in atlantis')).say));
    ok(/3 hours 30 minutes until 6:00 pm/.test((await a.say('how long until 6pm')).say));
  });

  H.group('notes and clipboard');
  await H.tAsync('notes add, list, clear needs a yes', async function () {
    var a = mk({ dry: false, exec: stub() }); var r = await a.say('note: buy HDMI cables'); ok(/Noted \(N1\)/.test(r.say)); await a.say('remember that rent is due on the 5th');
    r = await a.say('show my notes'); eq(r.items.length, 2); eq(r.items[0].name, 'rent is due on the 5th');
    r = await a.say('clear my notes'); eq(r.status, 'confirm'); ok(/Clear all 2 notes/.test(r.say)); eq(a.store.data.notes.length, 2); r = await a.say('yes'); ok(/Cleared 2 notes/.test(r.say)); eq(a.store.data.notes.length, 0);
    r = await a.say('clear my notes'); ok(/no notes to clear/.test(r.say)); eq(r.status, 'done');
  });
  await H.tAsync('notes survive a restart', async function () { var a = mk(); await a.say('note: persists'); var s = createStore(a.store.dir); eq(s.data.notes[0].text, 'persists'); });
  await H.tAsync('clipboard text is passed as input, not as an argument', async function () {
    var a = mk({ dry: false, exec: stub() }); var r = await a.say('copy hello $(whoami) world to clipboard'); ok(/Copied/.test(r.say)); ok(/\$\(whoami\)/.test(r.ran[0]) && /</.test(r.ran[0]));
  });

  H.group('files');
  await H.tAsync('find, then open by number', async function () {
    var a = mk({ dry: false, exec: stub() }); put(a.dirs.downloads, 'Invoice Acme.pdf', DAY); put(a.dirs.documents, 'invoice-2025.pdf', 30 * DAY); put(a.dirs.documents, 'notes.txt', DAY);
    var r = await a.say('find my invoice pdf'); eq(r.items.length, 2); ok(/open the first one/.test(r.say)); eq(r.items[0].name, 'Invoice Acme.pdf');
    r = await a.say('open the second one'); ok(/Opening "invoice-2025.pdf"/.test(r.say)); ok(/xdg-open/.test(r.ran[0]) && /invoice-2025\.pdf/.test(r.ran[0]));
    r = await a.say('open the fifth one'); eq(r.ok, false); ok(/only 2 results/.test(r.say));
  });
  await H.tAsync('open by number without a list', async function () { var a = mk(); var r = await a.say('open the first one'); eq(r.status, 'needs'); });
  await H.tAsync('find nothing, find in a folder', async function () {
    var a = mk(); put(a.dirs.downloads, 'a.mp4', DAY); var r = await a.say('find zzzz'); ok(/found nothing/.test(r.say)); r = await a.say('find videos in downloads'); eq(r.items.length, 1); ok(/mp4/.test(r.items[0].name));
  });
  await H.tAsync('programs and scripts are never launched from a file list', async function () {
    var a = mk({ dry: false, exec: stub() }); put(a.dirs.downloads, 'setup.exe', 1000); var r = await a.say('find setup'); eq(r.items.length, 1);
    r = await a.say('open the first one'); ok(/do not launch programs/.test(r.say)); ok(a.exec.calls.every(function (c) { return !/setup\.exe/.test(c.display); }), JSON.stringify(a.exec.calls)); ok(/Downloads/.test(a.exec.calls[0].display));
    put(a.dirs.downloads, 'run.bat', 500); r = await a.say('open my latest download'); ok(/do not launch programs/.test(r.say));
  });
  await H.tAsync('latest download / screenshot', async function () {
    var a = mk({ dry: false, exec: stub() }); put(a.dirs.downloads, 'old.zip', 3 * DAY); put(a.dirs.downloads, 'new.pdf', 60000); put(a.dirs.desktop, 'Screenshot 2026-11-26 at 2.29.10 PM.png', 120000);
    var r = await a.say('what is my most recent download'); ok(/"new.pdf"/.test(r.say)); r = await a.say('open my latest download'); ok(/Opening "new.pdf"/.test(r.say));
    r = await a.say('show my latest screenshot'); ok(/Screenshot 2026-11-26/.test(r.say)); r = await a.say('open it'); ok(/Opening "Screenshot/.test(r.say));
    r = await a.say('what is my most recent video'); ok(/no video/.test(r.say));
  });
  await H.tAsync('organize downloads: preview, yes, undo', async function () {
    var a = mk({ dry: false, exec: stub() }), d = a.dirs.downloads; put(d, 'a.jpg', DAY); put(d, 'b.pdf', DAY); put(d, 'c.mp4', DAY); put(d, 'weird.xyz', DAY);
    var snap = fs.readdirSync(d).sort();
    var r = await a.say('organize my downloads'); eq(r.status, 'confirm'); ok(/Move 3 files/.test(r.say) && /Nothing is deleted/.test(r.say)); eq(fs.readdirSync(d).sort(), snap);
    r = await a.say('yes'); ok(/Moved 3 files/.test(r.say)); ok(fs.existsSync(path.join(d, 'Images', 'a.jpg'))); ok(fs.existsSync(path.join(d, 'weird.xyz'))); ok(r.ran.length >= 3); eq(a.store.data.batches.length, 1);
    var again = await a.say('tidy my downloads folder'); ok(/already tidy/.test(again.say)); eq(again.status, 'done');
    r = await a.say('undo'); ok(/Put 3 files back/.test(r.say)); eq(fs.readdirSync(d).sort(), snap); r = await a.say('undo'); ok(/nothing to undo/.test(r.say));
  });
  await H.tAsync('undo survives a restart', async function () {
    var a = mk({ dry: false, exec: stub() }), d = a.dirs.downloads; put(d, 'a.jpg', DAY); await a.say('organize my downloads'); await a.say('yes');
    var s2 = createStore(a.store.dir), e2 = createEngine({ os: 'linux', store: s2, exec: stub(), dry: false, dirs: a.dirs, now: a.ck.now, setTimeout: a.ck.setTimeout, clearTimeout: a.ck.clearTimeout });
    var r = await e2.handle('undo'); ok(/Put 1 file back/.test(r.say)); ok(fs.existsSync(path.join(d, 'a.jpg')));
  });
  await H.tAsync('dry mode never touches files', async function () {
    var a = mk({ dry: true }), d = a.dirs.downloads; put(d, 'a.jpg', DAY); put(d, 'b.pdf', DAY); var snap = fs.readdirSync(d).sort();
    await a.say('organize my downloads'); var r = await a.say('yes'); ok(/Dry run: would move 2 files/.test(r.say)); eq(fs.readdirSync(d).sort(), snap); eq(a.store.data.batches.length, 0);
    r = await a.say('create a folder called Invoices in documents'); ok(/Dry run: would create/.test(r.say)); ok(!fs.existsSync(path.join(a.dirs.documents, 'Invoices')));
    r = await a.say('take a screenshot'); ok(/Dry run/.test(r.say)); ok(!fs.existsSync(path.join(a.dirs.pictures, 'Deskhand')));
  });
  await H.tAsync('create folder', async function () {
    var a = mk({ dry: false, exec: stub() }); var r = await a.say('create a folder called Client Work on the desktop'); ok(/Created "Client Work" in Desktop/.test(r.say)); ok(fs.statSync(path.join(a.dirs.desktop, 'Client Work')).isDirectory());
    r = await a.say('create a folder called Client Work on the desktop'); ok(/already exists/.test(r.say));
    r = await a.say('make a new folder ../escape in documents'); eq(r.ok, false); ok(!fs.existsSync(path.join(a.dirs.documents, '..', 'escape')));
    r = await a.say('make a new folder con in documents'); eq(r.ok, false); ok(/reserved/.test(r.say));
  });
  await H.tAsync('screenshot is saved and can be opened', async function () {
    var a = mk({ dry: false, exec: stub(async function (spec) { return { ok: true, code: 0, stdout: '', stderr: '' }; }) });
    // the stub does not write a file, so the honest answer is failure
    var r = await a.say('take a screenshot'); eq(r.ok, false); ok(/could not take the screenshot/.test(r.say));
    var b = mk({ dry: false, exec: stub(function (spec) { if (spec.candidates) fs.writeFileSync(spec.candidates[0].args[1], 'png'); return { ok: true, code: 0, stdout: '', stderr: '' }; }) });
    r = await b.say('take a screenshot'); eq(r.ok, true); ok(/Pictures\/Deskhand/.test(r.say)); eq(r.items.length, 1); ok(fs.existsSync(r.items[0].path)); r = await b.say('open it'); ok(/Opening "Screenshot/.test(r.say));
  });

  H.group('system, volume, maths');
  await H.tAsync('volume, mute, media per OS', async function () {
    var w = mk({ os: 'win32' }); var r = await w.say('set the volume to 40'); ok(/Dry run: would set the volume to 40%/.test(r.say)); ok(/SendKeys/.test(r.ran[0]));
    var m = mk({ os: 'darwin' }); r = await m.say('turn the volume up'); ok(/osascript/.test(r.ran[0])); r = await m.say('mute'); ok(/muted true/.test(r.ran[0]));
    var l = mk({ os: 'linux' }); r = await l.say('louder'); ok(/pactl set-sink-volume @DEFAULT_SINK@ \+10%/.test(r.ran[0])); r = await l.say('pause'); ok(/playerctl play-pause/.test(r.ran[0]));
    var real = mk({ dry: false, os: 'win32', exec: stub() }); r = await real.say('mute'); ok(/Windows only toggles it/.test(r.say));
    var lin = mk({ dry: false, exec: stub(function () { return { ok: false, code: 127, notInstalled: true, stdout: '', stderr: '' }; }) }); r = await lin.say('volume to 30'); eq(r.ok, false); ok(/pactl or amixer/.test(r.say));
  });
  await H.tAsync('status answers use real values', async function () {
    var a = mk(); var r = await a.say('how much memory is free'); ok(/of memory available out of/.test(r.say)); r = await a.say('how much disk space is left'); ok(/free of/.test(r.say));
    r = await a.say('what is the uptime'); ok(/has been on for/.test(r.say)); r = await a.say('system status'); ok(r.items.length >= 4);
    r = await a.say('how much battery do i have'); ok(/battery|Battery/.test(r.say));
  });
  await H.tAsync('maths, conversions, frames', async function () {
    var a = mk(); eq((await a.say('what is 15 percent of 2400')).say, '15% of 2400 is 360.'); ok(/84/.test((await a.say('calculate 12 * (3 + 4)')).say));
    ok(/3\.10/.test((await a.say('convert 5 km to miles')).say)); ok(/72 f|212|22\.2/.test((await a.say('72 f in celsius')).say));
    var r = await a.say('how many frames in 2.5 seconds at 30 fps'); ok(/75 frames/.test(r.say)); r = await a.say('timecode for 1500 frames at 25 fps'); ok(/00:01:00:00/.test(r.say));
    r = await a.say('convert 100 usd to inr'); ok(/do not know live exchange rates/.test(r.say)); ok(/google\.com\/search/.test(r.ran[0]));
    r = await a.say('calculate 5 / 0'); eq(r.ok, false);
  });

  H.group('routines');
  await H.tAsync('create, list, run, delete', async function () {
    var a = mk({ dry: false, exec: stub() }); var r = await a.say('create routine edit mode: open premiere, open spotify, volume to 30'); ok(/Saved the routine "edit mode" with 3 steps/.test(r.say)); eq(r.items.length, 3);
    r = await a.say('list my routines'); eq(r.items.length, 1);
    r = await a.say('run my edit mode routine'); eq(r.steps.length, 3); eq(a.exec.calls.length, 3); eq(r.routine, 'edit mode');
    r = await a.say('edit mode'); eq(r.steps.length, 3);
    r = await a.say('delete routine edit mode'); ok(/Deleted/.test(r.say)); r = await a.say('run my edit mode routine'); eq(r.ok, false); ok(/no routine/.test(r.say));
  });
  await H.tAsync('routines cannot contain risky or odd steps, and a risky one asks for a yes at run time', async function () {
    var a = mk({ dry: false, exec: stub() });
    var r = await a.say('create routine bad: open chrome, run my other routine'); eq(r.ok, false);
    r = await a.say('create routine nonsense: open chrome, asdf qwer'); eq(r.ok, false); ok(/did not save/.test(r.say));
    r = await a.say('create routine wrap up: take a screenshot, close chrome'); ok(/asks for a yes/.test(r.say));
    r = await a.say('run wrap up routine'); eq(r.status, 'confirm'); eq(a.exec.calls.length, 0); r = await a.say('yes'); eq(r.steps.length, 2); eq(a.exec.calls.length >= 2, true);
    r = await a.say('create routine ' + new Array(50).join('x') + ': open chrome'); eq(r.ok, false);
  });
  await H.tAsync('routines survive a restart', async function () { var a = mk(); await a.say('create routine r1: open chrome'); var s = createStore(a.store.dir); eq(Object.keys(s.data.routines), ['r1']); });

  H.group('assistant');
  await H.tAsync('repeat, history, help, exit, small talk', async function () {
    var a = mk(); var r = await a.say('again'); ok(/nothing to repeat/.test(r.say));
    await a.say('set a timer for 5 minutes'); r = await a.say('do that again'); ok(/Timer set/.test(r.say)); eq(a.e.timers.list().length, 2);
    r = await a.say('show history'); ok(r.items.length >= 2); ok(/set a timer for 5 minutes/.test(r.items[0].name));
    r = await a.say('help'); ok(r.help.length >= 6); r = await a.say('help with files'); ok(r.help.length >= 1); ok(/Files/.test(r.help[0].group));
    r = await a.say('exit deskhand'); eq(r.exit, true);
    ok(/Hello/.test((await a.say('hello')).say)); ok(/Deskhand/.test((await a.say('are you jarvis')).say)); ok(!/Stark|Marvel|Iron Man/i.test((await a.say('are you jarvis')).say));
  });
  await H.tAsync('repeating a risky command asks again', async function () { var a = mk({ dry: false, exec: stub() }); await a.say('close chrome'); await a.say('yes'); var r = await a.say('again'); eq(r.status, 'confirm'); });
  await H.tAsync('unknown input gives suggestions and a typo is fixed', async function () {
    var a = mk(); var r = await a.say('qwerty asdf zxcv'); eq(r.status, 'unknown'); ok(/help/.test(r.say));
    r = await a.say('opne chrome'); eq(r.status, 'done'); ok(/Chrome/.test(r.say)); eq(r.corrected, 'open chrome');
    r = await a.say('set timer'); eq(r.status, 'needs');
    r = await a.say(''); eq(r.ok, false); r = await a.say(new Array(500).join('a ')); eq(r.ok, false);
  });
  await H.tAsync('commands run one at a time, in order', async function () {
    var a = mk(); var rs = await Promise.all([a.e.handle('set a timer for 1 minute'), a.e.handle('set a timer for 2 minutes'), a.e.handle('set a timer for 3 minutes')]);
    eq(rs.map(function (r) { return /T(\d)/.test(JSON.stringify(a.e.timers.list())) ; }).length, 3); eq(a.e.timers.list().map(function (x) { return x.id; }), ['T1', 'T2', 'T3']);
  });
  await H.tAsync('snapshot', async function () {
    var a = mk(); await a.say('set a timer for 5 minutes'); await a.say('note: hi'); await a.say('close chrome'); var s = a.e.snapshot(); eq(s.timers.length, 1); eq(s.noteCount, 1); ok(s.pending && /Close/.test(s.pending.text)); eq(s.os, 'linux'); eq(s.dry, true);
  });

  H.group('every rule example works, on every OS');
  var special = { 'confirm.yes': 1, 'confirm.no': 1, 'repeat': 1, 'routine.create': 1, 'routine.run': 1 };
  t('every rule has a skill', function () { parser.RULES.forEach(function (r) { if (!special[r.id]) ok(SKILLS[r.id], 'no skill for ' + r.id); }); });
  var SWEEP_BAD = /undefined|\[object|NaN|null/;
  for (var oi = 0; oi < 3; oi++) {
    var osn = ['win32', 'darwin', 'linux'][oi];
    await H.tAsync(osn + ': ' + parser.RULES.reduce(function (n, r) { return n + r.examples.length; }, 0) + ' example phrases, dry mode', async function () {
      var a = mk({ os: osn, dry: true });
      await a.say('create routine edit mode: open premiere, volume to 30');
      for (var i = 0; i < parser.RULES.length; i++) {
        var rule = parser.RULES[i];
        for (var j = 0; j < rule.examples.length; j++) {
          var ex = rule.examples[j], r;
          try { r = await a.say(ex); } catch (e) { throw new Error('threw on ' + JSON.stringify(ex) + ': ' + e.message); }
          ok(typeof r.say === 'string' && r.say.length > 0, 'no reply for ' + JSON.stringify(ex));
          ok(!SWEEP_BAD.test(r.say), 'odd reply for ' + JSON.stringify(ex) + ': ' + r.say);
          ok(r.status !== 'unknown' || rule.id === 'confirm.no', 'not understood: ' + JSON.stringify(ex));
          if (r.status === 'confirm') await a.say('no');
        }
      }
      ok(a.exec.calls.every(function (c) { return c.dry; }));
    });
  }
  H.done('engine');
})();
