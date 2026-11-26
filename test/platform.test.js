var H = require('./helpers'), P = require('../src/platform'), X = require('../src/exec');
var t = H.t, eq = H.eq, ok = H.ok;
var B = P.build;

// reads a PowerShell single-quoted literal that starts at index i of s and returns {value, end}
function psLiteral(s, i) {
  eq(s[i], "'"); var v = '', j = i + 1;
  for (;;) { if (s[j] === undefined) throw new Error('unterminated literal'); if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; continue; } return { value: v, end: j + 1 }; } v += s[j]; j++; }
}
function osaLiteral(s, i) {
  eq(s[i], '"'); var v = '', j = i + 1;
  for (;;) { if (s[j] === undefined) throw new Error('unterminated literal'); if (s[j] === '\\') { v += s[j + 1]; j += 2; continue; } if (s[j] === '"') return { value: v, end: j + 1 }; v += s[j]; j++; }
}

H.group('quoting');
var NASTY = ["x'; Remove-Item -Recurse C:\; '", "it's", "a'b'c", "`$(whoami)", '"; rm -rf ~; "', "x`n y"];
NASTY.forEach(function (n) {
  t('psq round trip: ' + n, function () { var q = P.psq(n), r = psLiteral(q, 0); eq(r.value, n); eq(r.end, q.length); });
  t('osaq round trip: ' + n, function () { var q = P.osaq(n), r = osaLiteral(q, 0); eq(r.value, n.replace(/[\u0000-\u001f]/g, ' ')); eq(r.end, q.length); });
});
t('win openApp keeps the name inside one literal', function () {
  NASTY.forEach(function (n) { var sp = B.openApp('win32', n), s = P.psScript(sp), i = s.indexOf('$n = ') + 5, r = psLiteral(s, i); eq(r.value, n); eq(s[r.end], '\n'); });
});
t('win closeApp keeps the name inside one literal', function () {
  NASTY.forEach(function (n) { var s = P.psScript(B.closeApp('win32', n)), i = s.indexOf('$n = ') + 5, r = psLiteral(s, i); eq(r.value, n); eq(s[r.end], '\n'); });
});
t('mac closeApp keeps the name inside one literal', function () {
  NASTY.forEach(function (n) { var sp = B.closeApp('darwin', n), line = sp.then.osa[0], i = line.indexOf('application ') + 12, r = osaLiteral(line, i); eq(r.value, n); eq(line.slice(r.end), ' to quit'); });
});

H.group('apps');
t('aliases', function () { eq(P.resolveApp('VS Code').win, 'Visual Studio Code'); eq(P.resolveApp('premiere').mac, 'Adobe Premiere Pro'); eq(P.resolveApp('AE').proc, 'AfterFX'); eq(P.resolveApp('google chrome').linux[0], 'google-chrome'); });
t('unknown app uses the spoken name', function () { var a = P.resolveApp('My Cool App'); eq(a.win, 'My Cool App'); eq(a.linux, ['my-cool-app', 'mycoolapp']); eq(a.known, false); });
t('open on every system', function () {
  ok(/Get-StartApps/.test(P.psScript(B.openApp('win32', 'chrome')))); eq(B.openApp('darwin', 'chrome').macOpen, 'Google Chrome');
  eq(B.openApp('linux', 'chrome').candidates[0], { cmd: 'google-chrome', args: [], detached: true });
});
t('close on every system', function () {
  ok(/CloseMainWindow/.test(P.psScript(B.closeApp('win32', 'chrome')))); ok(/is running/.test(B.closeApp('darwin', 'chrome').pre.osa[0]));
  eq(B.closeApp('linux', 'chrome').candidates[0], { cmd: 'pkill', args: ['-TERM', '-x', '-i', 'google-chrome'] });
});
t('windows close is a polite close, not a kill', function () { var s = P.psScript(B.closeApp('win32', 'x')); ok(!/Stop-Process|taskkill|Kill\(/i.test(s)); });
t('linux close uses TERM, never KILL', function () { B.closeApp('linux', 'chrome').candidates.forEach(function (c) { ok(c.args.indexOf('-TERM') >= 0); ok(c.args.indexOf('-9') < 0 && c.args.indexOf('-KILL') < 0); }); });

H.group('urls and paths');
t('safe urls', function () { eq(P.safeUrl('https://example.com/a b'), 'https://example.com/a%20b'); eq(P.safeUrl('http://localhost:3000'), 'http://localhost:3000/'); });
['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.com', 'data:text/html,hi', 'chrome://settings', 'vbscript:x', 'https://user:pw@example.com', 'not a url', '', 'ms-settings:network', 'calculator:'].forEach(function (u) {
  t('refuses ' + JSON.stringify(u), function () { var threw = false; try { P.safeUrl(u); } catch (e) { threw = true; } ok(threw); });
});
t('open url per system', function () {
  eq(B.openUrl('linux', 'https://a.com').args, ['https://a.com/']); eq(B.openUrl('darwin', 'https://a.com').cmd, 'open'); ok(/Start-Process 'https:\/\/a\.com\/'/.test(P.psScript(B.openUrl('win32', 'https://a.com'))));
});
t('url with a quote stays in one literal', function () { var s = P.psScript(B.openUrl('win32', "https://a.com/it's")); var i = s.indexOf("'"); var r = psLiteral(s, i); eq(r.end, s.length); });
t('open path', function () { eq(B.openPath('linux', '/home/a b/x').args, ['/home/a b/x']); ok(/-LiteralPath 'C:\\Users\\a'/.test(P.psScript(B.openPath('win32', 'C:\\Users\\a')))); });
t('path with control chars refused', function () { var threw = false; try { B.openPath('linux', 'a\nb'); } catch (e) { threw = true; } ok(threw); });

H.group('sound and media');
t('win volume set uses key presses, 2 percent each', function () { var s = P.psScript(B.volumeSet('win32', 50)); ok(/1\.\.50 \|/.test(s)); ok(/1\.\.25 \|/.test(s)); ok(/\[char\]174/.test(s) && /\[char\]175/.test(s)); });
t('win volume zero', function () { var s = P.psScript(B.volumeSet('win32', 0)); ok(!/1\.\.0/.test(s)); });
t('volume clamps', function () { ok(/1\.\.50 \| ForEach-Object \{ \$w\.SendKeys\(\[char\]175/.test(P.psScript(B.volumeSet('win32', 999)))); eq(B.volumeSet('darwin', -5).osa, ['set volume output volume 0']); });
t('mac volume', function () { eq(B.volumeSet('darwin', 40).osa, ['set volume output volume 40']); });
t('linux volume candidates', function () { eq(B.volumeSet('linux', 40).candidates[0], { cmd: 'pactl', args: ['set-sink-volume', '@DEFAULT_SINK@', '40%'] }); });
t('volume change', function () { ok(/1\.\.5 \|.*175/.test(P.psScript(B.volumeChange('win32', 'up', 10)))); ok(/174/.test(P.psScript(B.volumeChange('win32', 'down', 10)))); ok(/\+ 10/.test(B.volumeChange('darwin', 'up', 10).osa[0])); eq(B.volumeChange('linux', 'down', 10).candidates[0].args[2], '-10%'); });
t('mute', function () { eq(B.mute('darwin', true).osa, ['set volume output muted true']); eq(B.mute('darwin', false).osa, ['set volume output muted false']); ok(B.mute('win32', true).toggles); eq(B.mute('linux', true).candidates[0].args[2], '1'); });
t('media keys', function () { ok(/\[char\]179/.test(P.psScript(B.mediaKey('win32', 'playpause')))); ok(/\[char\]176/.test(P.psScript(B.mediaKey('win32', 'next')))); ok(/\[char\]177/.test(P.psScript(B.mediaKey('win32', 'prev')))); eq(B.mediaKey('linux', 'playpause').candidates[0].args, ['play-pause']); ok(/Spotify/.test(B.mediaKey('darwin', 'next').osa.join(' '))); var threw = false; try { B.mediaKey('linux', 'explode'); } catch (e) { threw = true; } ok(threw); });

H.group('screen, power, clipboard, notify');
t('screenshot', function () { eq(B.screenshot('darwin', '/tmp/a b.png').args, ['-x', '/tmp/a b.png']); ok(/Save\('C:\\p\\a\.png'/.test(P.psScript(B.screenshot('win32', 'C:\\p\\a.png')))); eq(B.screenshot('linux', '/tmp/a.png').candidates[0].cmd, 'gnome-screenshot'); });
t('screenshot path with quote', function () { var s = P.psScript(B.screenshot('win32', "C:\\it's.png")); ok(s.indexOf("'C:\\it''s.png'") > 0); });
t('lock', function () { eq(B.lock('win32'), { cmd: 'rundll32.exe', args: ['user32.dll,LockWorkStation'], label: 'lock' }); eq(B.lock('darwin').cmd, 'pmset'); eq(B.lock('linux').candidates[0].cmd, 'loginctl'); });
t('sleep', function () { ok(/SetSuspendState/.test(P.psScript(B.sleep('win32')))); eq(B.sleep('darwin').args, ['sleepnow']); eq(B.sleep('linux').args, ['suspend']); });
t('windows shutdown waits 30 s and can be cancelled', function () { var s = B.shutdown('win32'); eq(s.cmd, 'shutdown.exe'); eq(s.args.slice(0, 3), ['/s', '/t', '30']); ok(s.cancellable); eq(B.cancelPower('win32').args, ['/a']); eq(B.cancelPower('linux'), null); });
t('restart', function () { eq(B.restart('win32').args.slice(0, 3), ['/r', '/t', '30']); eq(B.restart('linux').args, ['reboot']); ok(/restart/.test(B.restart('darwin').osa[0])); });
t('shutdown never forces', function () { ok(B.shutdown('win32').args.indexOf('/f') < 0); ok(B.shutdown('win32').args.indexOf('/p') < 0); });
t('clipboard sends text on stdin, not in the command', function () { eq(B.clipboardWrite('darwin', 'hi there').input, 'hi there'); eq(B.clipboardWrite('darwin', 'hi').args, []); var w = B.clipboardWrite('win32', "it's $(x)"); eq(w.input, "it's $(x)"); ok(P.psScript(w).indexOf("it's") < 0 && P.psScript(w).indexOf('$(x)') < 0); eq(B.clipboardWrite('linux', 'x').candidates.length, 3); });
t('notify strips breaks and quotes', function () { var n = B.notify('darwin', 'Timer', 'done "now"\nplease'); ok(/display notification "done \\"now\\" please"/.test(n.osa[0])); var w = P.psScript(B.notify('win32', "T'x", "m'\ny")); ok(w.indexOf("'T''x'") > 0); ok(w.indexOf("'m'' y'") > 0); eq(B.notify('linux', 'a', 'b').candidates[0].args, ['a', 'b']); });

H.group('battery and folders');
t('windows battery', function () { eq(P.parseBattery('win32', '{"EstimatedChargeRemaining":73,"BatteryStatus":1}'), { percent: 73, charging: false, full: false }); eq(P.parseBattery('win32', '{"EstimatedChargeRemaining":100,"BatteryStatus":3}').full, true); eq(P.parseBattery('win32', '[{"EstimatedChargeRemaining":50,"BatteryStatus":2}]').charging, true); eq(P.parseBattery('win32', ''), null); eq(P.parseBattery('win32', 'oops'), null); });
t('mac battery', function () {
  eq(P.parseBattery('darwin', "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t95%; discharging; 4:23 remaining present: true"), { percent: 95, charging: false, full: false });
  eq(P.parseBattery('darwin', "Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged; 0:00 remaining present: true"), { percent: 100, charging: true, full: true });
  eq(P.parseBattery('darwin', "Now drawing from 'AC Power'\n -InternalBattery-0\t41%; charging; 1:12 remaining present: true").charging, true);
  eq(P.parseBattery('darwin', "Now drawing from 'AC Power'"), null);
});
t('linux battery', function () { eq(P.parseLinuxBattery('87\n', 'Discharging\n'), { percent: 87, charging: false, full: false }); eq(P.parseLinuxBattery('100', 'Full').full, true); eq(P.parseLinuxBattery('x', ''), null); });
t('default dirs', function () { eq(P.defaultDirs('win32', 'C:\\Users\\b').downloads, 'C:\\Users\\b\\Downloads'); eq(P.defaultDirs('darwin', '/Users/b').videos, '/Users/b/Movies'); eq(P.defaultDirs('linux', '/home/b').videos, '/home/b/Videos'); });
t('known folders parse', function () { var base = P.defaultDirs('win32', 'C:\\Users\\b'); var r = P.parseKnownFolders('{"desktop":"C:\\\\Users\\\\b\\\\OneDrive\\\\Desktop","documents":"","downloads":"D:\\\\dl"}', base); eq(r.desktop, 'C:\\Users\\b\\OneDrive\\Desktop'); eq(r.documents, base.documents); eq(r.downloads, 'D:\\dl'); eq(P.parseKnownFolders('garbage', base), base); });

H.group('display');
t('display text', function () {
  eq(P.display(B.openUrl('linux', 'https://a.com')), 'xdg-open https://a.com/'); eq(P.display(B.openApp('darwin', 'x')), 'open -a "x"'); ok(/^powershell: /.test(P.display(B.openApp('win32', 'x'))));
  eq(P.display(B.screenshot('darwin', '/tmp/a b.png')), 'screencapture -x "/tmp/a b.png"'); ok(/osascript: set volume/.test(P.display(B.volumeSet('darwin', 3)))); ok(/\|  or  /.test(P.display(B.mute('linux', true))));
});
t('flatten', function () { eq(P.flatten(B.volumeSet('linux', 10)).length, 3); eq(P.flatten(B.closeApp('darwin', 'x')).length, 2); });
t('every builder returns something on every system', function () {
  P.OSES.forEach(function (os) {
    [B.openApp(os, 'x'), B.closeApp(os, 'x'), B.openUrl(os, 'https://a.com'), B.openPath(os, '/a'), B.volumeSet(os, 5), B.volumeChange(os, 'up', 5), B.mute(os, true), B.mediaKey(os, 'next'), B.screenshot(os, '/a.png'), B.lock(os), B.sleep(os), B.shutdown(os), B.restart(os), B.clipboardWrite(os, 'x'), B.notify(os, 'a', 'b')].forEach(function (s, i) { ok(s && P.display(s).length > 3, os + ' #' + i); });
  });
});
t('no spec contains a shell string', function () {
  P.OSES.forEach(function (os) {
    P.flatten(B.openApp(os, 'x; ls')).concat(P.flatten(B.closeApp(os, 'x; ls'))).forEach(function (s) { if (s.cmd) { ok(!/\s/.test(s.cmd) && s.cmd !== 'sh' && s.cmd !== 'bash' && s.cmd !== 'cmd' && s.cmd !== 'cmd.exe', s.cmd); eq(s.shell, undefined); } });
  });
});

H.group('exec (real, on this system)');
var T = [];
function ta(name, fn) { T.push(H.tAsync(name, fn)); }
ta('echo', async function () { var r = await X.run({ cmd: 'echo', args: ['hi there'] }); ok(r.ok); eq(r.stdout, 'hi there'); });
ta('arguments are not shell-parsed', async function () { var r = await X.run({ cmd: 'echo', args: ['a; echo PWNED && $(whoami) `id`'] }); eq(r.stdout, 'a; echo PWNED && $(whoami) `id`'); });
ta('stdin', async function () { var r = await X.run({ cmd: 'cat', args: [], input: 'héllo ✓' }); eq(r.stdout, 'héllo ✓'); });
ta('missing program', async function () { var r = await X.run({ cmd: 'definitely-not-installed-xyz', args: [] }); eq(r.ok, false); ok(r.notInstalled); });
ta('candidates skip the missing', async function () { var r = await X.run({ candidates: [{ cmd: 'nope-1', args: [] }, { cmd: 'nope-2', args: [] }, { cmd: 'echo', args: ['third'] }] }); ok(r.ok); eq(r.stdout, 'third'); });
ta('candidates all missing', async function () { var r = await X.run({ candidates: [{ cmd: 'nope-1', args: [] }, { cmd: 'nope-2', args: [] }] }); eq(r.ok, false); ok(r.notInstalled); });
ta('candidates fall through a failure', async function () { var r = await X.run({ candidates: [{ cmd: 'false', args: [] }, { cmd: 'echo', args: ['ok'] }] }); ok(r.ok); });
ta('candidates all fail but installed', async function () { var r = await X.run({ candidates: [{ cmd: 'false', args: [] }] }); eq(r.ok, false); eq(r.notInstalled, false); });
ta('timeout', async function () { var t0 = Date.now(); var r = await X.run({ cmd: 'sleep', args: ['5'] }, { timeoutMs: 300 }); ok(r.timedOut); ok(Date.now() - t0 < 2000); });
ta('detached launch returns at once', async function () { var t0 = Date.now(); var r = await X.run({ cmd: 'sleep', args: ['2'], detached: true }); ok(r.ok && r.detached); ok(Date.now() - t0 < 1000); });
ta('detached missing program', async function () { var r = await X.run({ cmd: 'nope-detached', args: [], detached: true }); eq(r.ok, false); ok(r.notInstalled); });
ta('pre check blocks the follow-up', async function () { var r = await X.run({ pre: { cmd: 'echo', args: ['false'] }, preMatch: '^true', then: { cmd: 'echo', args: ['SHOULD NOT RUN'] }, notRunning: 'NOTRUNNING' }); eq(r.ok, false); eq(r.stdout, 'NOTRUNNING'); });
ta('pre check passes', async function () { var r = await X.run({ pre: { cmd: 'echo', args: ['true'] }, preMatch: '^true', then: { cmd: 'echo', args: ['ran'] } }); eq(r.stdout, 'ran'); });
ta('encodePs is UTF-16LE base64', async function () { eq(Buffer.from(X.encodePs('Write-Output "é"'), 'base64').toString('utf16le'), 'Write-Output "é"'); });
ta('dry exec runs nothing but records', async function () { var ex = X.makeExec({ dry: true }); var r = await ex({ cmd: 'touch', args: ['/tmp/deskhand-should-not-exist-' + process.pid], label: 'x' }); ok(r.dry && r.ok); eq(ex.calls.length, 1); eq(require('fs').existsSync('/tmp/deskhand-should-not-exist-' + process.pid), false); });
ta('live exec records too', async function () { var ex = X.makeExec({}); await ex({ cmd: 'echo', args: ['x'] }); eq(ex.calls[0].dry, false); eq(ex.calls[0].display, 'echo x'); });
Promise.all(T).then(function () { H.done('platform'); });
