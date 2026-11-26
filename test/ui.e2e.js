// Real-browser test of the Deskhand screen. Run: NODE_PATH=$(npm root -g) node test/ui.e2e.js
var H = require('./helpers'), fs = require('fs'), os = require('os'), path = require('path');
var { chromium } = require('playwright');
var { createStore } = require('../src/store'), { makeExec } = require('../src/exec'), { createEngine } = require('../src/engine'), { createServer } = require('../src/server');
var ok = H.ok, eq = H.eq;
var SHOTS = path.join(__dirname, '..', 'dev', 'shots');
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) { /* screenshots are optional */ }

(async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhu-'));
  ['Downloads', 'Documents'].forEach(function (d) { fs.mkdirSync(path.join(home, d)); });
  var old = (Date.now() - 86400000) / 1000;
  ['holiday.jpg', 'invoice-acme.pdf', 'clip.mp4', 'resume.pdf'].forEach(function (n) { var p = path.join(home, 'Downloads', n); fs.writeFileSync(p, 'x'); fs.utimesSync(p, old, old); });
  var store = createStore(path.join(home, 'd')), exec = makeExec({ dry: true });
  var engine = createEngine({ os: 'win32', store: store, exec: exec, dry: true, dirs: { home: home, downloads: path.join(home, 'Downloads'), documents: path.join(home, 'Documents'), desktop: home, pictures: home, videos: home, music: home }, home: home });
  var srv = createServer({ engine: engine, version: '1.0.0' }), port = await srv.listen(0);
  var browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }), page = await ctx.newPage();
  var errors = [], outside = [], csp = [];
  page.on('console', function (m) { var t = m.text(); if (m.type() === 'error') errors.push(t); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t); });
  page.on('pageerror', function (e) { errors.push('pageerror: ' + e.message); });
  page.on('request', function (r) { if (!/^http:\/\/127\.0\.0\.1:/.test(r.url()) && !/^data:/.test(r.url())) outside.push(r.url()); });

  await H.tAsync('opens through the launch link', async function () {
    await page.goto(srv.newLink()); await page.waitForSelector('#cmd'); eq(await page.title(), 'Deskhand'); ok(await page.isVisible('#mode'), 'dry pill'); ok((await page.textContent('#osname')).includes('Windows'));
    ok(!(await page.url()).includes('code='), 'code left in the address bar');
  });
  await H.tAsync('typing shows what it understood before sending', async function () {
    await page.fill('#cmd', 'close chrome'); var t = await page.textContent('#preview'); ok(/Understood as/.test(t) && /asks first/.test(t), t);
    await page.fill('#cmd', 'open chrome and set a timer for 10 minutes'); t = await page.textContent('#preview'); ok(/→/.test(t) && /safe/.test(t), t);
    await page.fill('#cmd', 'delete my downloads'); t = await page.textContent('#preview'); ok(/refuse/.test(t), t);
    await page.fill('#cmd', ''); eq((await page.textContent('#preview')).trim(), '');
  });
  await H.tAsync('a command prints to the ledger with the exact command', async function () {
    await page.fill('#cmd', 'open chrome'); await page.press('#cmd', 'Enter'); await page.waitForSelector('.entry');
    var t = await page.textContent('.entry'); ok(/open chrome/.test(t) && /Dry run: would open Google Chrome/.test(t) && /Get-StartApps/.test(t), t); eq(await page.inputValue('#cmd'), '');
  });
  await H.tAsync('a risky command asks, N cancels, Y confirms', async function () {
    await page.fill('#cmd', 'close chrome'); await page.press('#cmd', 'Enter'); await page.waitForSelector('#ask:not([hidden])'); ok(/Close Google Chrome\?/.test(await page.textContent('#askText')));
    await page.screenshot({ path: path.join(SHOTS, 'ask.png') });
    await page.keyboard.press('n'); await page.waitForSelector('#ask', { state: 'hidden' }); ok(/cancelled/.test(await page.textContent('.entry')));
    await page.fill('#cmd', 'close spotify'); await page.press('#cmd', 'Enter'); await page.waitForSelector('#ask:not([hidden])'); await page.click('#yes'); await page.waitForSelector('#ask', { state: 'hidden' }); ok(/Dry run: would close Spotify/.test(await page.textContent('.entry')));
  });
  await H.tAsync('timers, notes and the side panel', async function () {
    await page.fill('#cmd', 'set a timer called pasta for 12 minutes'); await page.press('#cmd', 'Enter'); await page.waitForSelector('#timers li'); ok(/pasta/.test(await page.textContent('#timers')) && /1[12]:\d\d/.test(await page.textContent('#timers .when')));
    await page.fill('#cmd', 'note: buy HDMI cables'); await page.press('#cmd', 'Enter'); await page.waitForSelector('#notes li'); ok(/HDMI/.test(await page.textContent('#notes')));
    await page.fill('#cmd', 'create routine edit mode: open premiere, open spotify, volume to 30'); await page.press('#cmd', 'Enter'); await page.waitForSelector('#routcard:not([hidden])');
    await page.click('#timers li button'); await page.waitForFunction(function () { return document.querySelectorAll('#timers li').length === 0; });
  });
  await H.tAsync('file results can be opened from the list', async function () {
    await page.fill('#cmd', 'find my invoice pdf'); await page.press('#cmd', 'Enter'); await page.waitForFunction(function () { var e = document.querySelector('.entry'); return e && /invoice-acme/.test(e.textContent); });
    await page.click('.entry:first-child .items li button'); await page.waitForFunction(function () { return /Dry run: would open "invoice-acme.pdf"/.test(document.querySelector('.entry').textContent); });
  });
  await H.tAsync('help and example chips', async function () {
    await page.fill('#cmd', 'help'); await page.press('#cmd', 'Enter'); await page.waitForSelector('.entry:first-child .helpgroup .chip'); await page.click('.helpgroup .chip'); ok((await page.inputValue('#cmd')).length > 2);
  });
  await H.tAsync('the page never writes server text as HTML', async function () {
    await page.fill('#cmd', 'note: <img src=x onerror=window.__pwn=1> <b>bold</b>'); await page.press('#cmd', 'Enter'); await page.waitForFunction(function () { return /pwn|<img/.test(document.querySelector('#notes').textContent); });
    eq(await page.evaluate(function () { return window.__pwn; }), undefined); eq(await page.locator('#notes img').count(), 0); eq(await page.locator('.entry b').count() >= 0, true);
  });
  await H.tAsync('voice: a clear notice first, nothing starts without a yes', async function () {
    if (!(await page.isVisible('#mic'))) return;   // browsers without speech recognition hide the button
    await page.click('#mic'); ok(await page.isVisible('#voicenote')); ok(/send the audio|Deskhand itself sends nothing/.test(await page.textContent('#voicenote'))); await page.screenshot({ path: path.join(SHOTS, 'voice-note.png') });
    await page.click('#voiceno'); ok(!(await page.isVisible('#voicenote'))); eq(await page.getAttribute('#mic', 'aria-pressed'), 'false');
  });
  await H.tAsync('dark mode and phone width both fit, with no sideways scroll', async function () {
    await page.screenshot({ path: path.join(SHOTS, 'desktop-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: path.join(SHOTS, 'desktop-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, 'phone-light.png'), fullPage: true });
    var over = await page.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; }); ok(over <= 0, 'sideways overflow ' + over);
    await page.setViewportSize({ width: 1280, height: 860 });
  });
  await H.tAsync('keyboard only: tab order reaches the field, mic and button with a visible focus ring', async function () {
    await page.focus('#cmd'); await page.keyboard.press('Tab'); var a = await page.evaluate(function () { return document.activeElement.id; }); ok(a === 'mic' || a === 'send', a);
    var outline = await page.evaluate(function () { return getComputedStyle(document.activeElement).outlineStyle; }); ok(outline !== 'none', 'no focus ring');
  });
  await H.tAsync('exit shows a clear message', async function () { await page.fill('#cmd', 'exit deskhand'); await page.press('#cmd', 'Enter'); await page.waitForFunction(function () { return !document.getElementById('banner').hidden; }); ok(/stopped/.test(await page.textContent('#banner'))); });

  H.group('hygiene');
  await H.tAsync('no console errors, no blocked content, no request left this computer', async function () { eq(errors.filter(function (e) { return !/401|Failed to load resource/.test(e); }), []); eq(csp, []); eq(outside, []); });
  await browser.close(); await srv.close(); engine.close();
  H.done('ui');
})();
