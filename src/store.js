'use strict';
/* Deskhand storage: one small JSON file for your notes, timers, routines and history, and an optional config file you can edit.
   Everything lives in ~/.deskhand (or DESKHAND_HOME). Nothing here is sent anywhere. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./platform');

const HISTORY_MAX = 200;
const NOTES_MAX = 500;
const BATCHES_MAX = 5;

function homeDir() { return process.env.DESKHAND_HOME || path.join(os.homedir(), '.deskhand'); }

function freshData() { return { v: 1, notes: [], timers: [], routines: {}, history: [], batches: [], seq: { note: 0, timer: 0 } }; }

function atomicWrite(file, text) {
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function cleanConfig(raw, warnings) {
  var c = { name: '', locale: '', sites: {}, folders: {}, apps: {} };
  if (!raw || typeof raw !== 'object') return c;
  if (typeof raw.name === 'string') c.name = raw.name.replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 30);
  if (typeof raw.locale === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(raw.locale)) c.locale = raw.locale;
  if (raw.sites && typeof raw.sites === 'object') Object.keys(raw.sites).slice(0, 100).forEach(function (k) {
    try { c.sites[k.toLowerCase().trim()] = P.safeUrl(raw.sites[k]); } catch (e) { warnings.push('config: site "' + k + '" ignored (' + e.message + ')'); }
  });
  if (raw.folders && typeof raw.folders === 'object') Object.keys(raw.folders).slice(0, 100).forEach(function (k) {
    var v = raw.folders[k];
    if (typeof v !== 'string' || !path.isAbsolute(v)) { warnings.push('config: folder "' + k + '" must be a full path'); return; }
    try { if (!fs.statSync(v).isDirectory()) throw new Error('not a folder'); c.folders[k.toLowerCase().trim()] = v; } catch (e) { warnings.push('config: folder "' + k + '" ignored (' + (e.code === 'ENOENT' ? 'does not exist' : e.message) + ')'); }
  });
  if (raw.apps && typeof raw.apps === 'object') Object.keys(raw.apps).slice(0, 100).forEach(function (k) {
    if (typeof raw.apps[k] === 'string' && /^[\p{L}\p{N} ._+\-]{1,60}$/u.test(raw.apps[k])) c.apps[k.toLowerCase().trim()] = raw.apps[k];
    else warnings.push('config: app "' + k + '" ignored (use letters, numbers and spaces only)');
  });
  return c;
}

function createStore(dir) {
  dir = dir || homeDir();
  var warnings = [];
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  var dataFile = path.join(dir, 'data.json'), configFile = path.join(dir, 'config.json');
  var data;
  try { data = Object.assign(freshData(), JSON.parse(fs.readFileSync(dataFile, 'utf8'))); data.seq = Object.assign({ note: 0, timer: 0 }, data.seq); }
  catch (e) {
    if (e && e.code !== 'ENOENT') {
      try { fs.renameSync(dataFile, dataFile + '.corrupt-' + Date.now()); warnings.push('Your data file could not be read, so it was set aside and a fresh one started.'); } catch (e2) { /* ignore */ }
    }
    data = freshData();
  }
  var config;
  try { config = cleanConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')), warnings); }
  catch (e) { if (e && e.code !== 'ENOENT') warnings.push('config.json could not be read: ' + e.message); config = cleanConfig(null, warnings); }

  function save() { atomicWrite(dataFile, JSON.stringify(data)); }
  function nextId(kind, prefix) { data.seq[kind] = (data.seq[kind] || 0) + 1; return prefix + data.seq[kind]; }

  return {
    dir: dir, data: data, config: config, warnings: warnings, save: save,
    addNote: function (text, now) { var n = { id: nextId('note', 'N'), text: String(text).slice(0, 2000), at: now || Date.now() }; data.notes.push(n); if (data.notes.length > NOTES_MAX) data.notes.shift(); save(); return n; },
    clearNotes: function () { var n = data.notes.length; data.notes = []; save(); return n; },
    addHistory: function (h) { data.history.push(h); if (data.history.length > HISTORY_MAX) data.history.splice(0, data.history.length - HISTORY_MAX); save(); },
    nextId: nextId,
    addBatch: function (b) { data.batches.push(b); if (data.batches.length > BATCHES_MAX) data.batches.shift(); save(); },
    popBatch: function () { var b = data.batches.pop(); save(); return b; },
    writeConfig: function (c) { atomicWrite(configFile, JSON.stringify(c, null, 2)); }
  };
}

module.exports = { createStore: createStore, homeDir: homeDir, cleanConfig: cleanConfig, freshData: freshData };
