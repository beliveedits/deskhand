'use strict';
/* Deskhand local server. Serves the screen and one small JSON API, on 127.0.0.1 only.
   Defences, because a web page on the internet can try to talk to a server on your own computer:
     - listens on 127.0.0.1, never on the network
     - the Host header must be 127.0.0.1 or localhost with our port (stops DNS rebinding)
     - a login cookie (random, HttpOnly, SameSite=Strict), handed out by a single-use link that only the terminal prints
     - POSTs must come from our own page (Origin check) and be application/json (a cross-site page cannot send that without a CORS preflight, and we send no CORS headers)
     - small request bodies, a rate limit, no directory listing, a fixed list of files, strict Content-Security-Policy */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UI = path.join(__dirname, '..', 'ui');
const SRC = __dirname;
const FILES = {
  '/app.js': [path.join(UI, 'app.js'), 'text/javascript; charset=utf-8'],
  '/app.css': [path.join(UI, 'app.css'), 'text/css; charset=utf-8'],
  '/icon.svg': [path.join(UI, 'icon.svg'), 'image/svg+xml'],
  '/lib/text.js': [path.join(SRC, 'text.js'), 'text/javascript; charset=utf-8'],
  '/lib/calc.js': [path.join(SRC, 'calc.js'), 'text/javascript; charset=utf-8'],
  '/lib/clock.js': [path.join(SRC, 'clock.js'), 'text/javascript; charset=utf-8'],
  '/lib/parser.js': [path.join(SRC, 'parser.js'), 'text/javascript; charset=utf-8']
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MAX_BODY = 8 * 1024;
const LAUNCH_MS = 5 * 60 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cookieOf(req, name) {
  const h = req.headers.cookie || '';
  const parts = h.split(/;\s*/);
  for (let i = 0; i < parts.length; i++) { const k = parts[i].indexOf('='); if (k > 0 && parts[i].slice(0, k) === name) return parts[i].slice(k + 1); }
  return '';
}

function createServer(o) {
  const engine = o.engine, version = o.version || '0.0.0';
  const session = o.sessionToken || crypto.randomBytes(32).toString('hex');
  const launches = new Map();
  let port = 0, hits = [], bad = [], blockedUntil = 0;
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8').replace('{{VERSION}}', version);

  function newLink() {
    const code = crypto.randomBytes(18).toString('hex');
    launches.set(code, Date.now() + LAUNCH_MS);
    return 'http://127.0.0.1:' + port + '/launch?code=' + code;
  }

  function send(res, status, body, type, extra) {
    const h = Object.assign({
      'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP
    }, extra || {});
    res.writeHead(status, h);
    res.end(body);
  }
  function json(res, status, obj) { send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }

  function hostOk(req) {
    const h = String(req.headers.host || '').toLowerCase();
    return h === '127.0.0.1:' + port || h === 'localhost:' + port;
  }
  function originOk(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return req.method === 'GET' || req.method === 'HEAD';     // same-origin GETs may omit it; POSTs must carry it
    return origin === 'http://127.0.0.1:' + port || origin === 'http://localhost:' + port;
  }
  function fetchSiteOk(req) {
    const s = req.headers['sec-fetch-site'];
    return !s || s === 'same-origin' || s === 'none';
  }
  function authed(req) { const c = cookieOf(req, 'dh'); return !!c && safeEqual(c, session); }

  function rateOk() {
    const now = Date.now();
    hits = hits.filter((t) => now - t < 10000);
    if (hits.length >= 40) return false;
    hits.push(now); return true;
  }

  function readBody(req, cb) {
    let size = 0; const chunks = []; let done = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY && !done) { done = true; cb(new Error('too big')); req.destroy(); } else if (!done) chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; cb(null, Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', () => { if (!done) { done = true; cb(new Error('read error')); } });
  }

  const server = http.createServer(function (req, res) {
    const addr = req.socket.remoteAddress || '';
    if (!(addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1')) return send(res, 403, 'Forbidden');
    if (!hostOk(req)) return send(res, 421, 'Unexpected host.');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return send(res, 405, 'Method not allowed.', null, { Allow: 'GET, HEAD, POST' });
    let url; try { url = new URL(req.url, 'http://127.0.0.1:' + port); } catch (e) { return send(res, 400, 'Bad request.'); }
    const p = url.pathname;

    if (p === '/launch' && req.method === 'GET') {
      if (Date.now() < blockedUntil) return send(res, 429, 'Too many tries. Wait a minute.');
      const code = url.searchParams.get('code') || '', exp = launches.get(code);
      if (!exp || exp < Date.now()) {
        bad.push(Date.now()); bad = bad.filter((t) => Date.now() - t < 60000);
        if (bad.length >= 10) blockedUntil = Date.now() + 60000;
        return send(res, 403, 'This link has expired or was already used. Press Enter in the Deskhand terminal window for a new one.');
      }
      launches.delete(code);
      return send(res, 302, '', 'text/plain', { Location: '/', 'Set-Cookie': 'dh=' + session + '; HttpOnly; SameSite=Strict; Path=/' });
    }

    if (p === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!authed(req)) return send(res, 401, '<!doctype html><meta charset="utf-8"><title>Deskhand</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Deskhand is running</h1><p>This page needs the link from the Deskhand terminal window. Press Enter there for a fresh one.</p>', 'text/html; charset=utf-8');
      return send(res, 200, req.method === 'HEAD' ? '' : html, 'text/html; charset=utf-8');
    }

    if (FILES[p] && (req.method === 'GET' || req.method === 'HEAD')) {
      let body; try { body = fs.readFileSync(FILES[p][0]); } catch (e) { return send(res, 404, 'Not found.'); }
      return send(res, 200, req.method === 'HEAD' ? '' : body, FILES[p][1]);
    }

    if (p.indexOf('/api/') === 0) {
      if (!authed(req)) return json(res, 401, { ok: false, error: 'Not signed in. Use the link from the Deskhand terminal window.' });
      if (!originOk(req) || !fetchSiteOk(req)) return json(res, 403, { ok: false, error: 'That request did not come from the Deskhand page.' });
      if (p === '/api/poll' && req.method === 'GET') {
        const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
        return json(res, 200, { ok: true, events: engine.takeEvents(after), state: engine.snapshot() });
      }
      if (p === '/api/command' && req.method === 'POST') {
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'Send JSON.' });
        if (!rateOk()) return json(res, 429, { ok: false, error: 'Slow down a little.' });
        return readBody(req, function (err, text) {
          if (err) return json(res, 413, { ok: false, error: 'That request is too large.' });
          let body; try { body = JSON.parse(text); } catch (e) { return json(res, 400, { ok: false, error: 'That was not valid JSON.' }); }
          if (!body || typeof body.text !== 'string') return json(res, 400, { ok: false, error: 'Missing "text".' });
          engine.handle(body.text).then(function (r) {
            json(res, 200, r);
            if (r.exit && o.onExit) setTimeout(o.onExit, 200);
          }, function () { json(res, 500, { ok: false, error: 'Something went wrong.' }); });
        });
      }
      return json(res, 404, { ok: false, error: 'No such endpoint.' });
    }
    return send(res, 404, 'Not found.');
  });

  server.on('clientError', function (e, socket) { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (x) { /* gone */ } });

  function listen(wanted) {
    return new Promise(function (resolve, reject) {
      function bind(pt, retry) {
        server.once('error', function (e) { if (e.code === 'EADDRINUSE' && retry) bind(0, false); else reject(e); });
        server.listen(pt, '127.0.0.1', function () { port = server.address().port; resolve(port); });
      }
      bind(wanted || 0, wanted !== 0 && wanted !== undefined);
    });
  }

  return { listen: listen, newLink: newLink, close: function () { return new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); }); }, get port() { return port; }, session: session, raw: server };
}

module.exports = { createServer: createServer, CSP: CSP };
