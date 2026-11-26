#!/usr/bin/env node
'use strict';
const readline = require('readline');
const path = require('path');
const pkg = require('../package.json');
const { createStore, homeDir } = require('../src/store');
const { makeExec, run } = require('../src/exec');
const { createEngine } = require('../src/engine');
const { createServer } = require('../src/server');
const P = require('../src/platform');

const HELP = `Deskhand ${pkg.version}  Give your laptop a command. It does it.

Usage
  deskhand                      start Deskhand and open it in your browser
  deskhand "open chrome"        run one command here in the terminal
  deskhand repl                 talk to it in the terminal
  deskhand doctor [--live]      check what works on this computer
  deskhand --help | --version

Options
  --dry          do nothing for real. Shows what each command WOULD run.
  --port N       use this port (default 7788; if busy, a free one)
  --no-open      do not open the browser, just print the link
  --home DIR     keep notes, timers and settings here (default ~/.deskhand)

Everything stays on this computer. Deskhand has no network code except the
local page it serves on 127.0.0.1. It runs a fixed list of skills and never deletes files.`;

function parseArgs(argv) {
  const a = { words: [], dry: false, open: true, port: 7788, home: null, help: false, version: false, live: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry') a.dry = true;
    else if (x === '--no-open') a.open = false;
    else if (x === '--live') a.live = true;
    else if (x === '--help' || x === '-h') a.help = true;
    else if (x === '--version' || x === '-v') a.version = true;
    else if (x === '--port') { a.port = parseInt(argv[++i], 10); if (!(a.port >= 0 && a.port < 65536)) { console.error('--port needs a number from 0 to 65535'); process.exit(2); } }
    else if (x === '--home') { a.home = argv[++i]; if (!a.home) { console.error('--home needs a folder'); process.exit(2); } }
    else if (x.indexOf('--') === 0) { console.error('Unknown option ' + x + '. Try --help.'); process.exit(2); }
    else a.words.push(x);
  }
  return a;
}

function makeEngine(a, onRun) {
  const store = createStore(a.home || homeDir());
  const exec = makeExec({ dry: a.dry, onRun: onRun });
  const engine = createEngine({ os: process.platform, store: store, exec: exec, dry: a.dry, onRing: function (t) { process.stdout.write('\n  * ' + t + '\n'); } });
  return { store: store, exec: exec, engine: engine };
}

function show(r) {
  console.log(r.say);
  (r.ran || []).forEach(function (l) { console.log('  $ ' + l); });
  (r.items || []).slice(0, 12).forEach(function (it) { console.log('  ' + (it.n ? it.n + '. ' : '') + it.name + (it.info ? '   (' + it.info + ')' : '')); });
  if (r.help) r.help.forEach(function (g) { console.log('\n' + g.group); g.skills.forEach(function (s) { console.log('  ' + s.examples.join('   |   ') + (s.risk === 'confirm' ? '   [asks first]' : '')); }); });
}

async function oneShot(a) {
  const ctx = makeEngine(a);
  const warn = ctx.store.warnings; warn.forEach(function (w) { console.error('Note: ' + w); });
  await ctx.engine.init();
  let r = await ctx.engine.handle(a.words.join(' '));
  show(r);
  if (r.status === 'confirm') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Only a clear yes goes ahead. Anything else, including a closed input, counts as no.
    const ans = await new Promise(function (res) { rl.once('close', function () { res(''); }); rl.question('> ', res); });
    rl.close();
    r = await ctx.engine.handle(/^\s*(?:y|yes|yeah|yep|sure|ok|okay|confirm|do it|go ahead)\s*$/i.test(ans) ? 'yes' : 'no'); show(r);
  }
  ctx.engine.close();
  process.exitCode = r.ok || r.status === 'cancelled' ? 0 : 1;
}

async function repl(a) {
  const ctx = makeEngine(a);
  ctx.store.warnings.forEach(function (w) { console.error('Note: ' + w); });
  await ctx.engine.init();
  console.log('Deskhand ' + pkg.version + (a.dry ? ' (dry run: nothing will really happen)' : '') + '. Type a command, or "help". Ctrl+C to quit.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', async function (line) {
    if (line.trim()) { const r = await ctx.engine.handle(line); show(r); if (r.exit) { rl.close(); return; } }
    rl.prompt();
  });
  rl.on('close', function () { ctx.engine.close(); process.exit(0); });
}

async function serve(a) {
  const ctx = makeEngine(a);
  ctx.store.warnings.forEach(function (w) { console.error('Note: ' + w); });
  await ctx.engine.init();
  let server;
  function shutdown() { ctx.engine.close(); server.close().then(function () { process.exit(0); }); setTimeout(function () { process.exit(0); }, 1500).unref(); }
  server = createServer({ engine: ctx.engine, version: pkg.version, onExit: shutdown });
  let port;
  try { port = await server.listen(a.port); } catch (e) { console.error('Could not start the local server: ' + e.message); process.exit(1); }
  const link = server.newLink();
  console.log('Deskhand ' + pkg.version + ' is running' + (a.dry ? '  (dry run: nothing will really happen)' : '') + '.');
  console.log('  Your link (works once, for 5 minutes): ' + link);
  console.log('  Press Enter here for a fresh link. Press Ctrl+C to stop.');
  async function openBrowser(url) { try { const spec = P.build.openUrl(process.platform, url); await run(spec); } catch (e) { /* the link is printed anyway */ } }
  if (a.open) openBrowser(link);
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', function () { const l = server.newLink(); console.log('  New link: ' + l); openBrowser(l); });
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

(async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { console.log(HELP); return; }
  if (a.version) { console.log(pkg.version); return; }
  const first = (a.words[0] || '').toLowerCase();
  if (first === 'doctor' && a.words.length === 1) { const { doctor } = require('../src/doctor'); process.exitCode = await doctor({ live: a.live, dataDir: a.home || undefined }); return; }
  if (first === 'repl' && a.words.length === 1) return repl(a);
  if (a.words.length) return oneShot(a);
  return serve(a);
})().catch(function (e) { console.error('Deskhand stopped: ' + (e && e.message || e)); process.exit(1); });
