/* Deskhand platform layer: builds the exact command to run for each action on Windows, macOS and Linux.
   Pure: it only returns descriptions of commands ("specs"). Nothing runs here, so the website playground can show what each system would do,
   and the tests can check every command as text.

   A spec is one of:
     {cmd, args[], input?, detached?}           run a program with an argument list. Never a shell string.
     {ps: 'script'}                               a PowerShell script (the runner passes it with -EncodedCommand)
     {osa: ['line', ...]}                         AppleScript lines for osascript
     {candidates: [spec, ...]}                    try these in order until one is installed
     {macOpen: 'App Name'}                        open -a, then a Spotlight lookup if that fails
     {pre: spec, preMatch: 'regex', then: spec}   run pre, continue only if its output matches
   Works in Node and in the browser (window.DeskhandLib.platform). */
(function (g, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { g.DeskhandLib = g.DeskhandLib || {}; g.DeskhandLib.platform = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var OSES = ['win32', 'darwin', 'linux'];

  // name -> how each system knows the app. Anything not listed is tried by the name the person said.
  var APPS = {
    chrome: { win: 'Google Chrome', mac: 'Google Chrome', linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'], proc: 'chrome' },
    'google chrome': 'chrome', edge: { win: 'Microsoft Edge', mac: 'Microsoft Edge', linux: ['microsoft-edge', 'microsoft-edge-stable'], proc: 'msedge' }, 'microsoft edge': 'edge',
    firefox: { win: 'Firefox', mac: 'Firefox', linux: ['firefox'], proc: 'firefox' }, safari: { mac: 'Safari', proc: 'Safari' }, brave: { win: 'Brave', mac: 'Brave Browser', linux: ['brave-browser', 'brave'], proc: 'brave' },
    vscode: { win: 'Visual Studio Code', mac: 'Visual Studio Code', linux: ['code'], proc: 'Code' }, 'vs code': 'vscode', 'visual studio code': 'vscode', code: 'vscode',
    notepad: { win: 'Notepad', mac: 'TextEdit', linux: ['gedit', 'kate', 'mousepad', 'xed'], proc: 'notepad' }, textedit: 'notepad', 'text editor': 'notepad',
    calculator: { win: 'Calculator', mac: 'Calculator', linux: ['gnome-calculator', 'kcalc', 'mate-calc', 'galculator'], proc: 'Calculator' }, calc: 'calculator',
    'file explorer': { win: 'explorer', mac: 'Finder', linux: ['nautilus', 'dolphin', 'thunar', 'nemo', 'pcmanfm'], proc: 'explorer' }, explorer: 'file explorer', finder: 'file explorer', files: 'file explorer',
    terminal: { win: 'Windows Terminal', mac: 'Terminal', linux: ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'], proc: 'WindowsTerminal' }, 'command prompt': { win: 'Command Prompt', proc: 'cmd' },
    powershell: { win: 'Windows PowerShell', proc: 'powershell' },
    settings: { win: 'Settings', mac: 'System Settings', linux: ['gnome-control-center', 'systemsettings'], proc: 'SystemSettings' },
    spotify: { win: 'Spotify', mac: 'Spotify', linux: ['spotify'], proc: 'Spotify' }, slack: { win: 'Slack', mac: 'Slack', linux: ['slack'], proc: 'slack' },
    discord: { win: 'Discord', mac: 'Discord', linux: ['discord'], proc: 'Discord' }, zoom: { win: 'Zoom', mac: 'zoom.us', linux: ['zoom'], proc: 'Zoom' },
    teams: { win: 'Microsoft Teams', mac: 'Microsoft Teams', linux: ['teams'], proc: 'ms-teams' }, whatsapp: { win: 'WhatsApp', mac: 'WhatsApp', linux: ['whatsapp-desktop'], proc: 'WhatsApp' },
    telegram: { win: 'Telegram', mac: 'Telegram', linux: ['telegram-desktop'], proc: 'Telegram' }, notion: { win: 'Notion', mac: 'Notion', linux: ['notion-app'], proc: 'Notion' },
    obsidian: { win: 'Obsidian', mac: 'Obsidian', linux: ['obsidian'], proc: 'Obsidian' }, figma: { win: 'Figma', mac: 'Figma', linux: ['figma-linux'], proc: 'Figma' },
    vlc: { win: 'VLC', mac: 'VLC', linux: ['vlc'], proc: 'vlc' }, obs: { win: 'OBS Studio', mac: 'OBS', linux: ['obs'], proc: 'obs64' }, 'obs studio': 'obs',
    premiere: { win: 'Premiere Pro', mac: 'Adobe Premiere Pro', proc: 'Adobe Premiere Pro' }, 'premiere pro': 'premiere', 'adobe premiere': 'premiere', 'adobe premiere pro': 'premiere',
    'after effects': { win: 'After Effects', mac: 'Adobe After Effects', proc: 'AfterFX' }, 'adobe after effects': 'after effects', ae: 'after effects',
    photoshop: { win: 'Photoshop', mac: 'Adobe Photoshop', proc: 'Photoshop' }, 'adobe photoshop': 'photoshop', illustrator: { win: 'Illustrator', mac: 'Adobe Illustrator', proc: 'Illustrator' },
    'adobe illustrator': 'illustrator', lightroom: { win: 'Lightroom', mac: 'Adobe Lightroom', proc: 'Lightroom' }, indesign: { win: 'InDesign', mac: 'Adobe InDesign', proc: 'InDesign' },
    audition: { win: 'Audition', mac: 'Adobe Audition', proc: 'Adobe Audition' }, 'media encoder': { win: 'Media Encoder', mac: 'Adobe Media Encoder', proc: 'Adobe Media Encoder' },
    'davinci resolve': { win: 'DaVinci Resolve', mac: 'DaVinci Resolve', linux: ['resolve'], proc: 'Resolve' }, davinci: 'davinci resolve', resolve: 'davinci resolve',
    blender: { win: 'Blender', mac: 'Blender', linux: ['blender'], proc: 'blender' }, capcut: { win: 'CapCut', mac: 'CapCut', proc: 'CapCut' },
    word: { win: 'Word', mac: 'Microsoft Word', proc: 'WINWORD' }, excel: { win: 'Excel', mac: 'Microsoft Excel', proc: 'EXCEL' }, powerpoint: { win: 'PowerPoint', mac: 'Microsoft PowerPoint', proc: 'POWERPNT' },
    outlook: { win: 'Outlook', mac: 'Microsoft Outlook', proc: 'OUTLOOK' }
  };

  function resolveApp(name) {
    var key = String(name).toLowerCase().trim(), e = APPS[key], hops = 0;
    while (typeof e === 'string' && hops++ < 5) e = APPS[e];
    if (e && typeof e === 'object') return { display: e.win || e.mac || String(name), win: e.win || String(name), mac: e.mac || String(name), linux: e.linux || [key.replace(/\s+/g, '-')], proc: e.proc || String(name), known: true };
    return { display: String(name), win: String(name), mac: String(name), linux: [key.replace(/\s+/g, '-'), key.replace(/\s+/g, '')], proc: String(name), known: false };
  }

  // ---- quoting ---------------------------------------------------------------------------------------
  function psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function osaq(s) { return '"' + String(s).replace(/[\u0000-\u001f]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function oneLine(s, max) { return String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
  function safeUrl(u) {
    var url;
    try { url = new URL(String(u)); } catch (e) { throw new Error('That is not a web address I can open.'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('I only open http and https addresses.');
    if (url.username || url.password) throw new Error('I will not open addresses that contain a password.');
    return url.href;
  }

  function cmd(c, a, extra) { var o = { cmd: c, args: a || [] }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  function tryAll(list) { return { candidates: list }; }

  // ---- builders ----------------------------------------------------------------------------------------
  var B = {};

  B.openApp = function (os, name) {
    var a = resolveApp(name);
    if (os === 'win32') {
      return { ps: [
        '$ErrorActionPreference = "Stop"',
        '$n = ' + psq(a.win),
        '$app = Get-StartApps | Where-Object { $_.Name -like ("*" + $n + "*") } | Sort-Object { $_.Name.Length } | Select-Object -First 1',
        'if ($app) { Start-Process ("shell:AppsFolder\\" + $app.AppID); Write-Output ("OPENED " + $app.Name); exit 0 }',
        'try { Start-Process -FilePath $n; Write-Output ("OPENED " + $n); exit 0 } catch { Write-Output "NOTFOUND"; exit 3 }'
      ].join('\n'), label: 'open ' + a.display };
    }
    if (os === 'darwin') return { macOpen: a.mac, label: 'open ' + a.display };
    return { candidates: a.linux.map(function (c) { return cmd(c, [], { detached: true }); }), label: 'open ' + a.display };
  };

  B.closeApp = function (os, name) {
    var a = resolveApp(name);
    if (os === 'win32') {
      return { ps: [
        '$n = ' + psq(a.proc),
        '$p = @(Get-Process | Where-Object { $_.ProcessName -like ("*" + $n + "*") -and $_.MainWindowHandle -ne 0 })',
        'if ($p.Count -eq 0) { Write-Output "NOTRUNNING"; exit 3 }',
        '$p | ForEach-Object { [void]$_.CloseMainWindow() }',
        'Write-Output ("CLOSED " + $p.Count)'
      ].join('\n'), label: 'close ' + a.display };
    }
    if (os === 'darwin') {
      var mn = a.mac;
      return { pre: { osa: ['application ' + osaq(mn) + ' is running'] }, preMatch: '^true', then: { osa: ['tell application ' + osaq(mn) + ' to quit'] }, notRunning: 'NOTRUNNING', label: 'close ' + a.display };
    }
    return { candidates: a.linux.map(function (c) { return cmd('pkill', ['-TERM', '-x', '-i', c]); }), label: 'close ' + a.display };
  };

  B.openUrl = function (os, url) {
    var u = safeUrl(url);
    if (os === 'win32') return { ps: 'Start-Process ' + psq(u), label: 'open ' + u };
    if (os === 'darwin') return cmd('open', [u], { label: 'open ' + u });
    return cmd('xdg-open', [u], { label: 'open ' + u });
  };

  B.openPath = function (os, p) {
    p = String(p);
    if (/[\u0000-\u001f]/.test(p)) throw new Error('That path has odd characters.');
    if (os === 'win32') return { ps: 'Start-Process -LiteralPath ' + psq(p), label: 'open ' + p };
    if (os === 'darwin') return cmd('open', [p], { label: 'open ' + p });
    return cmd('xdg-open', [p], { label: 'open ' + p });
  };

  B.volumeSet = function (os, level) {
    level = Math.max(0, Math.min(100, Math.round(level)));
    if (os === 'win32') {
      return { ps: ['$w = New-Object -ComObject WScript.Shell', '1..50 | ForEach-Object { $w.SendKeys([char]174) }', (Math.round(level / 2) > 0 ? '1..' + Math.round(level / 2) + ' | ForEach-Object { $w.SendKeys([char]175) }' : '# already at zero'), 'Write-Output "OK"'].join('\n'), label: 'volume to ' + level };
    }
    if (os === 'darwin') return { osa: ['set volume output volume ' + level], label: 'volume to ' + level };
    return tryAll([cmd('pactl', ['set-sink-volume', '@DEFAULT_SINK@', level + '%']), cmd('amixer', ['-D', 'pulse', 'sset', 'Master', level + '%']), cmd('amixer', ['sset', 'Master', level + '%'])]);
  };

  B.volumeChange = function (os, dir, by) {
    by = Math.max(1, Math.min(100, Math.round(by || 10)));
    var sign = dir === 'up' ? '+' : '-';
    if (os === 'win32') {
      var presses = Math.max(1, Math.round(by / 2));
      return { ps: ['$w = New-Object -ComObject WScript.Shell', '1..' + presses + ' | ForEach-Object { $w.SendKeys([char]' + (dir === 'up' ? 175 : 174) + ') }', 'Write-Output "OK"'].join('\n'), label: 'volume ' + dir + ' ' + by };
    }
    if (os === 'darwin') {
      return { osa: ['set v to (output volume of (get volume settings)) ' + sign + ' ' + by, 'if v > 100 then set v to 100', 'if v < 0 then set v to 0', 'set volume output volume v', 'return v'], label: 'volume ' + dir + ' ' + by };
    }
    return tryAll([cmd('pactl', ['set-sink-volume', '@DEFAULT_SINK@', sign + by + '%']), cmd('amixer', ['-D', 'pulse', 'sset', 'Master', by + '%' + sign]), cmd('amixer', ['sset', 'Master', by + '%' + sign])]);
  };

  B.mute = function (os, mute) {
    if (os === 'win32') return { ps: ['$w = New-Object -ComObject WScript.Shell', '$w.SendKeys([char]173)', 'Write-Output "TOGGLED"'].join('\n'), label: 'toggle mute', toggles: true };
    if (os === 'darwin') return { osa: ['set volume output muted ' + (mute ? 'true' : 'false')], label: mute ? 'mute' : 'unmute' };
    return tryAll([cmd('pactl', ['set-sink-mute', '@DEFAULT_SINK@', mute ? '1' : '0']), cmd('amixer', ['-D', 'pulse', 'sset', 'Master', mute ? 'mute' : 'unmute']), cmd('amixer', ['sset', 'Master', mute ? 'mute' : 'unmute'])]);
  };

  B.mediaKey = function (os, key) {
    var code = { playpause: 179, next: 176, prev: 177 }[key];
    if (!code) throw new Error('Unknown media key.');
    if (os === 'win32') return { ps: ['$w = New-Object -ComObject WScript.Shell', '$w.SendKeys([char]' + code + ')', 'Write-Output "OK"'].join('\n'), label: 'media ' + key };
    if (os === 'darwin') {
      var verb = { playpause: 'playpause', next: 'next track', prev: 'previous track' }[key];
      return { osa: ['if application "Spotify" is running then', 'tell application "Spotify" to ' + verb, 'else if application "Music" is running then', 'tell application "Music" to ' + verb, 'else', 'return "NOPLAYER"', 'end if'], label: 'media ' + key };
    }
    var pc = { playpause: 'play-pause', next: 'next', prev: 'previous' }[key];
    return tryAll([cmd('playerctl', [pc])]);
  };

  B.screenshot = function (os, file) {
    file = String(file);
    if (os === 'win32') {
      return { ps: [
        'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
        '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
        '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
        '$g = [System.Drawing.Graphics]::FromImage($bmp)',
        '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
        '$bmp.Save(' + psq(file) + ', [System.Drawing.Imaging.ImageFormat]::Png)',
        '$g.Dispose(); $bmp.Dispose()',
        'Write-Output "OK"'
      ].join('\n'), label: 'screenshot' };
    }
    if (os === 'darwin') return cmd('screencapture', ['-x', file], { label: 'screenshot' });
    return tryAll([cmd('gnome-screenshot', ['-f', file]), cmd('spectacle', ['-b', '-n', '-o', file]), cmd('grim', [file]), cmd('scrot', [file]), cmd('import', ['-window', 'root', file])]);
  };

  B.lock = function (os) {
    if (os === 'win32') return cmd('rundll32.exe', ['user32.dll,LockWorkStation'], { label: 'lock' });
    if (os === 'darwin') return cmd('pmset', ['displaysleepnow'], { label: 'lock' });
    return tryAll([cmd('loginctl', ['lock-session']), cmd('xdg-screensaver', ['lock']), cmd('gnome-screensaver-command', ['-l'])]);
  };

  B.sleep = function (os) {
    if (os === 'win32') return { ps: ['Add-Type -AssemblyName System.Windows.Forms', '[void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)'].join('\n'), label: 'sleep' };
    if (os === 'darwin') return cmd('pmset', ['sleepnow'], { label: 'sleep' });
    return cmd('systemctl', ['suspend'], { label: 'sleep' });
  };

  var SHUT_MSG = 'Deskhand: shutting down in 30 seconds. Say "cancel shutdown" to stop it.';
  var REST_MSG = 'Deskhand: restarting in 30 seconds. Say "cancel restart" to stop it.';
  B.shutdown = function (os) {
    if (os === 'win32') return cmd('shutdown.exe', ['/s', '/t', '30', '/c', SHUT_MSG], { label: 'shutdown in 30 seconds', cancellable: true });
    if (os === 'darwin') return { osa: ['tell application "System Events" to shut down'], label: 'shutdown' };
    return cmd('systemctl', ['poweroff'], { label: 'shutdown' });
  };
  B.restart = function (os) {
    if (os === 'win32') return cmd('shutdown.exe', ['/r', '/t', '30', '/c', REST_MSG], { label: 'restart in 30 seconds', cancellable: true });
    if (os === 'darwin') return { osa: ['tell application "System Events" to restart'], label: 'restart' };
    return cmd('systemctl', ['reboot'], { label: 'restart' });
  };
  B.cancelPower = function (os) {
    if (os === 'win32') return cmd('shutdown.exe', ['/a'], { label: 'cancel shutdown' });
    return null;
  };

  B.clipboardWrite = function (os, text) {
    text = String(text);
    if (os === 'win32') return { ps: ['[Console]::InputEncoding = [System.Text.Encoding]::UTF8', '$t = [Console]::In.ReadToEnd()', 'Set-Clipboard -Value $t', 'Write-Output "OK"'].join('\n'), input: text, label: 'copy to clipboard' };
    if (os === 'darwin') return cmd('pbcopy', [], { input: text, label: 'copy to clipboard' });
    return tryAll([cmd('wl-copy', [], { input: text }), cmd('xclip', ['-selection', 'clipboard'], { input: text }), cmd('xsel', ['--clipboard', '--input'], { input: text })]);
  };

  B.notify = function (os, title, message) {
    title = oneLine(title, 80); message = oneLine(message, 200);
    if (os === 'win32') {
      return { ps: [
        'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.Visible = $true',
        '$n.ShowBalloonTip(10000, ' + psq(title) + ', ' + psq(message) + ', [System.Windows.Forms.ToolTipIcon]::Info)',
        'Start-Sleep -Seconds 10',
        '$n.Dispose()'
      ].join('\n'), label: 'notify', detached: true };
    }
    if (os === 'darwin') return { osa: ['display notification ' + osaq(message) + ' with title ' + osaq(title)], label: 'notify' };
    return tryAll([cmd('notify-send', [title, message])]);
  };

  B.batteryRead = function (os) {
    if (os === 'win32') return { ps: 'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress', label: 'read battery' };
    if (os === 'darwin') return cmd('pmset', ['-g', 'batt'], { label: 'read battery' });
    return null; // Linux reads /sys/class/power_supply directly
  };

  // Turns the output of batteryRead into {percent, charging}. Null if there is no battery.
  function parseBattery(os, out) {
    out = String(out || '').trim();
    if (!out) return null;
    if (os === 'win32') {
      try {
        var j = JSON.parse(out); if (Array.isArray(j)) j = j[0];
        if (!j || typeof j.EstimatedChargeRemaining !== 'number') return null;
        // BatteryStatus: 1 discharging, 2 on AC, 3 fully charged, 4 low, 5 critical, 6 charging, 7 charging high, 8 charging low, 9 charging critical, 11 partially charged
        var st = j.BatteryStatus;
        return { percent: j.EstimatedChargeRemaining, charging: [2, 3, 6, 7, 8, 9, 11].indexOf(st) >= 0, full: st === 3 };
      } catch (e) { return null; }
    }
    if (os === 'darwin') {
      var m = /(\d+)%;\s*([a-z ]+)/i.exec(out);
      if (!m) return null;
      var s = m[2].toLowerCase();
      return { percent: parseInt(m[1], 10), charging: /^(?:charging|charged|finishing charge)/.test(s), full: /^charged/.test(s) };
    }
    return null;
  }
  function parseLinuxBattery(capacity, status) {
    var p = parseInt(String(capacity).trim(), 10);
    if (isNaN(p)) return null;
    var s = String(status || '').trim().toLowerCase();
    return { percent: p, charging: s === 'charging' || s === 'full', full: s === 'full' };
  }

  // Default folder locations. Windows and Linux can redirect these, so the app asks the system too (see dirs in the engine).
  function defaultDirs(os, home, sep) {
    sep = sep || (os === 'win32' ? '\\' : '/');
    function j(n) { return home + sep + n; }
    return { home: home, downloads: j('Downloads'), documents: j('Documents'), desktop: j('Desktop'), pictures: j('Pictures'), videos: os === 'darwin' ? j('Movies') : j('Videos'), music: j('Music') };
  }

  // PowerShell script that prints the real locations as JSON (OneDrive redirects Desktop and Documents on many PCs).
  var KNOWN_FOLDERS_PS = [
    '$s = New-Object -ComObject Shell.Application',
    '$o = [ordered]@{',
    '  desktop = [Environment]::GetFolderPath("Desktop"); documents = [Environment]::GetFolderPath("MyDocuments")',
    '  pictures = [Environment]::GetFolderPath("MyPictures"); videos = [Environment]::GetFolderPath("MyVideos"); music = [Environment]::GetFolderPath("MyMusic")',
    '  downloads = $s.NameSpace("shell:Downloads").Self.Path',
    '}',
    '$o | ConvertTo-Json -Compress'
  ].join('\n');
  function parseKnownFolders(out, base) {
    var res = {}; for (var k in base) res[k] = base[k];
    try {
      var j = JSON.parse(String(out).trim());
      ['desktop', 'documents', 'pictures', 'videos', 'music', 'downloads'].forEach(function (k) { if (typeof j[k] === 'string' && j[k].length > 2 && !/[\u0000-\u001f]/.test(j[k])) res[k] = j[k]; });
    } catch (e) { /* keep defaults */ }
    return res;
  }

  // The text shown in the ledger for a spec: what actually ran.
  function display(spec) {
    if (!spec) return '';
    if (spec.ps) return 'powershell: ' + (Array.isArray(spec.ps) ? spec.ps.join('; ') : String(spec.ps)).replace(/\s*\n\s*/g, '; ');
    if (spec.osa) return 'osascript: ' + spec.osa.join(' / ');
    if (spec.macOpen) return 'open -a ' + JSON.stringify(spec.macOpen);
    if (spec.candidates) return spec.candidates.map(display).join('  |  or  ');
    if (spec.pre) return display(spec.pre) + '  =>  ' + display(spec.then);
    function q(a) { return /^[\w@%+=:,./\\-]+$/.test(a) ? a : JSON.stringify(a); }
    return [spec.cmd].concat(spec.args || []).map(q).join(' ') + (spec.input !== undefined ? '  < ' + JSON.stringify(spec.input.length > 40 ? spec.input.slice(0, 40) + '...' : spec.input) : '');
  }

  // Plain list of the commands, flattened, for tests and the playground. Each item: {kind, text}.
  function flatten(spec) {
    if (!spec) return [];
    if (spec.candidates) return spec.candidates.reduce(function (a, s) { return a.concat(flatten(s)); }, []);
    if (spec.pre) return flatten(spec.pre).concat(flatten(spec.then));
    return [spec];
  }

  // psScript(spec) -> the PowerShell text. The runner encodes it to UTF-16LE base64 for -EncodedCommand.
  function psScript(spec) { return Array.isArray(spec.ps) ? spec.ps.join('\n') : String(spec.ps); }

  return { OSES: OSES, APPS: APPS, resolveApp: resolveApp, build: B, psq: psq, osaq: osaq, safeUrl: safeUrl, oneLine: oneLine, display: display, flatten: flatten, psScript: psScript,
    parseBattery: parseBattery, parseLinuxBattery: parseLinuxBattery, defaultDirs: defaultDirs, KNOWN_FOLDERS_PS: KNOWN_FOLDERS_PS, parseKnownFolders: parseKnownFolders };
});
