'use strict';
/* Deskhand command runner (Node only). Runs the specs that platform.js describes.
   Always spawn with an argument list and shell:false, so nothing a person says can be read as shell syntax. */
const { spawn } = require('child_process');
const P = require('./platform');

const MAX_OUT = 64 * 1024;

function encodePs(script) { return Buffer.from(script, 'utf16le').toString('base64'); }

function runProgram(cmd, args, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var done = false, out = '', err = '', timer = null, child;
    function finish(r) {
      if (done) return; done = true; if (timer) clearTimeout(timer);
      resolve(Object.assign({ ok: r.code === 0, code: r.code, stdout: out.trim(), stderr: err.trim() }, r));
    }
    try {
      child = spawn(cmd, args || [], { shell: false, windowsHide: true, detached: !!o.detached, stdio: o.detached ? 'ignore' : [o.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    } catch (e) { return finish({ code: 127, notInstalled: true, error: String(e.message || e) }); }
    child.on('error', function (e) { finish({ code: e && e.code === 'ENOENT' ? 127 : 126, notInstalled: !!(e && e.code === 'ENOENT'), error: e && e.code }); });
    if (o.detached) {
      child.on('spawn', function () { child.unref(); finish({ code: 0, detached: true }); });
      return;
    }
    child.stdout.on('data', function (d) { if (out.length < MAX_OUT) out += d.toString('utf8'); });
    child.stderr.on('data', function (d) { if (err.length < MAX_OUT) err += d.toString('utf8'); });
    child.on('close', function (code) { finish({ code: code === null ? -1 : code }); });
    if (o.input !== undefined) { child.stdin.on('error', function () {}); child.stdin.end(String(o.input), 'utf8'); }
    timer = setTimeout(function () { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } finish({ code: -1, timedOut: true }); }, o.timeoutMs || 20000);
  });
}

async function run(spec, o) {
  o = o || {};
  if (!spec) return { ok: false, code: 1, stdout: '', stderr: '', error: 'nothing to run' };
  if (spec.ps) {
    var script = P.psScript(spec);
    var args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePs(script)];
    var r = await runProgram('powershell.exe', args, { input: spec.input, detached: spec.detached, timeoutMs: o.timeoutMs });
    if (r.notInstalled) r = await runProgram('pwsh', args, { input: spec.input, detached: spec.detached, timeoutMs: o.timeoutMs });
    return r;
  }
  if (spec.osa) {
    var a = []; spec.osa.forEach(function (l) { a.push('-e', l); });
    return runProgram('osascript', a, { timeoutMs: o.timeoutMs });
  }
  if (spec.macOpen) {
    var r1 = await runProgram('open', ['-a', spec.macOpen], { timeoutMs: o.timeoutMs });
    if (r1.ok) return r1;
    var q = "kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '*" + spec.macOpen.replace(/['"*\\]/g, '') + "*'wc";
    var found = await runProgram('mdfind', ['-onlyin', '/Applications', '-onlyin', '/System/Applications', '-onlyin', (process.env.HOME || '') + '/Applications', q], { timeoutMs: o.timeoutMs });
    var first = found.ok ? found.stdout.split('\n').filter(function (x) { return /\.app$/.test(x); }).sort(function (x, y) { return x.length - y.length; })[0] : null;
    if (!first) return r1;
    return runProgram('open', [first], { timeoutMs: o.timeoutMs });
  }
  if (spec.candidates) {
    var last = null, anyInstalled = false;
    for (var i = 0; i < spec.candidates.length; i++) {
      var rc = await run(spec.candidates[i], o);
      if (rc.ok) return rc;
      if (!rc.notInstalled) anyInstalled = true;
      last = rc;
    }
    return Object.assign({}, last || { code: 127 }, { ok: false, notInstalled: !anyInstalled });
  }
  if (spec.pre) {
    var pr = await run(spec.pre, o);
    if (!pr.ok || !new RegExp(spec.preMatch || '.', 'i').test(pr.stdout)) return { ok: false, code: 3, stdout: spec.notRunning || 'NOTRUNNING', stderr: '' };
    return run(spec.then, o);
  }
  return runProgram(spec.cmd, spec.args, { input: spec.input, detached: spec.detached, timeoutMs: o.timeoutMs });
}

// exec for the engine: records every command, and in dry mode runs none of them.
function makeExec(opts) {
  opts = opts || {};
  var calls = [];
  async function exec(spec, o) {
    var entry = { label: (spec && spec.label) || '', display: P.display(spec), dry: !!opts.dry, at: Date.now() };
    calls.push(entry);
    if (opts.onRun) opts.onRun(entry);
    if (opts.dry) return { ok: true, dry: true, code: 0, stdout: '', stderr: '' };
    return run(spec, o);
  }
  exec.calls = calls;
  return exec;
}

module.exports = { run: run, runProgram: runProgram, makeExec: makeExec, encodePs: encodePs };
