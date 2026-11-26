'use strict';
/* Deskhand engine: takes one line of text and turns it into actions.
   parse -> (ask for a yes if anything is risky) -> run each step -> remember it.
   Only the fixed skills in skills.js can run. There is no path from text to a shell. */
const os = require('os');
const fs = require('fs');
const path = require('path');
const T = require('./text');
const P = require('./platform');
const F = require('./files');
const parser = require('./parser');
const { createTimers } = require('./timers');
const { SKILLS, describeTimer } = require('./skills');

const CONFIRM_MS = 45000;
const MAX_LINE = 400;
const MAX_STEPS = 12;
const MAX_ROUTINES = 20;
const NO_REPEAT = /^(?:repeat|undo|confirm\.|help|history\.show|app\.exit|talk\.)/;
const NO_ROUTINE = /^(?:routine\.|confirm\.|repeat|undo|help|history\.show|app\.exit|unsupported|talk\.)/;

function createEngine(o) {
  o = o || {};
  const osName = o.os || process.platform;
  const nowFn = o.now || (() => new Date());
  const store = o.store, exec = o.exec, dry = !!o.dry;
  const flags = {};
  const events = []; let evSeq = 0;
  let pending = null, lastRaw = null, lastItems = [], chain = Promise.resolve();
  let dirs = Object.assign({}, P.defaultDirs(osName, o.home || os.homedir(), osName === 'win32' ? '\\' : '/'), o.dirs || {});

  function pushEvent(kind, text) { events.push({ id: ++evSeq, at: nowFn().getTime(), kind: kind, text: text }); if (events.length > 100) events.shift(); }

  function ring(t, info) {
    let text;
    if (t.kind === 'reminder') text = 'Reminder: ' + (t.text || 'time is up');
    else if (t.kind === 'focus') text = 'Focus session finished. Take a short break.';
    else text = (t.label ? t.label + ': ' : '') + 'Timer finished.';
    if (info && info.missed) text += ' (This rang while Deskhand was closed.)';
    pushEvent('ring', text);
    try { Promise.resolve(exec(P.build.notify(osName, 'Deskhand', text))).catch(function () {}); } catch (e) { /* a missing notifier is fine, the app still shows it */ }
    if (o.onRing) { try { o.onRing(text, t); } catch (e) { /* ignore */ } }
  }
  const timers = createTimers({ store: store, now: () => nowFn().getTime(), setTimeout: o.setTimeout, clearTimeout: o.clearTimeout, onFire: ring });

  async function init() {
    if (!o.dirs && !dry) {
      if (osName === 'linux') {
        try { dirs = Object.assign(dirs, F.linuxUserDirs(fs.readFileSync(path.join(o.home || os.homedir(), '.config', 'user-dirs.dirs'), 'utf8'), o.home || os.homedir())); } catch (e) { /* defaults */ }
      } else if (osName === 'win32') {
        try { const r = await exec({ ps: P.KNOWN_FOLDERS_PS, label: 'read folder locations' }); if (r.ok) dirs = P.parseKnownFolders(r.stdout, dirs); } catch (e) { /* defaults */ }
      }
    }
    return timers.restore();
  }

  function parserState(now) {
    return { now: now, routines: Object.keys(store.data.routines), folders: store.config.folders, sites: store.config.sites, timers: store.data.timers.length, pending: !!(pending && pending.expires > now.getTime()) };
  }

  function makeCtx(ledger) {
    return {
      os: osName, dry: dry, store: store, exec: exec, timers: timers, dirs: dirs, flags: flags, locale: store.config.locale || undefined, name: store.config.name || '',
      now: nowFn, results: { get: () => lastItems, set: (l) => { lastItems = l.slice(0, 20); } }, log: (t) => ledger.push(t)
    };
  }

  async function runOne(step, prepared) {
    const sk = SKILLS[step.id], ledger = [], before = exec.calls ? exec.calls.length : 0;
    let r;
    if (!sk) r = { ok: false, say: 'I know that command but cannot do it here yet (' + step.id + ').' };
    else {
      try { r = await sk.run(step.args || {}, makeCtx(ledger), prepared); }
      catch (e) { r = { ok: false, say: 'Something went wrong with that: ' + String(e && e.message || e).slice(0, 140) }; }
    }
    const ran = (exec.calls ? exec.calls.slice(before).map((c) => c.display) : []).concat(ledger);
    return Object.assign({ id: step.id, risk: step.risk, ran: ran }, r);
  }

  function parseRoutineStep(text, now) {
    const st = parserState(now), p = parser.parse(text, st);
    if (!p.ok) return { error: 'I do not understand ' + JSON.stringify(text) + '.' };
    if (NO_ROUTINE.test(p.id)) return { error: JSON.stringify(text) + ' cannot go inside a routine.' };
    if (p.args && (p.args.bad || p.args.vague || p.args.need || p.args.error)) return { error: JSON.stringify(text) + ' is not complete enough for a routine.' };
    return { step: p };
  }

  // routines are expanded into their steps before anything runs, so the yes covers all of it
  function expand(steps, now) {
    const out = [];
    for (const s of steps) {
      if (s.id !== 'routine.run') { out.push(s); continue; }
      const rt = store.data.routines[s.args.name];
      if (!rt) return { error: 'I have no routine called ' + JSON.stringify(s.args.name) + '.' + (Object.keys(store.data.routines).length ? ' You have: ' + Object.keys(store.data.routines).join(', ') + '.' : ' Create one with "create routine NAME: open chrome, volume to 30".') };
      for (const text of rt.steps) {
        const r = parseRoutineStep(text, now);
        if (r.error) return { error: 'The routine ' + JSON.stringify(s.args.name) + ' has a step I can no longer run: ' + r.error };
        out.push(r.step);
      }
      out.routine = s.args.name;
    }
    if (out.length > MAX_STEPS) return { error: 'That is more than ' + MAX_STEPS + ' steps at once.' };
    return { steps: out, routine: out.routine };
  }

  function result(base, extra) { return Object.assign({ status: base.ok ? 'done' : 'failed' }, base, extra); }

  function remember(raw, res, steps) {
    const ids = steps.map((s) => s.id);
    if (ids.every((id) => NO_REPEAT.test(id))) return;
    lastRaw = raw;
    try { store.addHistory({ at: nowFn().getTime(), text: raw.slice(0, 200), ids: ids, ok: res.ok, say: String(res.say || '').slice(0, 160) }); } catch (e) { /* history is a convenience */ }
  }

  async function runAll(raw, steps, prepared, extra) {
    const out = [];
    for (let i = 0; i < steps.length; i++) {
      const r = await runOne(steps[i], prepared[i]);
      out.push(r);
      if (r.exit) break;
    }
    const okAll = out.every((r) => r.ok);
    const items = out.reduce((acc, r) => acc || r.items, null) || undefined;
    const help = out.reduce((acc, r) => acc || r.help, null) || undefined;
    const base = {
      ok: okAll, say: out.length === 1 ? out[0].say : out.map((r) => r.say).join(' '), steps: out.length > 1 ? out.map((r) => ({ id: r.id, ok: r.ok, say: r.say, ran: r.ran })) : undefined,
      ran: [].concat.apply([], out.map((r) => r.ran || [])), items: items, help: help, exit: out.some((r) => r.exit) || undefined, canUndo: store.data.batches.length > 0
    };
    const status = out.length === 1 && out[0].status ? out[0].status : (okAll ? 'done' : (out.some((r) => r.ok) ? 'partial' : 'failed'));
    const res = Object.assign(result(base, extra), { status: status });
    remember(raw, res, steps);
    return res;
  }

  function expirePending() { if (pending && pending.expires <= nowFn().getTime()) pending = null; }

  async function handleInner(rawIn) {
    const raw = String(rawIn == null ? '' : rawIn).slice(0, MAX_LINE);
    const now = nowFn();
    expirePending();
    const parsed = parser.parseLine(raw, parserState(now));
    const base = { heard: parsed.heard || (parsed.steps && parsed.steps[0] && parsed.steps[0].heard) || T.clean(raw) };

    if (!parsed.ok) {
      pending = null;
      const sug = (parsed.suggestions || []).map((s) => s.example);
      const say = parsed.say || ('I did not understand ' + JSON.stringify(base.heard) + '.' + (sug.length ? ' Did you mean ' + sug.map((x) => JSON.stringify(x)).join(' or ') + '?' : ' Say "help" to see what I can do.'));
      return Object.assign({ ok: false, status: 'unknown', say: say, suggestions: sug }, base);
    }

    // yes / no
    if (parsed.steps.length === 1 && /^confirm\./.test(parsed.steps[0].id)) {
      const yes = parsed.steps[0].id === 'confirm.yes';
      if (!pending) return Object.assign({ ok: true, status: 'info', say: yes ? 'There is nothing waiting for a yes.' : 'Okay.' }, base);
      const p = pending; pending = null;
      if (!yes) return Object.assign({ ok: true, status: 'cancelled', say: 'Okay, I did not do it.' }, base);
      return Object.assign(await runAll(p.raw, p.steps, p.prepared), base);
    }

    // repeat
    if (parsed.steps.length === 1 && parsed.steps[0].id === 'repeat') {
      pending = null;
      if (!lastRaw) return Object.assign({ ok: false, status: 'info', say: 'There is nothing to repeat yet.' }, base);
      return handleInner(lastRaw);
    }

    pending = null;
    const fixedStep = parsed.steps.filter((x) => x.corrected)[0];
    if (fixedStep) base.corrected = fixedStep.corrected;
    const ex = expand(parsed.steps, now);
    if (ex.error) return Object.assign({ ok: false, status: 'failed', say: ex.error }, base);
    const steps = ex.steps;

    // routines can be created here because they need the store
    if (steps.length === 1 && steps[0].id === 'routine.create') return Object.assign(createRoutine(steps[0].args, now), base);

    // prepare: lets a command finish early (nothing to do) or describe what a yes would do
    const prepared = [], descs = [], skipped = {};
    for (let i = 0; i < steps.length; i++) {
      const sk = SKILLS[steps[i].id], c = makeCtx([]);
      let prep = {};
      if (steps[i].risk === 'confirm') {
        if (sk && sk.prepare) { try { prep = await sk.prepare(steps[i].args || {}, c) || {}; } catch (e) { prep = { skip: { ok: false, say: 'Something went wrong preparing that.' } }; } }
        if (prep.skip) { skipped[i] = prep.skip; prepared[i] = undefined; continue; }
        prepared[i] = prep.data;
        descs.push(sk && sk.describe ? sk.describe(steps[i].args || {}, c, prep.data) : 'Do this?');
      } else prepared[i] = undefined;
    }
    // a step that finished early in prepare: if it was the only step, answer now
    const live = steps.map((s, i) => i).filter((i) => !skipped[i]);
    if (!live.length) {
      const r = skipped[0]; const res = Object.assign({ status: r.status || (r.ok ? 'done' : 'failed'), ran: [] }, r, base);
      return res;
    }
    const liveSteps = live.map((i) => steps[i]), livePrepared = live.map((i) => prepared[i]);
    if (liveSteps.some((s) => s.risk === 'confirm')) {
      const lead = liveSteps.length > 1 ? 'That is ' + liveSteps.length + ' steps (' + liveSteps.map((s) => s.heard).join(', then ') + '). ' : '';
      const text = lead + descs.join(' ') + ' Say yes or no.';
      pending = { raw: raw, steps: liveSteps, prepared: livePrepared, expires: now.getTime() + CONFIRM_MS, text: text };
      return Object.assign({ ok: true, status: 'confirm', say: text, pending: { expiresAt: pending.expires, text: text } }, base);
    }
    const res = await runAll(raw, liveSteps, livePrepared);
    if (Object.keys(skipped).length) res.say = [res.say].concat(Object.keys(skipped).map((k) => skipped[k].say)).join(' ');
    return Object.assign(res, base, ex.routine ? { routine: ex.routine } : {});
  }

  function createRoutine(a, now) {
    const name = String(a.name || '').trim();
    if (!/^[\p{L}\p{N} _-]{1,40}$/u.test(name)) return { ok: false, status: 'failed', say: 'Routine names can use letters, numbers and spaces, up to 40 characters.' };
    if (!a.steps.length) return { ok: false, status: 'failed', say: 'A routine needs at least one step.' };
    if (a.steps.length > 8) return { ok: false, status: 'failed', say: 'A routine can have up to 8 steps.' };
    const existed = !!store.data.routines[name];
    if (!existed && Object.keys(store.data.routines).length >= MAX_ROUTINES) return { ok: false, status: 'failed', say: 'You already have ' + MAX_ROUTINES + ' routines. Delete one first.' };
    const clean = [];
    for (const s of a.steps) {
      const r = parseRoutineStep(s, now);
      if (r.error) return { ok: false, status: 'failed', say: 'I did not save the routine. ' + r.error };
      clean.push(r.step.heard);
    }
    store.data.routines[name] = { steps: clean, created: now.getTime() };
    store.save();
    const risky = a.steps.some((s) => { const r = parseRoutineStep(s, now); return r.step && r.step.risk === 'confirm'; });
    return { ok: true, status: 'done', say: (existed ? 'Updated' : 'Saved') + ' the routine ' + JSON.stringify(name) + ' with ' + clean.length + (clean.length === 1 ? ' step' : ' steps') + '. Say "run ' + name + ' routine".' + (risky ? ' It has a step that asks for a yes first.' : ''), ran: ['save routine ' + name], items: clean.map((c, i) => ({ n: i + 1, name: c })) };
  }

  function handle(raw) {
    const p = chain.then(() => handleInner(raw), () => handleInner(raw));
    chain = p.catch(() => {});
    return p;
  }

  function snapshot() {
    const n = nowFn().getTime();
    expirePending();
    return {
      os: osName, dry: dry, name: store.config.name || '', now: n, dirs: dirs,
      timers: timers.list().map((t) => ({ id: t.id, kind: t.kind, label: t.label, text: t.text, due: t.due, left: Math.max(0, t.due - n) })),
      notes: store.data.notes.slice(-10).reverse().map((x) => ({ id: x.id, text: x.text, at: x.at })), noteCount: store.data.notes.length,
      routines: Object.keys(store.data.routines).map((k) => ({ name: k, steps: store.data.routines[k].steps })),
      canUndo: store.data.batches.length > 0, pending: pending ? { text: pending.text, expiresAt: pending.expires } : null,
      history: store.data.history.slice(-8).reverse().map((h) => ({ text: h.text, ok: h.ok, at: h.at })), warnings: store.warnings
    };
  }
  function takeEvents(after) { return events.filter((e) => e.id > (after || 0)); }

  return { handle: handle, init: init, snapshot: snapshot, takeEvents: takeEvents, timers: timers, close: function () { timers.stop(); }, get dirs() { return dirs; }, get lastItems() { return lastItems; } };
}

module.exports = { createEngine: createEngine, CONFIRM_MS: CONFIRM_MS };
