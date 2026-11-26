'use strict';
/* Deskhand skills: one small function per command the parser can understand.
   A skill never builds a shell string. It asks platform.js for a command spec and hands it to ctx.exec, which records it (the "ledger") and, in dry mode, runs nothing.
   Shape: S[id] = { prepare?(args, ctx), describe?(args, ctx, prepared), run(args, ctx, prepared) }
     prepare  runs before a confirmation. It can finish the command early: { skip: result }.
     describe is the sentence shown when the command needs a yes.
     run      returns { ok, say, items?, status? }. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('./text');
const C = require('./calc');
const K = require('./clock');
const P = require('./platform');
const F = require('./files');
const parser = require('./parser');

const B = P.build;
const S = {};
const ok = (say, extra) => Object.assign({ ok: true, say: say }, extra);
const fail = (say, extra) => Object.assign({ ok: false, say: say }, extra);
const needs = (say) => ({ ok: false, status: 'needs', say: say });
const q = (s) => '"' + s + '"';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const FOLDER_NAME = { downloads: 'Downloads', documents: 'Documents', desktop: 'Desktop', pictures: 'Pictures', videos: os.platform() === 'darwin' ? 'Movies' : 'Videos', music: 'Music', home: 'your home folder' };
const ENGINE_NAME = { google: 'Google', youtube: 'YouTube', maps: 'Google Maps', 'google maps': 'Google Maps', amazon: 'Amazon', flipkart: 'Flipkart', wikipedia: 'Wikipedia', github: 'GitHub', bing: 'Bing', duckduckgo: 'DuckDuckGo', images: 'Google Images' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function itemsFrom(list, now) {
  return list.map((f, i) => ({ n: i + 1, name: f.name, path: f.path, dir: f.dir, info: F.ago(f.mtimeMs, now) + ' · ' + F.sizeText(f.size) }));
}
function uniq(a) { return a.filter((x, i) => x && a.indexOf(x) === i); }

function describeTimer(t) {
  if (t.kind === 'reminder') return 'the reminder ' + q(t.text || 'Reminder') + ' (' + t.id + ')';
  if (t.kind === 'focus') return 'the focus session (' + t.id + ')';
  return (t.label ? 'the ' + q(t.label) + ' timer' : 'the timer') + ' (' + t.id + ')';
}

// ---------------------------------------------------------------------------------------------------------------
// small talk and assistant
S['talk.hello'] = { run: (a, c) => ok((c.name ? 'Hello, ' + c.name + '. ' : 'Hello. ') + 'What would you like me to do?') };
S['talk.thanks'] = { run: () => ok('Any time.') };
S['talk.bye'] = { run: () => ok('See you. I will keep any timers running while I stay open.') };
S['talk.how'] = { run: () => ok('Running fine. Ask me to do something.') };
S['talk.who'] = { run: () => ok('I am Deskhand, a small program on this laptop. You give me a command and I do it, from a fixed list of safe skills. Say "help" to see them.') };
S['talk.jarvis'] = { run: () => ok('I am Deskhand. I am no movie butler, just a short list of skills on your laptop: apps, files, timers, notes, volume and more. Say "help" to see them.') };
S['talk.joke'] = { run: () => ok('I tried to organize my Downloads folder once. It had 4,000 files called final_FINAL_v2. I said undo.') };

S['app.exit'] = { run: () => ok('Goodbye.', { exit: true }) };

S['help'] = {
  run(a) {
    const groups = parser.catalogue();
    const topic = (a.topic || '').replace(/^(?:with|on|about)\s+/, '');
    if (topic) {
      const hit = groups.filter((g) => g.group.toLowerCase().indexOf(topic) >= 0 || g.skills.some((s) => s.id.indexOf(topic) >= 0 || s.examples.some((e) => e.toLowerCase().indexOf(topic) >= 0)));
      if (hit.length) return ok('Here is what I can do with ' + topic + '.', { help: hit });
    }
    const n = groups.reduce((x, g) => x + g.skills.length, 0);
    return ok('I know ' + n + ' skills in ' + groups.length + ' groups. Try the examples, or ask "help with files".', { help: groups });
  }
};

S['history.show'] = {
  run(a, c) {
    const h = c.store.data.history.slice(-8).reverse();
    if (!h.length) return ok('Nothing yet. Your commands are saved on this computer only.');
    return ok('Your last ' + plural(h.length, 'command') + ':', { items: h.map((x, i) => ({ n: i + 1, name: x.text, info: T.fmtWhen(new Date(x.at), c.now()) + (x.ok ? '' : ' · did not work') })) });
  }
};

// ---------------------------------------------------------------------------------------------------------------
// apps, web, folders
S['app.open'] = {
  async run(a, c) {
    if (a.bad || !a.app) return needs('I could not read that app name. Use letters, numbers and spaces only.');
    const name = c.store.config.apps[a.app.toLowerCase()] || a.app;
    const shown = P.resolveApp(name).display;
    const r = await c.exec(B.openApp(c.os, name));
    if (c.dry) return ok('Dry run: would open ' + shown + '.');
    if (r.ok) return ok('Opening ' + shown + '.');
    if (r.notInstalled || r.code === 3 || /NOTFOUND|unable to find|not found|can.t find/i.test(r.stdout + ' ' + r.stderr)) {
      return fail('I could not find an app called ' + q(name) + '. If it has another name on this computer, add it under "apps" in config.json and I will use that.');
    }
    return fail('I could not open ' + shown + (r.stderr ? ': ' + r.stderr.split('\n')[0].slice(0, 120) : '.'));
  }
};

S['app.close'] = {
  prepare(a) { if (a.vague || a.bad || !a.app) return { skip: needs('Tell me which app to close, for example "close Chrome". I never close "everything".') }; return {}; },
  describe(a, c) { const n = P.resolveApp(c.store.config.apps[a.app.toLowerCase()] || a.app).display; return 'Close ' + n + '? It will ask you to save anything unsaved first.'; },
  async run(a, c) {
    const name = c.store.config.apps[a.app.toLowerCase()] || a.app, shown = P.resolveApp(name).display;
    const r = await c.exec(B.closeApp(c.os, name));
    if (c.dry) return ok('Dry run: would close ' + shown + '.');
    if (r.ok) return ok('Asked ' + shown + ' to close. If it has unsaved work it will ask you first.');
    if (r.code === 3 || /NOTRUNNING/.test(r.stdout) || (!r.notInstalled && r.code === 1)) return ok(shown + ' is not running.');
    return fail('I could not close ' + shown + '.');
  }
};

async function openUrl(c, url, say) {
  let spec;
  try { spec = B.openUrl(c.os, url); } catch (e) { return fail(e.message); }
  const r = await c.exec(spec);
  if (c.dry) return ok('(Dry run, nothing opened.) ' + say);
  if (!r.ok) return fail('I could not open your browser. ' + (c.os === 'linux' ? 'Install xdg-utils so I can use xdg-open.' : ''));
  return ok(say);
}

S['web.open'] = { run: (a, c) => openUrl(c, a.url, 'Opening ' + a.name + '.') };
S['web.search'] = {
  run(a, c) {
    if (a.directions) return openUrl(c, a.url, 'Opening directions to ' + a.q + ' in Google Maps.');
    const e = ENGINE_NAME[a.engine] || a.engine;
    return openUrl(c, a.url, a.play ? 'Opened ' + e + ' results for ' + q(a.q) + '. I cannot press play for you.' : 'Searching ' + e + ' for ' + q(a.q) + '.');
  }
};
S['web.ask'] = { run: (a, c) => openUrl(c, a.url, 'I did not know that, so I searched Google for it.') };

S['folder.open'] = {
  async run(a, c) {
    let dir, shown;
    if (a.custom) { dir = c.store.config.folders[a.folder]; shown = a.folder; } else { dir = c.dirs[a.folder]; shown = FOLDER_NAME[a.folder] || a.folder; }
    if (!dir) return fail('I do not know where ' + a.folder + ' is.');
    if (!c.dry && !fs.existsSync(dir)) return fail('The ' + shown + ' folder is not at ' + dir + '.');
    const r = await c.exec(B.openPath(c.os, dir));
    if (c.dry) return ok('Dry run: would open ' + shown + '.');
    return r.ok ? ok('Opening ' + shown + '.') : fail('I could not open that folder.');
  }
};

S['folder.create'] = {
  async run(a, c) {
    const nm = F.cleanFolderName(a.name);
    if (nm.error) return fail(nm.error);
    const base = c.dirs[a.in] || c.dirs.documents;
    const full = path.join(base, nm.name);
    if (path.dirname(full) !== path.resolve(base)) return fail('That folder name is not allowed.');
    if (c.dry) { c.log('mkdir ' + full); return ok('Dry run: would create ' + q(nm.name) + ' in ' + (FOLDER_NAME[a.in] || 'Documents') + '.'); }
    if (!fs.existsSync(base)) return fail('The ' + (FOLDER_NAME[a.in] || 'Documents') + ' folder is not at ' + base + '.');
    if (fs.existsSync(full)) return ok(q(nm.name) + ' already exists in ' + (FOLDER_NAME[a.in] || 'Documents') + '. I did not change anything.');
    try { fs.mkdirSync(full); } catch (e) { return fail('I could not create that folder: ' + (e.code || e.message)); }
    c.log('mkdir ' + full);
    return ok('Created ' + q(nm.name) + ' in ' + (FOLDER_NAME[a.in] || 'Documents') + '.');
  }
};

// ---------------------------------------------------------------------------------------------------------------
// files
function roots(c, folder) {
  if (folder) return uniq([c.dirs[folder]]);
  const list = ['downloads', 'documents', 'desktop', 'pictures', 'videos', 'music'].map((k) => c.dirs[k]);
  Object.keys(c.store.config.folders).forEach((k) => list.push(c.store.config.folders[k]));
  return uniq(list);
}
function kindExts(kind) { return kind && parser.KINDS[kind] ? parser.KINDS[kind] : null; }
const SHOT_RE = /screen ?shot|screen ?capture|screen ?grab|snip|capture/i;

async function openFile(c, item) {
  if (F.isRunnable(item.name)) {
    const r = await c.exec(B.openPath(c.os, item.dir));
    return ok('I do not launch programs or scripts from files, because that is how a download can run by mistake. I opened its folder instead so you can look at ' + q(item.name) + ' yourself.', { ran: r.ok });
  }
  if (!c.dry && !fs.existsSync(item.path)) return fail(q(item.name) + ' is no longer there.');
  const r = await c.exec(B.openPath(c.os, item.path));
  if (c.dry) return ok('Dry run: would open ' + q(item.name) + '.');
  return r.ok ? ok('Opening ' + q(item.name) + '.') : fail('I could not open ' + q(item.name) + '.');
}

S['file.find'] = {
  async run(a, c) {
    const rs = roots(c, a.folder);
    if (!rs.length) return fail('I do not know where to look.');
    const kind = a.kind || null;
    const res = await F.find({ roots: rs, query: a.query, exts: kindExts(kind), since: a.since, now: c.now().getTime(), limit: 8 });
    const where = a.folder ? FOLDER_NAME[a.folder] : 'Downloads, Documents, Desktop, Pictures, Videos and Music';
    const what = [a.query ? q(a.query) : null, kind].filter(Boolean).join(' ');
    if (!res.items.length) {
      c.results.set([]);
      return ok('I found nothing for ' + (what || 'that') + ' in ' + where + (a.since ? ' from ' + a.since : '') + '.' + (res.truncated ? ' I only looked through the first ' + res.scanned + ' files, so try naming a folder.' : ''));
    }
    c.results.set(res.items);
    const items = itemsFrom(res.items, c.now().getTime());
    if (a.open) {
      const r = await openFile(c, res.items[0]);
      return Object.assign(r, { items: items, say: r.say + (res.total > 1 ? ' (' + (res.total - 1) + ' more matches below.)' : '') });
    }
    return ok('Found ' + (res.total > res.items.length ? res.total + ' files, showing ' + res.items.length : plural(res.total, 'file')) + '. Say "open the first one" to open one.' + (res.truncated ? ' I stopped after ' + res.scanned + ' files, so narrow it with a folder.' : ''), { items: items });
  }
};

S['file.latest'] = {
  async run(a, c) {
    let rs, depth = 1, nameRe = null, exts = kindExts(a.kind), label;
    if (a.screenshot) {
      const pics = c.dirs.pictures;
      rs = uniq([pics && path.join(pics, 'Deskhand'), pics && path.join(pics, 'Screenshots'), pics && path.join(pics, 'Screen Shots'), c.dirs.desktop, pics, c.dirs.downloads]);
      nameRe = SHOT_RE; exts = ['png', 'jpg', 'jpeg']; label = 'screenshot';
    } else if (a.folder) { rs = uniq([c.dirs[a.folder]]); depth = a.kind ? 1 : 0; label = (a.kind || 'file') + ' in ' + FOLDER_NAME[a.folder]; }
    else if (a.kind) { rs = uniq(['downloads', 'desktop', 'documents', 'pictures', 'videos'].map((k) => c.dirs[k])); label = a.kind; }
    else { rs = uniq([c.dirs.downloads]); depth = 0; label = 'download'; }
    const res = await F.latest({ roots: rs, exts: exts, nameRe: nameRe, depth: depth, limit: 5 });
    if (!res.items.length) { c.results.set([]); return ok('I found no ' + label + ' to show.'); }
    c.results.set(res.items);
    const top = res.items[0], when = F.ago(top.mtimeMs, c.now().getTime());
    const items = itemsFrom(res.items, c.now().getTime());
    if (a.open) { const r = await openFile(c, top); return Object.assign(r, { items: items }); }
    return ok('Your newest ' + label + ' is ' + q(top.name) + ' (' + when + '). Say "open it" to open it.', { items: items });
  }
};

S['file.openResult'] = {
  async run(a, c) {
    const list = c.results.get();
    if (!list.length) return needs('I have no list to pick from yet. Try "find my invoice pdf" first.');
    const item = list[a.index - 1];
    if (!item) return fail('There are only ' + plural(list.length, 'result') + ' on the list.');
    const r = await openFile(c, item);
    return a.implicit && list.length > 1 ? Object.assign(r, { say: r.say + ' (That was the first of ' + list.length + '.)' }) : r;
  }
};

S['downloads.organize'] = {
  prepare(a, c) {
    const dir = c.dirs.downloads;
    if (!dir || !fs.existsSync(dir)) return { skip: fail('I could not find your Downloads folder' + (dir ? ' at ' + dir : '') + '.') };
    const plan = F.planOrganize(dir, c.now().getTime());
    if (!plan.moves.length) return { skip: ok('Your Downloads folder is already tidy. ' + (plan.recent ? plan.recent + ' very recent file' + (plan.recent === 1 ? ' is' : 's are') + ' left alone in case it is still downloading.' : 'Nothing to move.')) };
    return { data: plan };
  },
  describe(a, c, plan) { return F.describePlan(plan); },
  run(a, c, plan) {
    const r = F.executeOrganize(plan, { dry: c.dry });
    r.moved.slice(0, 50).forEach((m) => c.log('move ' + m.from + ' -> ' + m.to));
    if (r.moved.length > 50) c.log('... and ' + (r.moved.length - 50) + ' more moves');
    if (c.dry) return ok('Dry run: would move ' + plural(r.moved.length, 'file') + ' into folders in Downloads.');
    if (!r.moved.length) return fail('I could not move anything. The files may have changed since I looked.');
    c.store.addBatch({ at: c.now().getTime(), dir: plan.dir, moves: r.moved, createdDirs: r.createdDirs });
    return ok('Moved ' + plural(r.moved.length, 'file') + ' into folders inside Downloads.' + (r.failed ? ' ' + plural(r.failed, 'file') + ' could not be moved.' : '') + ' Say "undo" to put them back.', { canUndo: true });
  }
};

S['undo'] = {
  run(a, c) {
    const b = c.store.data.batches[c.store.data.batches.length - 1];
    if (!b) return ok('There is nothing to undo. I can only undo a Downloads sort.');
    const r = F.undoBatch(b);
    c.store.popBatch();
    r.restored && c.log('restore ' + r.restored + ' files in ' + b.dir);
    return ok('Put ' + plural(r.restored, 'file') + ' back where ' + (r.restored === 1 ? 'it was' : 'they were') + '.' + (r.skipped ? ' ' + plural(r.skipped, 'file') + ' were left alone because something else is now in their place.' : '') + (r.removedDirs ? ' Removed ' + plural(r.removedDirs, 'empty folder') + ' I had made.' : ''));
  }
};

// ---------------------------------------------------------------------------------------------------------------
// system
function medianLoad(c) { return os.loadavg()[0]; }

async function readBattery(c) {
  if (c.os === 'linux') {
    try {
      const base = '/sys/class/power_supply';
      const names = fs.readdirSync(base).filter((n) => { try { return /^battery$/i.test(fs.readFileSync(path.join(base, n, 'type'), 'utf8').trim()); } catch (e) { return false; } });
      if (!names.length) return { none: true };
      const d = path.join(base, names[0]);
      return P.parseLinuxBattery(fs.readFileSync(path.join(d, 'capacity'), 'utf8'), fs.existsSync(path.join(d, 'status')) ? fs.readFileSync(path.join(d, 'status'), 'utf8') : '') || { none: true };
    } catch (e) { return { none: true }; }
  }
  const r = await c.exec(B.batteryRead(c.os));
  if (c.dry) return { dry: true };
  return P.parseBattery(c.os, r.stdout) || { none: true };
}
function batteryText(b) {
  if (b.dry) return 'Dry run: would read the battery.';
  if (b.none) return 'I cannot read a battery on this computer. It may be a desktop.';
  return 'Battery is at ' + b.percent + '%' + (b.full ? ', fully charged.' : b.charging ? ', charging.' : ', on battery.');
}
async function diskText(c) {
  try {
    const s = await fs.promises.statfs(c.dirs.home || os.homedir());
    const free = s.bavail * s.bsize, total = s.blocks * s.bsize;
    return F.sizeText(free) + ' free of ' + F.sizeText(total) + ' on the drive with your home folder (' + Math.round(free / total * 100) + '% free).';
  } catch (e) { return 'I could not read disk space on this system.'; }
}
function memoryText() {
  let free = os.freemem(); const total = os.totalmem();
  if (os.platform() === 'linux') { try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) free = parseInt(m[1], 10) * 1024; } catch (e) { /* keep os.freemem */ } }
  return F.sizeText(free) + ' of memory available out of ' + F.sizeText(total) + ' (' + Math.round(free / total * 100) + '% free).';
}
function cpuText() {
  const cpus = os.cpus(), model = cpus[0] ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'unknown processor';
  return cpus.length + ' cores, ' + model + (os.platform() === 'win32' ? '.' : '. Load average ' + medianLoad().toFixed(2) + '.');
}

S['system.status'] = {
  async run(a, c) {
    const w = a.what;
    if (w === 'battery') { const b = await readBattery(c); return ok(batteryText(b)); }
    if (w === 'disk') return ok(await diskText(c));
    if (w === 'memory') return ok(memoryText());
    if (w === 'uptime') return ok('This computer has been on for ' + T.fmtDuration(os.uptime() * 1000) + '.');
    if (w === 'cpu') return ok(cpuText());
    const b = await readBattery(c);
    const lines = [batteryText(b), await diskText(c), memoryText(), 'On for ' + T.fmtDuration(os.uptime() * 1000) + '.', cpuText()];
    return ok('Here is how this computer is doing.', { items: lines.map((l, i) => ({ n: i + 1, name: l })) });
  }
};

S['volume.mute'] = {
  async run(a, c) {
    const r = await c.exec(B.mute(c.os, a.mute));
    if (c.dry) return ok('Dry run: would ' + (c.os === 'win32' ? 'toggle mute' : a.mute ? 'mute' : 'unmute') + '.');
    if (!r.ok) return fail('I could not change the mute.' + (c.os === 'linux' ? ' I need pactl or amixer for that.' : ''));
    return ok(c.os === 'win32' ? 'Pressed the mute key. Windows only toggles it, so say it again if it went the wrong way.' : a.mute ? 'Muted.' : 'Unmuted.');
  }
};
S['volume.set'] = {
  async run(a, c) {
    const level = Math.max(0, Math.min(100, a.level));
    const r = await c.exec(B.volumeSet(c.os, level));
    if (c.dry) return ok('Dry run: would set the volume to ' + level + '%.');
    if (!r.ok) return fail('I could not change the volume.' + (c.os === 'linux' ? ' I need pactl or amixer for that.' : ''));
    return ok('Volume set to ' + level + '%.' + (c.os === 'win32' ? ' Windows moves in steps of 2%, so it is approximate.' : '') + (a.level > 100 ? ' (100% is the most.)' : ''));
  }
};
S['volume.change'] = {
  async run(a, c) {
    const by = a.by || 10;
    const r = await c.exec(B.volumeChange(c.os, a.dir, by));
    if (c.dry) return ok('Dry run: would turn the volume ' + a.dir + ' by ' + by + '%.');
    if (!r.ok) return fail('I could not change the volume.' + (c.os === 'linux' ? ' I need pactl or amixer for that.' : ''));
    return ok('Volume ' + a.dir + ' by ' + by + '%.');
  }
};
S['media.key'] = {
  async run(a, c) {
    const label = { playpause: 'play or pause', next: 'next track', prev: 'previous track' }[a.key];
    const r = await c.exec(B.mediaKey(c.os, a.key));
    if (c.dry) return ok('Dry run: would press ' + label + '.');
    if (r.stdout && /NOPLAYER/.test(r.stdout)) return fail('Neither Spotify nor Music is open, so there is nothing to control.');
    if (!r.ok) return fail('I could not send ' + label + '.' + (c.os === 'linux' ? ' Install playerctl so I can control players on Linux.' : ''));
    return ok('Sent ' + label + '.');
  }
};

S['screen.screenshot'] = {
  async run(a, c) {
    const dir = path.join(c.dirs.pictures || c.dirs.home, 'Deskhand'), d = c.now(), p2 = (n) => String(n).padStart(2, '0');
    const file = path.join(dir, 'Screenshot ' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + '.' + p2(d.getMinutes()) + '.' + p2(d.getSeconds()) + '.png');
    if (!c.dry) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return fail('I could not make the folder ' + dir + '.'); } }
    const r = await c.exec(B.screenshot(c.os, file));
    if (c.dry) return ok('Dry run: would save a screenshot to ' + dir + '.');
    if (!r.ok || !fs.existsSync(file)) {
      return fail('I could not take the screenshot.' + (c.os === 'darwin' ? ' macOS may be blocking it: allow your terminal under System Settings, Privacy & Security, Screen Recording.' : c.os === 'linux' ? ' Install gnome-screenshot, grim or scrot.' : ''));
    }
    const st = fs.statSync(file), item = { name: path.basename(file), path: file, dir: dir, mtimeMs: st.mtimeMs, size: st.size };
    c.results.set([item]);
    return ok('Saved a screenshot to Pictures/Deskhand. Say "open it" to see it.', { items: itemsFrom([item], c.now().getTime()) });
  }
};

function powerMsg(c, what) { return c.os === 'win32' ? what + ' in 30 seconds? You can stop it by saying "cancel ' + (what === 'Restart' ? 'restart' : 'shutdown') + '".' : what + ' right now? Save your work first.'; }
S['power.lock'] = { async run(a, c) { const r = await c.exec(B.lock(c.os)); if (c.dry) return ok('Dry run: would lock the screen.'); return r.ok ? ok('Locking the screen.') : fail('I could not lock the screen.'); } };
S['power.sleep'] = { describe: () => 'Put the computer to sleep?', async run(a, c) { const r = await c.exec(B.sleep(c.os)); if (c.dry) return ok('Dry run: would sleep.'); return r.ok ? ok('Going to sleep.') : fail('I could not put it to sleep.'); } };
S['power.shutdown'] = { describe: (a, c) => powerMsg(c, 'Shut down'), async run(a, c) { const r = await c.exec(B.shutdown(c.os)); if (c.dry) return ok('Dry run: would shut down.'); return r.ok ? ok(c.os === 'win32' ? 'Shutting down in 30 seconds. Say "cancel shutdown" to stop it.' : 'Shutting down.') : fail('I could not shut down.'); } };
S['power.restart'] = { describe: (a, c) => powerMsg(c, 'Restart'), async run(a, c) { const r = await c.exec(B.restart(c.os)); if (c.dry) return ok('Dry run: would restart.'); return r.ok ? ok(c.os === 'win32' ? 'Restarting in 30 seconds. Say "cancel restart" to stop it.' : 'Restarting.') : fail('I could not restart.'); } };
S['power.cancel'] = {
  async run(a, c) {
    const spec = B.cancelPower(c.os);
    if (!spec) return ok('There is nothing to cancel. Only Windows gives a 30-second countdown.');
    const r = await c.exec(spec);
    if (c.dry) return ok('Dry run: would cancel the shutdown.');
    return r.ok ? ok('Cancelled. Nothing will shut down.') : ok('There was no shutdown or restart waiting.');
  }
};

S['clipboard.copy'] = {
  async run(a, c) {
    if (a.text.length > 2000) return fail('That is too long to copy.');
    const r = await c.exec(B.clipboardWrite(c.os, a.text));
    if (c.dry) return ok('Dry run: would copy ' + q(a.text.slice(0, 40)) + ' to the clipboard.');
    return r.ok ? ok('Copied to the clipboard.') : fail('I could not reach the clipboard.' + (c.os === 'linux' ? ' Install wl-clipboard or xclip.' : ''));
  }
};

// ---------------------------------------------------------------------------------------------------------------
// time, timers, reminders
S['time.now'] = { run: (a, c) => ok(K.localTimeText(c.now(), c.locale)) };
S['date.today'] = { run: (a, c) => ok(K.localDateText(c.now(), c.locale)) };
S['time.in'] = {
  run(a, c) {
    let home = null; try { home = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* none */ }
    const r = K.timeIn(a.city, c.now(), home);
    return r ? ok(r.text) : fail('I do not know the time zone for ' + q(a.city) + '. Try the name of a big city.');
  }
};
S['time.until'] = {
  run(a, c) {
    const ms = a.at - c.now().getTime();
    if (ms <= 0) return fail('That time has already passed.');
    return ok('It is ' + T.fmtDuration(ms) + ' until ' + T.fmtWhen(new Date(a.at), c.now()) + '.');
  }
};

function ringNote(c) { if (c.flags.ringNote) return ''; c.flags.ringNote = true; return ' Deskhand has to stay open for it to ring.'; }

S['timer.set'] = {
  run(a, c) {
    if (a.need === 'duration' || !a.ms) return needs('For how long? Try "set a timer for 10 minutes".');
    const due = c.now().getTime() + a.ms, r = c.timers.add('timer', { due: due, label: a.label });
    if (r.error) return fail(r.error);
    return ok('Timer ' + (a.label ? q(a.label) + ' ' : '') + 'set for ' + T.fmtDuration(a.ms) + '. It rings at ' + T.fmtClock(new Date(due)) + '.' + ringNote(c));
  }
};
S['focus.start'] = {
  run(a, c) {
    const due = c.now().getTime() + a.ms, r = c.timers.add('focus', { due: due, label: 'Focus' });
    if (r.error) return fail(r.error);
    return ok('Focus session started for ' + T.fmtDuration(a.ms) + (a.defaulted ? ' (the usual 25)' : '') + '. I will ring at ' + T.fmtClock(new Date(due)) + '.' + ringNote(c));
  }
};
S['reminder.set'] = {
  run(a, c) {
    if (a.need === 'recurring') return fail('I cannot repeat reminders yet. Give me one time, for example "remind me at 6pm to send the invoice".');
    if (a.need === 'when') return needs('When? Try "remind me in 20 minutes to stretch" or "remind me at 6pm to call mom".');
    const text = a.text || 'Reminder', r = c.timers.add('reminder', { due: a.at, text: text });
    if (r.error) return fail(r.error);
    return ok('Okay. I will remind you at ' + T.fmtWhen(new Date(a.at), c.now()) + (a.text ? ' to ' + a.text : '') + '.' + ringNote(c));
  }
};
S['timer.list'] = {
  run(a, c) {
    const list = c.timers.list(), now = c.now().getTime();
    if (!list.length) return ok('You have no timers or reminders running.');
    return ok(list.length + (list.length === 1 ? ' thing is' : ' things are') + ' running:', {
      items: list.map((t, i) => ({ n: i + 1, name: (t.kind === 'reminder' ? 'Reminder: ' + (t.text || '') : t.kind === 'focus' ? 'Focus session' : 'Timer' + (t.label ? ': ' + t.label : '')) + ' (' + t.id + ')', info: T.fmtDuration(Math.max(0, t.due - now)) + ' left, rings at ' + T.fmtClock(new Date(t.due)) }))
    });
  }
};
S['timer.cancel'] = {
  run(a, c) {
    const list = c.timers.list();
    if (!list.length) return ok('You have no timers or reminders to cancel.');
    let which = a.which;
    if (!which) {
      if (list.length === 1) which = list[0].id;
      else return needs('You have ' + list.length + ': ' + list.map((t) => t.id).join(', ') + '. Say "cancel timer 2" or "cancel all timers".');
    }
    const removed = c.timers.cancel(which);
    if (!removed.length) return fail('I could not find ' + which.toUpperCase() + '. Say "show my timers" to see them.');
    return ok(removed.length === 1 ? 'Cancelled ' + describeTimer(removed[0]) + '.' : 'Cancelled all ' + removed.length + '.');
  }
};

// ---------------------------------------------------------------------------------------------------------------
// notes
S['note.add'] = {
  run(a, c) {
    const n = c.store.addNote(a.text, c.now().getTime());
    c.log('save note ' + n.id);
    return ok('Noted (' + n.id + '): ' + a.text);
  }
};
S['note.list'] = {
  run(a, c) {
    const list = c.store.data.notes.slice(-15).reverse();
    if (!list.length) return ok('You have no notes. Say "note: buy HDMI cables" to add one.');
    return ok('You have ' + plural(c.store.data.notes.length, 'note') + '. Newest first:', { items: list.map((n, i) => ({ n: i + 1, name: n.text, info: n.id + ' · ' + T.fmtWhen(new Date(n.at), c.now()) })) });
  }
};
S['note.clear'] = {
  prepare(a, c) { const n = c.store.data.notes.length; return n ? { data: n } : { skip: ok('You have no notes to clear.') }; },
  describe: (a, c, n) => 'Clear all ' + plural(n, 'note') + '? This cannot be undone.',
  run(a, c) { const n = c.store.clearNotes(); c.log('clear ' + n + ' notes'); return ok('Cleared ' + plural(n, 'note') + '.'); }
};

// ---------------------------------------------------------------------------------------------------------------
// math
S['math.calc'] = {
  run(a, c) {
    if (a.error) return fail(a.error);
    return ok(a.expr + ' is ' + C.fmtNum(a.value, c.locale) + (a.pct ? '%' : '') + '.');
  }
};
S['math.convert'] = {
  async run(a, c) {
    if (a.currency) {
      const text = C.fmtNum(a.value, 'en-US') + ' ' + a.from + ' to ' + a.to;
      return openUrl(c, parser.ENGINES.google + encodeURIComponent(text), 'I do not know live exchange rates, because they change every day. I opened Google for ' + q(text) + '.');
    }
    const r = C.convert(a.value, a.from, a.to);
    if (r.error) return fail(r.error);
    return ok(C.fmtNum(a.value, c.locale) + ' ' + r.fromName + ' is ' + C.fmtNum(r.value, c.locale) + ' ' + r.toName + '.');
  }
};
S['math.frames'] = {
  run(a) {
    const r = a.frames;
    if (r.error) return fail(r.error);
    const fpsText = r.fps + ' fps';
    if (r.kind === 'tc') return ok(r.frames + ' frames at ' + fpsText + ' is timecode ' + r.value + '.');
    if (r.kind === 'tcframes') return ok(r.timecode + ' at ' + fpsText + ' is ' + r.frames + ' frames.');
    if (r.kind === 'frames') return ok(r.seconds + ' seconds at ' + fpsText + ' is ' + r.frames + ' frames.');
    const secs = Math.round(r.seconds * 1000) / 1000;
    return ok(r.frames + ' frames at ' + fpsText + ' is ' + secs + ' seconds (timecode ' + C.framesToTimecode(r.frames, r.fps) + ').');
  }
};

// ---------------------------------------------------------------------------------------------------------------
S['unsupported'] = { run: (a) => ({ ok: false, status: 'refused', say: a.say }) };

S['routine.list'] = {
  run(a, c) {
    const names = Object.keys(c.store.data.routines);
    if (!names.length) return ok('You have no routines. Try: create routine edit mode: open premiere, open spotify, volume to 30');
    return ok('You have ' + plural(names.length, 'routine') + '. Say "run NAME routine".', { items: names.map((n, i) => ({ n: i + 1, name: n, info: c.store.data.routines[n].steps.join(' then ') })) });
  }
};
S['routine.delete'] = {
  run(a, c) {
    if (!c.store.data.routines[a.name]) return fail('I have no routine called ' + q(a.name) + '.');
    delete c.store.data.routines[a.name]; c.store.save();
    return ok('Deleted the routine ' + q(a.name) + '.');
  }
};

module.exports = { SKILLS: S, openFile: openFile, describeTimer: describeTimer };
