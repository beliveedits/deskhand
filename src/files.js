'use strict';
/* Deskhand file skills: find, newest-first, and the Downloads organizer with undo.
   Rules this file never breaks: it never deletes a file, never overwrites one, and only moves files inside the Downloads folder you pointed it at. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CATEGORIES = {
  Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'bmp', 'tif', 'tiff', 'avif'],
  Videos: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mxf', 'wmv', 'flv'],
  Audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aiff'],
  Documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'pages', 'epub'],
  Spreadsheets: ['xls', 'xlsx', 'csv', 'ods', 'numbers'],
  Presentations: ['ppt', 'pptx', 'key', 'odp'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  Installers: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk'],
  Design: ['psd', 'ai', 'fig', 'sketch', 'xd', 'indd', 'aep', 'prproj', 'drp', 'blend', 'srt']
};
const EXT_TO_CAT = {};
Object.keys(CATEGORIES).forEach(function (c) { CATEGORIES[c].forEach(function (e) { EXT_TO_CAT[e] = c; }); });
const PARTIAL = /\.(crdownload|part|partial|tmp|download|opdownload|aria2)$/i;
const SKIP_DIRS = /^(?:node_modules|\$RECYCLE\.BIN|System Volume Information|AppData|Library|\.git|__pycache__)$/i;
const RECENT_MS = 120000;
const MAX_MOVES = 500;

// Files that run code when opened. Deskhand never launches these; it can show the folder instead.
const RUNNABLE = /\.(?:exe|msi|msp|mst|bat|cmd|com|scr|pif|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|url|jar|dll|reg|inf|scf|cpl|msc|gadget|app|command|sh|bash|zsh|pkg|dmg|apk|deb|rpm|appimage|run|bin|docm|xlsm|pptm|dotm|xlam|iso|img)$/i;
function isRunnable(name) { return RUNNABLE.test(String(name)); }

function extOf(name) { var i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }
function norm(s) { return String(s).toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function isHidden(name) { return name.charAt(0) === '.' || name === 'desktop.ini' || name === 'Thumbs.db' || name === '.DS_Store'; }

async function walk(roots, o) {
  o = o || {};
  var maxDepth = o.maxDepth == null ? 6 : o.maxDepth, maxEntries = o.maxEntries || 30000, deadline = Date.now() + (o.timeMs || 4000);
  var out = [], queue = roots.map(function (r) { return { dir: r, depth: 0 }; }), seen = 0, truncated = false, seenDirs = {};
  while (queue.length) {
    var cur = queue.shift();
    var real = cur.dir; try { real = await fsp.realpath(cur.dir); } catch (e) { continue; }
    if (seenDirs[real]) continue; seenDirs[real] = 1;
    var ents; try { ents = await fsp.readdir(cur.dir, { withFileTypes: true }); } catch (e) { continue; }
    for (var i = 0; i < ents.length; i++) {
      var d = ents[i];
      if (++seen > maxEntries || Date.now() > deadline) { truncated = true; queue.length = 0; break; }
      if (d.isSymbolicLink() || isHidden(d.name)) continue;
      var full = path.join(cur.dir, d.name);
      if (d.isDirectory()) { if (cur.depth < maxDepth && !SKIP_DIRS.test(d.name)) queue.push({ dir: full, depth: cur.depth + 1 }); continue; }
      if (!d.isFile() || PARTIAL.test(d.name)) continue;
      try { var st = await fsp.stat(full); out.push({ path: full, name: d.name, dir: cur.dir, mtimeMs: st.mtimeMs, size: st.size }); } catch (e) { /* vanished */ }
    }
  }
  return { files: out, scanned: seen, truncated: truncated };
}

function sinceRange(since, now) {
  if (!since) return null;
  var d = new Date(now); d.setHours(0, 0, 0, 0); var today = d.getTime(), DAY = 86400000;
  var dow = (d.getDay() + 6) % 7, weekStart = today - dow * DAY;
  if (since === 'today') return [today, Infinity];
  if (since === 'yesterday') return [today - DAY, today];
  if (since === 'this week') return [weekStart, Infinity];
  if (since === 'last week') return [weekStart - 7 * DAY, weekStart];
  if (since === 'this month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), Infinity];
  return null;
}

// find({roots, query, exts, since, now, limit})
async function find(o) {
  var res = await walk(o.roots, { maxDepth: o.maxDepth, maxEntries: o.maxEntries, timeMs: o.timeMs });
  var q = String(o.query || '').trim(), exts = o.exts ? o.exts.slice() : null;
  var em = /\.([a-z0-9]{1,5})$/i.exec(q);
  if (em && EXT_TO_CAT[em[1].toLowerCase()]) { exts = [em[1].toLowerCase()]; q = q.slice(0, em.index); }
  var tokens = norm(q).split(' ').filter(Boolean), range = sinceRange(o.since, o.now || Date.now());
  var hits = res.files.filter(function (f) {
    if (exts && exts.indexOf(extOf(f.name)) < 0) return false;
    if (range && !(f.mtimeMs >= range[0] && f.mtimeMs < range[1])) return false;
    if (!tokens.length) return true;
    var n = norm(f.name.replace(/\.[^.]+$/, ''));
    return tokens.every(function (t) { return n.indexOf(t) >= 0; });
  });
  hits.forEach(function (f) {
    var n = norm(f.name.replace(/\.[^.]+$/, '')), s = 0;
    if (tokens.length) { if (n.indexOf(tokens[0]) === 0) s += 2; if (n === tokens.join(' ')) s += 3; tokens.forEach(function (t) { if (new RegExp('(^| )' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(n)) s += 1; }); }
    f.score = s;
  });
  hits.sort(function (a, b) { return b.score - a.score || b.mtimeMs - a.mtimeMs; });
  return { items: hits.slice(0, o.limit || 10), total: hits.length, scanned: res.scanned, truncated: res.truncated };
}

// latest({roots, exts, nameRe, depth}) -> newest first
async function latest(o) {
  var res = await walk(o.roots, { maxDepth: o.depth == null ? 0 : o.depth, maxEntries: 20000, timeMs: 3000 });
  var list = res.files.filter(function (f) { return (!o.exts || o.exts.indexOf(extOf(f.name)) >= 0) && (!o.nameRe || o.nameRe.test(f.name)); });
  list.sort(function (a, b) { return b.mtimeMs - a.mtimeMs; });
  return { items: list.slice(0, o.limit || 5), total: list.length };
}

// ---- organize downloads ---------------------------------------------------------------------------
function uniqueName(dir, name, taken) {
  var ext = path.extname(name), base = name.slice(0, name.length - ext.length), n = 1, cand = name;
  while (taken[path.join(dir, cand)] || fs.existsSync(path.join(dir, cand))) { n++; cand = base + ' (' + n + ')' + ext; }
  taken[path.join(dir, cand)] = 1;
  return cand;
}

function planOrganize(dir, now) {
  now = now || Date.now();
  var ents = fs.readdirSync(dir, { withFileTypes: true }), moves = [], counts = {}, left = 0, recent = 0, taken = {}, blocked = {};
  ents.forEach(function (d) {
    if (!d.isFile() || d.isSymbolicLink() || isHidden(d.name) || PARTIAL.test(d.name)) return;
    var cat = EXT_TO_CAT[extOf(d.name)];
    if (!cat) { left++; return; }
    var full = path.join(dir, d.name), st;
    try { st = fs.statSync(full); } catch (e) { return; }
    if (now - st.mtimeMs < RECENT_MS) { recent++; return; }
    var catDir = path.join(dir, cat);
    if (blocked[cat] === undefined) { try { var cs = fs.statSync(catDir); blocked[cat] = !cs.isDirectory(); } catch (e) { blocked[cat] = false; } }
    if (blocked[cat]) { left++; return; }
    if (moves.length >= MAX_MOVES) { left++; return; }
    moves.push({ from: full, toDir: catDir, toName: uniqueName(catDir, d.name, taken), category: cat });
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return { dir: dir, moves: moves, counts: counts, left: left, recent: recent, capped: moves.length >= MAX_MOVES };
}

function describePlan(plan) {
  if (!plan.moves.length) return null;
  var cats = Object.keys(plan.counts).map(function (c) { return plan.counts[c] + ' to ' + c; }).join(', ');
  var sample = plan.moves.slice(0, 4).map(function (m) { return m.toName; }).join(', ');
  return 'Move ' + plan.moves.length + ' file' + (plan.moves.length === 1 ? '' : 's') + ' into folders inside Downloads (' + cats + ')? For example: ' + sample + (plan.moves.length > 4 ? ' and more' : '') +
    '. Nothing is deleted, nothing is overwritten, and you can say "undo".' + (plan.left ? ' ' + plan.left + ' file' + (plan.left === 1 ? '' : 's') + ' of other types stay where they are.' : '') + (plan.recent ? ' ' + plan.recent + ' very recent file' + (plan.recent === 1 ? ' is' : 's are') + ' skipped in case they are still downloading.' : '');
}

function executeOrganize(plan, o) {
  o = o || {};
  var moved = [], failed = 0, created = [], dirRoot = path.resolve(plan.dir);
  plan.moves.forEach(function (m) {
    var from = path.resolve(m.from), toDir = path.resolve(m.toDir), to = path.join(toDir, m.toName);
    if (path.dirname(from) !== dirRoot || path.dirname(toDir) !== dirRoot) { failed++; return; }          // stays inside the one folder
    if (!fs.existsSync(from) || fs.existsSync(to)) { failed++; return; }
    if (o.dry) { moved.push({ from: from, to: to }); return; }
    try {
      if (!fs.existsSync(toDir)) { fs.mkdirSync(toDir); created.push(toDir); }
      fs.renameSync(from, to); moved.push({ from: from, to: to });
    } catch (e) { failed++; }
  });
  return { moved: moved, failed: failed, createdDirs: created };
}

function undoBatch(batch) {
  var restored = 0, skipped = 0;
  batch.moves.slice().reverse().forEach(function (m) {
    try {
      if (fs.existsSync(m.to) && !fs.existsSync(m.from)) { fs.renameSync(m.to, m.from); restored++; } else skipped++;
    } catch (e) { skipped++; }
  });
  var removed = 0;
  (batch.createdDirs || []).forEach(function (d) { try { fs.rmdirSync(d); removed++; } catch (e) { /* not empty, leave it */ } });
  return { restored: restored, skipped: skipped, removedDirs: removed };
}

// ---- new folders -------------------------------------------------------------------------------------
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
function cleanFolderName(name) {
  var n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return { error: 'What should the folder be called?' };
  if (n.length > 80) return { error: 'That folder name is too long.' };
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n) || n.indexOf('..') >= 0) return { error: 'Folder names cannot contain \\ / : * ? " < > | or "..".' };
  if (/^[. ]|[. ]$/.test(n)) return { error: 'Folder names cannot start or end with a dot or space.' };
  if (RESERVED.test(n)) return { error: '"' + n + '" is a reserved name on Windows. Pick another.' };
  return { name: n };
}

function linuxUserDirs(text, home) {
  var out = {};
  String(text || '').split('\n').forEach(function (l) {
    var m = /^XDG_(DESKTOP|DOWNLOAD|DOCUMENTS|PICTURES|VIDEOS|MUSIC)_DIR="?([^"\n]+)"?$/.exec(l.trim());
    if (!m) return;
    var p = m[2].replace(/^\$HOME/, home);
    if (!path.isAbsolute(p) || p === home) return;
    out[{ DESKTOP: 'desktop', DOWNLOAD: 'downloads', DOCUMENTS: 'documents', PICTURES: 'pictures', VIDEOS: 'videos', MUSIC: 'music' }[m[1]]] = p;
  });
  return out;
}

function ago(ms, now) {
  var s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  var m = Math.round(s / 60); if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
  var h = Math.round(m / 60); if (h < 48) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  var d = Math.round(h / 24); return d + ' days ago';
}
function sizeText(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return Math.round(b / 1024) + ' KB'; if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'; return (b / 1073741824).toFixed(2) + ' GB'; }

module.exports = { isRunnable: isRunnable, CATEGORIES: CATEGORIES, EXT_TO_CAT: EXT_TO_CAT, walk: walk, find: find, latest: latest, planOrganize: planOrganize, describePlan: describePlan, executeOrganize: executeOrganize, undoBatch: undoBatch,
  cleanFolderName: cleanFolderName, linuxUserDirs: linuxUserDirs, sinceRange: sinceRange, ago: ago, sizeText: sizeText, extOf: extOf, norm: norm, RECENT_MS: RECENT_MS, PARTIAL: PARTIAL };
