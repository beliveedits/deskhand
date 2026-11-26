var H = require('./helpers'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
var { createStore } = require('../src/store'), { makeExec } = require('../src/exec'), { createEngine } = require('../src/engine'), { createServer } = require('../src/server');
var eq = H.eq, ok = H.ok;

function req(port, o) {
  return new Promise(function (resolve, reject) {
    var headers = Object.assign({ Host: '127.0.0.1:' + port }, o.headers || {});
    var r = http.request({ host: '127.0.0.1', port: port, path: o.path || '/', method: o.method || 'GET', headers: headers }, function (res) {
      var chunks = []; res.on('data', function (c) { chunks.push(c); }); res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    r.on('error', reject); if (o.body !== undefined) r.write(o.body); r.end();
  });
}

(async function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'dhs-')), exited = 0;
  var store = createStore(path.join(home, 'd')), exec = makeExec({ dry: true });
  var engine = createEngine({ os: 'linux', store: store, exec: exec, dry: true, dirs: {}, home: home });
  var srv = createServer({ engine: engine, version: '9.9.9', onExit: function () { exited++; } });
  var port = await srv.listen(0);
  var origin = 'http://127.0.0.1:' + port;

  H.group('binding');
  await H.tAsync('listens on loopback only', async function () { eq(srv.raw.address().address, '127.0.0.1'); ok(port > 0); });

  H.group('login');
  await H.tAsync('no cookie: no screen, no API', async function () {
    var r = await req(port, {}); eq(r.status, 401); ok(!/dh=|session/.test(JSON.stringify(r.headers) + r.body.replace('session', ''))); ok(!r.body.includes(srv.session));
    r = await req(port, { path: '/api/poll' }); eq(r.status, 401); r = await req(port, { path: '/api/command', method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{"text":"open chrome"}' }); eq(r.status, 401);
    eq(exec.calls.length, 0);
  });
  var cookie;
  await H.tAsync('a launch link works once and sets a locked-down cookie', async function () {
    var link = srv.newLink(); var u = new URL(link); eq(u.hostname, '127.0.0.1');
    var r = await req(port, { path: u.pathname + u.search }); eq(r.status, 302); eq(r.headers.location, '/');
    var sc = r.headers['set-cookie'][0]; ok(/HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Path=\//.test(sc)); cookie = sc.split(';')[0];
    r = await req(port, { path: u.pathname + u.search }); eq(r.status, 403);
  });
  await H.tAsync('wrong or made-up codes fail, and many tries lock it for a while', async function () {
    var r = await req(port, { path: '/launch?code=nope' }); eq(r.status, 403); r = await req(port, { path: '/launch' }); eq(r.status, 403);
    for (var i = 0; i < 10; i++) r = await req(port, { path: '/launch?code=bad' + i });
    r = await req(port, { path: '/launch?code=' + srv.newLink().split('code=')[1] }); eq(r.status, 429);
  });
  await H.tAsync('cookie from outside is not accepted', async function () { var r = await req(port, { headers: { Cookie: 'dh=abcdef' } }); eq(r.status, 401); r = await req(port, { headers: { Cookie: 'dh=' } }); eq(r.status, 401); r = await req(port, { headers: { Cookie: 'dh=' + srv.session.slice(0, -1) } }); eq(r.status, 401); });

  H.group('pages');
  await H.tAsync('screen and scripts', async function () {
    var r = await req(port, { headers: { Cookie: cookie } }); eq(r.status, 200); ok(/v9\.9\.9/.test(r.body)); ok(!/\{\{VERSION\}\}/.test(r.body));
    ok(/default-src 'none'/.test(r.headers['content-security-policy']) && /script-src 'self'/.test(r.headers['content-security-policy']) && /frame-ancestors 'none'/.test(r.headers['content-security-policy']));
    eq(r.headers['x-content-type-options'], 'nosniff'); eq(r.headers['cache-control'], 'no-store'); ok(!r.headers['access-control-allow-origin']);
    ['/app.js', '/app.css', '/icon.svg', '/lib/text.js', '/lib/calc.js', '/lib/clock.js', '/lib/parser.js'].forEach(function () {});
    for (var f of ['/app.js', '/app.css', '/icon.svg', '/lib/text.js', '/lib/calc.js', '/lib/clock.js', '/lib/parser.js']) { var x = await req(port, { path: f }); eq(x.status, 200, f); ok(x.body.length > 50, f); }
  });
  await H.tAsync('the page uses no inline script and no outside address', async function () {
    var r = await req(port, { headers: { Cookie: cookie } });
    ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(r.body), 'inline script'); ok(!/\son\w+\s*=/i.test(r.body), 'inline handler'); ok(!/\sstyle\s*=/i.test(r.body), 'inline style'); ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(r.body.replace(/xmlns="[^"]*"/g, '')), 'outside address');
    var js = (await req(port, { path: '/app.js' })).body; ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js), 'unsafe DOM use');
  });
  await H.tAsync('only the listed files are served; no traversal', async function () {
    for (var p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/src/store.js', '/lib/store.js', '/lib/../store.js', '/package.json', '/ui/app.js', '/.env', '//etc/passwd', '/lib/', '/api']) {
      var r = await req(port, { path: p, headers: { Cookie: cookie } }); ok(r.status === 404 || r.status === 400 || r.status === 401, p + ' -> ' + r.status); ok(!/"name": "deskhand"|root:/.test(r.body), p);
    }
  });
  await H.tAsync('other methods and CORS', async function () {
    var r = await req(port, { method: 'OPTIONS', path: '/api/command', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', Cookie: cookie } }); eq(r.status, 405); ok(!r.headers['access-control-allow-origin']);
    r = await req(port, { method: 'PUT', path: '/api/command', headers: { Cookie: cookie } }); eq(r.status, 405); r = await req(port, { method: 'DELETE', headers: { Cookie: cookie } }); eq(r.status, 405);
  });

  H.group('a web page on the internet cannot drive it');
  var J = function (extra) { return Object.assign({ Cookie: cookie, 'Content-Type': 'application/json', Origin: origin }, extra || {}); };
  await H.tAsync('DNS rebinding: a different host name is refused', async function () {
    var r = await req(port, { path: '/api/poll', headers: { Host: 'evil.example.com:' + port, Cookie: cookie } }); eq(r.status, 421);
    r = await req(port, { path: '/', headers: { Host: 'evil.example.com', Cookie: cookie } }); eq(r.status, 421);
    r = await req(port, { path: '/api/poll', headers: { Host: 'localhost:' + port, Cookie: cookie } }); eq(r.status, 200);
    r = await req(port, { path: '/api/poll', headers: { Host: '127.0.0.1:1', Cookie: cookie } }); eq(r.status, 421);
  });
  await H.tAsync('cross-site POST is refused', async function () {
    var before = exec.calls.length;
    var bad = [{ Origin: 'https://evil.example' }, { Origin: 'http://127.0.0.1:' + (port + 1) }, { Origin: 'null' }, { Origin: 'http://localhost.evil.com:' + port }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }];
    for (var i = 0; i < bad.length; i++) { var r = await req(port, { method: 'POST', path: '/api/command', headers: J(bad[i]), body: '{"text":"open chrome"}' }); eq(r.status, 403, JSON.stringify(bad[i])); }
    var h = J(); delete h.Origin; var r2 = await req(port, { method: 'POST', path: '/api/command', headers: h, body: '{"text":"open chrome"}' }); eq(r2.status, 403);
    eq(exec.calls.length, before);
  });
  await H.tAsync('a simple cross-site form post (not JSON) is refused', async function () {
    var before = exec.calls.length;
    for (var ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) { var r = await req(port, { method: 'POST', path: '/api/command', headers: J({ 'Content-Type': ct }), body: '{"text":"open chrome"}' }); eq(r.status, 415, ct); }
    eq(exec.calls.length, before);
  });
  await H.tAsync('bodies are checked', async function () {
    var r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: '{nope' }); eq(r.status, 400);
    r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: '{"text": 5}' }); eq(r.status, 400); r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: '[]' }); eq(r.status, 400);
  });
  await H.tAsync('a huge body is cut off', async function () {
    var r; try { r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'a'.repeat(20000) }) }); ok(r.status === 413); } catch (e) { ok(/ECONNRESET|socket hang up|EPIPE/.test(e.code + e.message)); }
  });

  H.group('the real thing, from the page');
  await H.tAsync('command and poll', async function () {
    var r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'open chrome' }) }); eq(r.status, 200); var j = JSON.parse(r.body); eq(j.status, 'done'); ok(/Dry run/.test(j.say)); ok(j.ran.length === 1);
    r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'set a timer for 5 minutes' }) }); eq(JSON.parse(r.body).status, 'done');
    r = await req(port, { path: '/api/poll?after=0', headers: { Cookie: cookie } }); j = JSON.parse(r.body); eq(j.ok, true); eq(j.state.timers.length, 1); eq(j.state.dry, true); ok(Array.isArray(j.events));
  });
  await H.tAsync('a risky command waits for a yes that has to come through the same door', async function () {
    var r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'shut down' }) }); var j = JSON.parse(r.body); eq(j.status, 'confirm'); ok(j.pending.expiresAt > Date.now());
    var n = exec.calls.length; r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'no' }) }); eq(JSON.parse(r.body).status, 'cancelled'); eq(exec.calls.length, n);
  });
  await H.tAsync('exit command calls the shutdown hook after replying', async function () {
    var r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'exit deskhand' }) }); eq(JSON.parse(r.body).exit, true); await new Promise(function (res) { setTimeout(res, 400); }); eq(exited, 1);
  });
  await H.tAsync('rate limit', async function () {
    var codes = []; for (var i = 0; i < 60; i++) { var r = await req(port, { method: 'POST', path: '/api/command', headers: J(), body: JSON.stringify({ text: 'what time is it' }) }); codes.push(r.status); }
    ok(codes.indexOf(429) >= 0, 'never limited'); ok(codes.filter(function (c) { return c === 200; }).length <= 40);
  });

  await srv.close(); engine.close();
  H.done('server');
})();
