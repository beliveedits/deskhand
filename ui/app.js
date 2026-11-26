/* Deskhand screen. Plain JavaScript, no libraries, no network except this page's own server.
   Every piece of text from the server goes in with textContent, never as HTML. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var parser = window.DeskhandLib && window.DeskhandLib.parser;
  var els = { cmd: $('cmd'), form: $('form'), mic: $('mic'), preview: $('preview'), ask: $('ask'), askText: $('askText'), fuse: $('fuse'), yes: $('yes'), no: $('no'),
    log: $('log'), empty: $('empty'), timers: $('timers'), notimers: $('notimers'), notes: $('notes'), nonotes: $('nonotes'), notecount: $('notecount'), routines: $('routines'),
    routcard: $('routcard'), undo: $('undo'), speak: $('speak'), mode: $('mode'), osname: $('osname'), banner: $('banner'), voicenote: $('voicenote'), chips: $('chips') };
  var OSNAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  var EXAMPLES = ['open Chrome', 'set a timer for 10 minutes', 'find my invoice pdf', 'organize my downloads', 'set the volume to 40', 'what is 15 percent of 2400', 'remind me at 6pm to send the invoice', 'take a screenshot', 'help'];
  var CONFIRM_TOTAL = 45000;

  var S = { after: 0, state: null, pending: null, voiceOk: false, speak: false, listening: false, rec: null, audio: null, down: false };

  function store(k, v) { try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; }
  S.voiceOk = store('dh.voiceOk') === '1'; S.speak = store('dh.speak') === '1'; els.speak.checked = S.speak;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function clock(ms) { return new Date(ms || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function left(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return h ? h + ':' + p(m) + ':' + p(x) : m + ':' + p(x);
  }

  // ---- talking to the server ---------------------------------------------------------------------------
  function api(path, body) {
    var opt = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) { opt.method = 'POST'; opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      if (r.status === 401) { S.down = true; banner('This session has ended. Press Enter in the Deskhand terminal window for a new link, then open it.'); throw new Error('401'); }
      return r.json();
    });
  }
  function banner(t) { if (t) { els.banner.textContent = t; els.banner.hidden = false; } else els.banner.hidden = true; }

  // ---- ledger ------------------------------------------------------------------------------------------------
  function badge(r) {
    if (r.status === 'refused') return ['I will not do that', 'tag no'];
    if (r.status === 'confirm') return ['asked first', 'tag ask'];
    if (r.status === 'cancelled') return ['cancelled', 'tag'];
    if (r.status === 'unknown') return ['not understood', 'tag no'];
    if (r.status === 'needs') return ['need more', 'tag ask'];
    if (r.ok === false) return ['did not work', 'tag no'];
    return ['done', 'tag'];
  }
  function addEntry(said, r, via) {
    els.empty.hidden = true;
    var li = el('li', 'entry' + (r.status === 'refused' ? ' refused' : r.ok === false ? ' bad' : ''));
    var row = el('div', 'erow');
    row.appendChild(el('span', 'etime', clock()));
    row.appendChild(el('span', 'eyou', (via === 'voice' ? '\u{1F3A4} ' : '') + said));
    var b = badge(r); row.appendChild(el('span', b[1], b[0]));
    li.appendChild(row);
    li.appendChild(el('p', 'esay', r.say || ''));
    if (r.ran && r.ran.length) { var ran = el('div', 'ran'); r.ran.forEach(function (c) { ran.appendChild(el('div', null, c)); }); li.appendChild(ran); }
    if (r.items && r.items.length) {
      var ul = el('ul', 'items');
      r.items.forEach(function (it) {
        var item = el('li');
        if (it.n) item.appendChild(el('span', 'n', it.n + '.'));
        item.appendChild(el('span', 'nm', it.name));
        if (it.info) item.appendChild(el('span', 'inf', it.info));
        if (it.path && it.n) { var b2 = el('button', null, 'Open'); b2.type = 'button'; b2.addEventListener('click', function () { send('open result ' + it.n); }); item.appendChild(b2); }
        ul.appendChild(item);
      });
      li.appendChild(ul);
    }
    if (r.help) {
      r.help.forEach(function (g) {
        var box = el('div', 'helpgroup'); box.appendChild(el('h3', null, g.group));
        var chips = el('div', 'chips');
        g.skills.forEach(function (s) { s.examples.forEach(function (ex) { chips.appendChild(chip(ex)); }); });
        box.appendChild(chips); li.appendChild(box);
      });
    }
    els.log.insertBefore(li, els.log.firstChild);
    while (els.log.children.length > 60) els.log.removeChild(els.log.lastChild);
  }
  function chip(text) {
    var b = el('button', 'chip', text); b.type = 'button';
    b.addEventListener('click', function () { els.cmd.value = text; onType(); els.cmd.focus(); });
    return b;
  }

  // ---- sending a command -----------------------------------------------------------------------------------
  function send(text, via) {
    text = String(text || '').trim();
    if (!text) return Promise.resolve();
    unlockAudio();
    return api('/api/command', { text: text }).then(function (r) {
      addEntry(text, r, via);
      setPending(r.status === 'confirm' ? r.pending : null);
      if (S.speak && r.say) speak(r.say);
      if (r.exit) { S.down = true; banner('Deskhand has stopped. You can close this tab.'); return; }
      return poll(true);
    }, function (e) { if (!S.down) banner('Could not reach Deskhand. Is it still running in the terminal?'); });
  }

  els.form.addEventListener('submit', function (e) { e.preventDefault(); var t = els.cmd.value; els.cmd.value = ''; onType(); send(t); });
  els.yes.addEventListener('click', function () { send('yes'); });
  els.no.addEventListener('click', function () { send('no'); });
  els.undo.addEventListener('click', function () { send('undo'); });
  els.speak.addEventListener('change', function () { S.speak = els.speak.checked; store('dh.speak', S.speak ? '1' : '0'); if (!S.speak && window.speechSynthesis) window.speechSynthesis.cancel(); });
  document.addEventListener('keydown', function (e) {
    if (S.pending && !els.cmd.value && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); send('yes'); } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') { e.preventDefault(); send('no'); }
    }
  });

  // ---- what you typed, understood on the spot ------------------------------------------------------------
  function onType() {
    var t = els.cmd.value.trim(), p = els.preview;
    p.textContent = '';
    if (!t || !parser) return;
    var st = { now: new Date(), routines: (S.state ? S.state.routines.map(function (r) { return r.name; }) : []), folders: {}, sites: {}, timers: S.state ? S.state.timers.length : 0, pending: !!S.pending };
    var r; try { r = parser.parseLine(t, st); } catch (e) { return; }
    if (!r.ok) { p.appendChild(document.createTextNode('Not sure what that is yet.')); return; }
    var names = r.steps.map(function (s) { return s.group + ': ' + s.id.split('.').pop().replace(/_/g, ' '); });
    var risky = r.steps.some(function (s) { return s.risk === 'confirm'; }), refused = r.steps.some(function (s) { return s.id === 'unsupported'; });
    p.appendChild(document.createTextNode('Understood as '));
    p.appendChild(el('b', null, names.join(' → ')));
    p.appendChild(document.createTextNode(' '));
    p.appendChild(refused ? el('span', 'tag no', 'I will refuse this') : risky ? el('span', 'tag ask', 'asks first') : el('span', 'tag', 'safe'));
  }
  els.cmd.addEventListener('input', onType);

  // ---- confirmation bar ------------------------------------------------------------------------------------
  function setPending(p) {
    S.pending = p || null;
    els.ask.hidden = !p;
    if (p) { els.askText.textContent = p.text; }
    onType();
  }
  function tickFuse() {
    if (S.pending) {
      var rest = S.pending.expiresAt - Date.now();
      if (rest <= 0) { setPending(null); }
      else els.fuse.style.transform = 'scaleX(' + Math.max(0, Math.min(1, rest / CONFIRM_TOTAL)) + ')';
    }
    var rows = els.timers.querySelectorAll('[data-due]');
    for (var i = 0; i < rows.length; i++) rows[i].textContent = left(Number(rows[i].getAttribute('data-due')) - Date.now());
  }
  setInterval(tickFuse, 400);

  // ---- side panel ----------------------------------------------------------------------------------------------
  function render(s) {
    S.state = s;
    els.mode.hidden = !s.dry;
    els.osname.textContent = (OSNAMES[s.os] || s.os) + (s.name ? ' · ' + s.name : '');
    els.timers.textContent = '';
    s.timers.forEach(function (t) {
      var li = el('li'), txt = el('span', 'txt', t.kind === 'reminder' ? 'Reminder: ' + (t.text || '') : t.kind === 'focus' ? 'Focus session' : 'Timer' + (t.label ? ': ' + t.label : ''));
      var when = el('span', 'when', left(t.due - Date.now())); when.setAttribute('data-due', String(t.due));
      var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Cancel ' + t.id); x.title = 'Cancel'; x.addEventListener('click', function () { send('cancel timer ' + t.id.replace(/^T/i, '')); });
      li.appendChild(txt); li.appendChild(when); li.appendChild(x); els.timers.appendChild(li);
    });
    els.notimers.hidden = s.timers.length > 0;
    els.notes.textContent = '';
    s.notes.slice(0, 5).forEach(function (n) { var li = el('li'); li.appendChild(el('span', 'txt', n.text)); els.notes.appendChild(li); });
    els.nonotes.hidden = s.noteCount > 0;
    els.notecount.textContent = s.noteCount ? '(' + s.noteCount + ')' : '';
    els.routines.textContent = '';
    s.routines.forEach(function (r) { var li = el('li'); li.appendChild(el('span', 'txt', r.name)); var b = el('button', null, '▶'); b.type = 'button'; b.title = 'Run ' + r.name; b.setAttribute('aria-label', 'Run ' + r.name); b.addEventListener('click', function () { send('run ' + r.name + ' routine'); }); li.appendChild(b); els.routines.appendChild(li); });
    els.routcard.hidden = !s.routines.length;
    els.undo.hidden = !s.canUndo;
    if (s.pending && !S.pending) setPending({ text: s.pending.text, expiresAt: s.pending.expiresAt });
    if (!s.pending && S.pending && S.pending.expiresAt > Date.now() + 1000) { /* answered elsewhere */ }
  }

  // ---- polling for timers that ring -----------------------------------------------------------------------
  var pollBusy = false;
  function poll(now) {
    if (pollBusy && !now) return Promise.resolve();
    pollBusy = true;
    return api('/api/poll?after=' + S.after).then(function (d) {
      banner(null);
      d.events.forEach(function (ev) { S.after = Math.max(S.after, ev.id); ring(ev); });
      render(d.state);
    }, function () { /* the banner explains */ }).then(function () { pollBusy = false; });
  }
  function loop() { if (S.down) return; poll(false).then(function () { setTimeout(loop, document.hidden ? 5000 : 1500); }); }

  function ring(ev) {
    addEntry('Timer', { ok: true, say: ev.text }, null);
    beep();
    if (document.hidden) { var base = document.title.replace(/^● /, ''); document.title = '● ' + ev.text; window.addEventListener('focus', function once() { document.title = base; window.removeEventListener('focus', once); }); }
    if (S.speak) speak(ev.text);
  }
  function unlockAudio() { if (!S.audio) { try { S.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { S.audio = null; } } if (S.audio && S.audio.state === 'suspended') S.audio.resume(); }
  function beep() {
    if (!S.audio) return;
    for (var i = 0; i < 3; i++) {
      var o = S.audio.createOscillator(), g = S.audio.createGain(), t0 = S.audio.currentTime + i * 0.28;
      o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.connect(g); g.connect(S.audio.destination); o.start(t0); o.stop(t0 + 0.22);
    }
  }
  function speak(t) { try { var s = window.speechSynthesis; if (!s) return; s.cancel(); s.speak(new SpeechSynthesisUtterance(t)); } catch (e) { /* no voice installed */ } }

  // ---- voice: push to talk, one phrase at a time -----------------------------------------------------------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { els.mic.hidden = true; }
  function setListening(on) { S.listening = on; els.mic.setAttribute('aria-pressed', on ? 'true' : 'false'); els.mic.title = on ? 'Listening. Click to stop.' : 'Speak a command'; }
  function startVoice() {
    if (!SR) return;
    if (!S.voiceOk) { els.voicenote.hidden = false; return; }
    if (S.listening) { try { S.rec.stop(); } catch (e) { /* already stopped */ } return; }
    unlockAudio();
    var rec = new SR(), finalText = '';
    S.rec = rec; rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = function (e) { var t = ''; for (var i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = t; } els.cmd.value = t; onType(); };
    rec.onerror = function (e) {
      var m = { 'not-allowed': 'The microphone is blocked. Allow it in the address bar, or type instead.', 'service-not-allowed': 'The browser would not start speech recognition. Type instead.', 'no-speech': 'I did not hear anything.', 'network': 'Your browser\'s speech service could not be reached. Type instead.', 'audio-capture': 'No microphone was found.' }[e.error];
      if (m) banner(m); setTimeout(function () { banner(null); }, 6000);
    };
    rec.onend = function () { setListening(false); if (finalText) { els.cmd.value = ''; onType(); send(finalText, 'voice'); } };
    try { rec.start(); setListening(true); banner(null); } catch (e) { setListening(false); }
  }
  els.mic.addEventListener('click', startVoice);
  $('voiceok').addEventListener('click', function () { S.voiceOk = true; store('dh.voiceOk', '1'); els.voicenote.hidden = true; startVoice(); });
  $('voiceno').addEventListener('click', function () { els.voicenote.hidden = true; els.cmd.focus(); });

  // ---- start ---------------------------------------------------------------------------------------------------------
  EXAMPLES.forEach(function (x) { els.chips.appendChild(chip(x)); });
  loop();
}());
