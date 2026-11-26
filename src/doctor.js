'use strict';
/* deskhand doctor: checks, on YOUR computer, which skills will work. Read-only unless you pass --live.
   Windows and macOS commands cannot be tested from a Linux build machine, so this is how they get tested for real: by you, in ten seconds. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./platform');
const F = require('./files');
const X = require('./exec');
const pkg = require('../package.json');

function which(name, osName, env) {
  env = env || process.env;
  const sep = osName === 'win32' ? ';' : ':', exts = osName === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat(['']) : [''];
  const dirs = (env.PATH || env.Path || '').split(sep).filter(Boolean);
  for (const d of dirs) for (const e of exts) {
    const p = path.join(d, name + e);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch (x) { /* next */ }
  }
  return null;
}

async function runChecks(o) {
  o = o || {};
  const osName = o.os || process.platform, run = o.run || X.run, find = o.which || ((n) => which(n, osName)), home = o.home || os.homedir();
  const out = [];
  const add = (status, name, detail, fix) => out.push({ status: status, name: name, detail: detail || '', fix: fix || '' });
  const has = (cmds) => cmds.filter((c) => find(c));

  // ---- any system
  const major = parseInt(process.versions.node.split('.')[0], 10);
  add(major >= 18 ? 'ok' : 'fail', 'Node.js ' + process.versions.node, major >= 18 ? '' : 'Deskhand needs Node 18.15 or newer.', 'Install the current LTS from nodejs.org.');
  try { const d = o.dataDir || path.join(home, '.deskhand'); fs.mkdirSync(d, { recursive: true }); const t = path.join(d, '.doctor-' + process.pid); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); add('ok', 'Notes, timers and settings can be saved', d); }
  catch (e) { add('fail', 'Cannot save notes and timers', String(e.code || e.message), 'Check that your home folder is writable, or start with --home SOMEFOLDER.'); }

  // ---- folders
  let dirs = P.defaultDirs(osName, home, osName === 'win32' ? '\\' : '/');
  if (osName === 'win32') { const r = await run({ ps: P.KNOWN_FOLDERS_PS }); if (r.ok) { dirs = P.parseKnownFolders(r.stdout, dirs); add('ok', 'Windows folder locations read (handles OneDrive)', ''); } else add('warn', 'Could not read Windows folder locations', (r.stderr || '').split('\n')[0], 'Deskhand will assume the usual Downloads, Documents and Desktop in your user folder.'); }
  else if (osName === 'linux') { try { dirs = Object.assign(dirs, F.linuxUserDirs(fs.readFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'utf8'), home)); } catch (e) { /* defaults */ } }
  ['downloads', 'documents', 'desktop', 'pictures'].forEach(function (k) {
    let ok = false; try { ok = fs.statSync(dirs[k]).isDirectory(); } catch (e) { /* missing */ }
    add(ok ? 'ok' : 'warn', k.charAt(0).toUpperCase() + k.slice(1) + ' folder', dirs[k], ok ? '' : 'File and folder commands that use it will say it is missing.');
  });

  // ---- per system
  if (osName === 'win32') {
    const ps = await run({ ps: '$PSVersionTable.PSVersion.ToString()' });
    if (!ps.ok) {
      add('fail', 'PowerShell does not run', (ps.stderr || ps.error || '').split('\n')[0], 'Opening apps, volume, screenshots and most of the rest need PowerShell. A work or school policy may block it.');
    } else {
      add('ok', 'PowerShell runs', 'version ' + ps.stdout.split('\n')[0]);
      const apps = await run({ ps: '(Get-StartApps | Measure-Object).Count' });
      const n = parseInt(apps.stdout, 10);
      add(apps.ok && n > 0 ? 'ok' : 'warn', 'Start menu apps found', apps.ok ? n + ' apps' : 'none', 'Without this, "open <app>" falls back to the plain name you said.');
      const bat = await run(P.build.batteryRead(osName));
      const b = bat.ok ? P.parseBattery(osName, bat.stdout) : null;
      add(b ? 'ok' : 'warn', 'Battery', b ? b.percent + '%' + (b.charging ? ' charging' : '') : 'no battery found', b ? '' : 'On a desktop this is normal. "How much battery" will say it cannot read one.');
    }
    add(find('shutdown.exe') ? 'ok' : 'warn', 'shutdown.exe', find('shutdown.exe') || '', 'Shut down and restart need it. It ships with Windows.');
  } else if (osName === 'darwin') {
    const as = await run({ osa: ['return "ok"'] });
    add(as.ok && /ok/.test(as.stdout) ? 'ok' : 'fail', 'AppleScript (osascript) runs', as.ok ? '' : (as.stderr || '').split('\n')[0], 'Volume, mute, shutdown and notifications use it.');
    ['open', 'screencapture', 'pmset', 'mdfind', 'pbcopy'].forEach(function (c) { add(find(c) ? 'ok' : 'warn', c, find(c) || 'not found'); });
    const bat = await run(P.build.batteryRead(osName)), b = bat.ok ? P.parseBattery(osName, bat.stdout) : null;
    add(b ? 'ok' : 'warn', 'Battery', b ? b.percent + '%' : 'no battery found', '');
    add('info', 'macOS permissions', 'The first time you ask for a screenshot, volume change or shutdown, macOS may ask you to allow your terminal. Allow it under System Settings, Privacy & Security (Screen Recording, Automation).');
  } else {
    const groups = [
      ['Open links, files and folders', ['xdg-open'], 'Install xdg-utils.'],
      ['Volume and mute', ['pactl', 'amixer'], 'Install pulseaudio-utils (pactl) or alsa-utils (amixer).'],
      ['Play, pause, next', ['playerctl'], 'Install playerctl.'],
      ['Notifications for timers', ['notify-send'], 'Install libnotify-bin (notify-send). Timers still show on the Deskhand page.'],
      ['Clipboard', ['wl-copy', 'xclip', 'xsel'], 'Install wl-clipboard (Wayland) or xclip (X11).'],
      ['Screenshots', ['gnome-screenshot', 'spectacle', 'grim', 'scrot', 'import'], 'Install gnome-screenshot, grim (Wayland) or scrot.'],
      ['Lock the screen', ['loginctl', 'xdg-screensaver', 'gnome-screensaver-command'], 'Install systemd (loginctl) or xdg-utils.'],
      ['Sleep, restart, shut down', ['systemctl'], 'These need systemd.'],
      ['Close apps politely', ['pkill'], 'Install procps.']
    ];
    groups.forEach(function (g) { const f = has(g[1]); add(f.length ? 'ok' : 'warn', g[0], f.length ? 'using ' + f[0] : 'none of ' + g[1].join(', ') + ' found', f.length ? '' : g[2]); });
    let bat = 'none'; try { const base = '/sys/class/power_supply'; fs.readdirSync(base).forEach(function (n) { try { if (/^battery$/i.test(fs.readFileSync(path.join(base, n, 'type'), 'utf8').trim())) bat = fs.readFileSync(path.join(base, n, 'capacity'), 'utf8').trim() + '%'; } catch (e) { /* skip */ } }); } catch (e) { /* no sysfs */ }
    add(bat === 'none' ? 'warn' : 'ok', 'Battery', bat === 'none' ? 'no battery found' : bat, bat === 'none' ? 'On a desktop this is normal.' : '');
    if (process.env.XDG_SESSION_TYPE) add('info', 'Session type', process.env.XDG_SESSION_TYPE + '. On Wayland, screenshots need grim or gnome-screenshot, and the clipboard needs wl-copy.');
  }

  // ---- harmless live tests, only with --live
  if (o.live) {
    const dir = o.dataDir || path.join(home, '.deskhand');
    const n = await run(P.build.notify(osName, 'Deskhand doctor', 'If you can see this, notifications work.'));
    add(n.ok ? 'ok' : 'warn', 'Live: notification sent', n.ok ? 'check your screen' : (n.stderr || 'not available'), 'Timer alerts will only show on the Deskhand page.');
    const c = await run(P.build.clipboardWrite(osName, 'Deskhand doctor'));
    add(c.ok ? 'ok' : 'warn', 'Live: clipboard written', c.ok ? 'paste somewhere to confirm' : (c.stderr || 'not available'), '');
    const shot = path.join(dir, 'doctor-screenshot.png');
    const s = await run(P.build.screenshot(osName, shot));
    let made = false; try { made = fs.statSync(shot).size > 100; } catch (e) { /* none */ }
    add(s.ok && made ? 'ok' : 'warn', 'Live: screenshot', s.ok && made ? 'saved to ' + shot : (s.stderr || 'could not capture'), osName === 'darwin' ? 'Allow Screen Recording for your terminal.' : '');
  }
  return out;
}

async function doctor(o) {
  o = o || {};
  const log = o.log || console.log;
  log('Deskhand ' + pkg.version + ' doctor on ' + ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[o.os || process.platform] || process.platform) + '. Read-only' + (o.live ? ', plus the live tests you asked for.' : '. Add --live for three harmless live tests (a notification, the clipboard, a screenshot).'));
  log('');
  const res = await runChecks(o);
  const tag = { ok: ' ok ', warn: 'warn', fail: 'FAIL', info: 'note' };
  res.forEach(function (r) { log('[' + tag[r.status] + '] ' + r.name + (r.detail ? '  ' + r.detail : '')); if (r.fix && r.status !== 'ok') log('       ' + r.fix); });
  const fails = res.filter((r) => r.status === 'fail').length, warns = res.filter((r) => r.status === 'warn').length;
  log('');
  log(fails ? fails + ' problem' + (fails === 1 ? '' : 's') + ' that stop things from working.' : warns ? 'Good. ' + warns + ' skill group' + (warns === 1 ? '' : 's') + ' will not work until you install the tool named above; everything else is ready.' : 'Everything checked out.');
  return fails ? 1 : 0;
}

module.exports = { doctor: doctor, runChecks: runChecks, which: which };
