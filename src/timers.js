'use strict';
/* Deskhand timers and reminders. They live inside the running app, are saved to disk, and are restored when it starts again.
   The clock and setTimeout are injected so the tests can run a day of timers in a millisecond. */
const MAX_AHEAD = 7 * 24 * 3600 * 1000;
const MAX_TIMERS = 30;
const MAX_DELAY = 2147483647;

function createTimers(o) {
  var store = o.store, now = o.now || Date.now, st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout, onFire = o.onFire || function () {};
  var handles = {};

  function schedule(t) {
    if (handles[t.id]) ct(handles[t.id]);
    var delay = Math.max(0, t.due - now());
    handles[t.id] = st(function () {
      delete handles[t.id];
      if (t.due - now() > 50 && t.due - now() > 0 && delay >= MAX_DELAY) return schedule(t);   // a long wait is slept in chunks
      fire(t, false);
    }, Math.min(delay, MAX_DELAY));
    if (handles[t.id] && handles[t.id].unref) handles[t.id].unref();
  }
  function fire(t, missed) {
    var list = store.data.timers, i = list.findIndex(function (x) { return x.id === t.id; });
    if (i < 0) return;
    list.splice(i, 1); store.save();
    try { onFire(t, { missed: !!missed, lateMs: Math.max(0, now() - t.due) }); } catch (e) { /* a broken notifier must not stop timers */ }
  }

  return {
    add: function (kind, spec) {
      var due = spec.due, n = now();
      if (!(due > n)) return { error: 'That time has already passed.' };
      if (due - n > MAX_AHEAD) return { error: 'I keep timers for up to 7 days, because I have to stay running to ring them.' };
      if (store.data.timers.length >= MAX_TIMERS) return { error: 'You already have ' + MAX_TIMERS + ' timers. Cancel some first.' };
      var t = { id: store.nextId('timer', 'T'), kind: kind, label: spec.label || null, text: spec.text || null, due: due, created: n };
      store.data.timers.push(t); store.save(); schedule(t);
      return { timer: t };
    },
    list: function () { return store.data.timers.slice().sort(function (a, b) { return a.due - b.due; }); },
    cancel: function (which) {
      var list = store.data.timers, removed = [];
      if (which === 'all') { removed = list.splice(0, list.length); }
      else { var i = list.findIndex(function (x) { return x.id.toLowerCase() === String(which).toLowerCase(); }); if (i >= 0) removed = list.splice(i, 1); }
      removed.forEach(function (t) { if (handles[t.id]) { ct(handles[t.id]); delete handles[t.id]; } });
      if (removed.length) store.save();
      return removed;
    },
    // after a restart: schedule what is left, ring what was missed
    restore: function () {
      var n = now(), missed = [];
      store.data.timers.slice().forEach(function (t) { if (t.due <= n) { missed.push(t); } else schedule(t); });
      missed.forEach(function (t) { fire(t, true); });
      return missed.length;
    },
    stop: function () { Object.keys(handles).forEach(function (k) { ct(handles[k]); }); handles = {}; },
    MAX_AHEAD: MAX_AHEAD
  };
}
module.exports = { createTimers: createTimers };
