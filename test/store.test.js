var H = require('./helpers'), fs = require('fs'), os = require('os'), path = require('path');
var S = require('../src/store'), TM = require('../src/timers');
var t = H.t, eq = H.eq, ok = H.ok;
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dh-')); }

H.group('store');
t('starts empty and saves', function () { var d = tmp(), s = S.createStore(d); eq(s.data.notes, []); s.addNote('hello'); var again = S.createStore(d); eq(again.data.notes.length, 1); eq(again.data.notes[0].text, 'hello'); eq(again.data.notes[0].id, 'N1'); });
t('ids keep counting', function () { var d = tmp(), s = S.createStore(d); s.addNote('a'); s.addNote('b'); var s2 = S.createStore(d); eq(s2.addNote('c').id, 'N3'); });
t('data file is private on unix', function () { if (process.platform === 'win32') return; var d = tmp(), s = S.createStore(d); s.addNote('x'); eq((fs.statSync(path.join(d, 'data.json')).mode & 0o077), 0); });
t('corrupt file is set aside, not lost', function () { var d = tmp(); fs.writeFileSync(path.join(d, 'data.json'), '{not json'); var s = S.createStore(d); eq(s.data.notes, []); ok(s.warnings.length === 1); ok(fs.readdirSync(d).some(function (f) { return /corrupt/.test(f); })); });
t('history is capped', function () { var s = S.createStore(tmp()); for (var i = 0; i < 260; i++) s.addHistory({ text: 'x' + i }); eq(s.data.history.length, 200); eq(s.data.history[199].text, 'x259'); });
t('batches are capped', function () { var s = S.createStore(tmp()); for (var i = 0; i < 8; i++) s.addBatch({ n: i }); eq(s.data.batches.length, 5); eq(s.popBatch().n, 7); eq(s.data.batches.length, 4); });
t('clear notes', function () { var s = S.createStore(tmp()); s.addNote('a'); s.addNote('b'); eq(s.clearNotes(), 2); eq(s.data.notes, []); });
t('long notes are cut', function () { var s = S.createStore(tmp()); eq(s.addNote(new Array(5000).join('x')).text.length, 2000); });
t('no leftover temp files', function () { var d = tmp(), s = S.createStore(d); s.addNote('a'); eq(fs.readdirSync(d).filter(function (f) { return /tmp-/.test(f); }), []); });

H.group('config');
t('missing config is fine', function () { var s = S.createStore(tmp()); eq(s.config.sites, {}); eq(s.warnings, []); });
t('valid config', function () {
  var d = tmp(), proj = tmp(); fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ name: 'Bhavesh', locale: 'en-IN', sites: { Portfolio: 'https://vaghelabhavesh.com' }, folders: { Clients: proj }, apps: { edit: 'Premiere Pro' } }));
  var s = S.createStore(d); eq(s.config.name, 'Bhavesh'); eq(s.config.locale, 'en-IN'); eq(s.config.sites.portfolio, 'https://vaghelabhavesh.com/'); eq(s.config.folders.clients, proj); eq(s.config.apps.edit, 'Premiere Pro'); eq(s.warnings, []);
});
t('bad config entries are dropped with a warning', function () {
  var d = tmp(); fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ name: '<script>', locale: 'x y', sites: { a: 'javascript:alert(1)', b: 'file:///etc/passwd' }, folders: { c: 'relative/path', d: '/definitely/not/here' }, apps: { e: 'x; rm -rf /' } }));
  var s = S.createStore(d); eq(s.config.sites, {}); eq(s.config.folders, {}); eq(s.config.apps, {}); eq(s.config.locale, ''); eq(s.config.name, 'script'); eq(s.warnings.length, 5);
});
t('broken config json warns', function () { var d = tmp(); fs.writeFileSync(path.join(d, 'config.json'), '{oops'); var s = S.createStore(d); ok(s.warnings.length === 1); });

H.group('timers');
function fakeClock() {
  var c = { t: 1000000, q: [], now: function () { return c.t; }, setTimeout: function (fn, ms) { var h = { fn: fn, at: c.t + ms, off: false }; c.q.push(h); return h; }, clearTimeout: function (h) { h.off = true; },
    advance: function (ms) { var end = c.t + ms; for (;;) { var due = c.q.filter(function (h) { return !h.off && h.at <= end; }).sort(function (a, b) { return a.at - b.at; })[0]; if (!due) break; c.t = Math.max(c.t, due.at); due.off = true; due.fn(); } c.t = end; } };
  return c;
}
function mk() { var clock = fakeClock(), store = S.createStore(tmp()), fired = []; var tm = TM.createTimers({ store: store, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onFire: function (t, i) { fired.push([t.id, i.missed, i.lateMs]); } }); return { clock: clock, store: store, tm: tm, fired: fired }; }
t('timer fires on time and is removed', function () { var m = mk(); var r = m.tm.add('timer', { due: m.clock.t + 60000, label: 'tea' }); eq(r.timer.id, 'T1'); m.clock.advance(59000); eq(m.fired.length, 0); m.clock.advance(2000); eq(m.fired.length, 1); eq(m.tm.list().length, 0); eq(m.store.data.timers.length, 0); });
t('list is sorted', function () { var m = mk(); m.tm.add('timer', { due: m.clock.t + 90000 }); m.tm.add('timer', { due: m.clock.t + 30000 }); eq(m.tm.list().map(function (x) { return x.id; }), ['T2', 'T1']); });
t('cancel one', function () { var m = mk(); m.tm.add('timer', { due: m.clock.t + 1000 }); m.tm.add('timer', { due: m.clock.t + 2000 }); eq(m.tm.cancel('T1').length, 1); m.clock.advance(5000); eq(m.fired.map(function (f) { return f[0]; }), ['T2']); });
t('cancel is case-insensitive and all works', function () { var m = mk(); m.tm.add('timer', { due: m.clock.t + 1000 }); m.tm.add('timer', { due: m.clock.t + 2000 }); eq(m.tm.cancel('t1').length, 1); eq(m.tm.cancel('all').length, 1); m.clock.advance(5000); eq(m.fired.length, 0); eq(m.tm.cancel('T9'), []); });
t('past times are refused', function () { var m = mk(); ok(m.tm.add('timer', { due: m.clock.t - 5 }).error); });
t('more than seven days is refused', function () { var m = mk(); ok(/7 days/.test(m.tm.add('timer', { due: m.clock.t + 8 * 86400000 }).error)); ok(m.tm.add('timer', { due: m.clock.t + 6 * 86400000 }).timer); });
t('limit of 30', function () { var m = mk(); for (var i = 0; i < 30; i++) m.tm.add('timer', { due: m.clock.t + 1000 + i }); ok(/30 timers/.test(m.tm.add('timer', { due: m.clock.t + 5000 }).error)); });
t('restore reschedules and rings missed ones', function () {
  var m = mk(); m.tm.add('timer', { due: m.clock.t + 1000, label: 'a' }); m.tm.add('reminder', { due: m.clock.t + 600000, text: 'b' });
  var c2 = fakeClock(); c2.t = m.clock.t + 5000; var fired = []; var tm2 = TM.createTimers({ store: m.store, now: c2.now, setTimeout: c2.setTimeout, clearTimeout: c2.clearTimeout, onFire: function (t, i) { fired.push([t.id, i.missed]); } });
  eq(tm2.restore(), 1); eq(fired, [['T1', true]]); eq(tm2.list().length, 1); c2.advance(700000); eq(fired[1], ['T2', false]);
});
t('a throwing notifier does not break timers', function () { var clock = fakeClock(), store = S.createStore(tmp()); var tm = TM.createTimers({ store: store, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onFire: function () { throw new Error('boom'); } }); tm.add('timer', { due: clock.t + 100 }); tm.add('timer', { due: clock.t + 200 }); clock.advance(500); eq(tm.list().length, 0); });
t('ids never repeat after a restart', function () { var m = mk(); m.tm.add('timer', { due: m.clock.t + 1000 }); var s2 = S.createStore(m.store.dir); var tm2 = TM.createTimers({ store: s2, now: m.clock.now, setTimeout: m.clock.setTimeout, clearTimeout: m.clock.clearTimeout }); eq(tm2.add('timer', { due: m.clock.t + 2000 }).timer.id, 'T2'); });
H.done('store');
