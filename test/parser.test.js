var H = require('./helpers'), P = require('../src/parser');
var t = H.t, eq = H.eq, ok = H.ok;
var NOW = new Date(2026, 10, 26, 14, 30, 0);
var STATE = { now: NOW, routines: ['edit mode', 'morning'], folders: { clients: '/x' }, sites: { mysite: 'https://example.org' }, timers: 0, pending: false };
function p(s, st) { return P.parse(s, Object.assign({}, STATE, st || {})); }

H.group('every rule example parses to its own rule');
P.RULES.forEach(function (r) {
  r.examples.forEach(function (ex) {
    t(r.id + ' <- ' + ex, function () { var res = p(ex); ok(res.ok, 'not understood: ' + ex); eq(res.id, r.id, 'got ' + res.id); });
  });
});

H.group('apps and web');
t('open chrome', function () { var r = p('open chrome'); eq(r.id, 'app.open'); eq(r.args.app, 'chrome'); });
t('keeps case of app', function () { eq(p('Open Premiere Pro').args.app, 'Premiere Pro'); });
t('strips app word', function () { eq(p('open the spotify app').args.app, 'spotify'); eq(p('launch my calculator').args.app, 'calculator'); });
t('hey deskhand wake', function () { eq(p('Hey Deskhand, could you please launch DaVinci Resolve?').args.app, 'DaVinci Resolve'); });
t('jarvis wake word', function () { eq(p('Jarvis, open notepad').args.app, 'notepad'); });
t('close needs confirm', function () { var r = p('close chrome'); eq(r.id, 'app.close'); eq(r.risk, 'confirm'); eq(r.args.app, 'chrome'); });
t('close this window is vague', function () { var r = p('close this window'); eq(r.id, 'app.close'); ok(r.args.vague); });
t('unsafe app name flagged', function () { var r = p('open chrome & del *'); eq(r.id, 'app.open'); ok(r.args.bad); r = p('open "x"; rm -rf /'); ok(r.args.bad); });
t('site alias', function () { var r = p('open youtube'); eq(r.id, 'web.open'); eq(r.args.url, 'https://www.youtube.com'); });
t('google chrome is an app, not a site', function () { eq(p('open google chrome').id, 'app.open'); });
t('domain', function () { var r = p('open vaghelabhavesh.com'); eq(r.id, 'web.open'); eq(r.args.url, 'https://vaghelabhavesh.com'); });
t('https url kept', function () { eq(p('go to https://example.com/a?b=1').args.url, 'https://example.com/a?b=1'); });
t('file name is not a domain', function () { var r = p('open report.pdf'); eq(r.id, 'file.find'); eq(r.args.open, true); eq(r.args.query, 'report.pdf'); });
t('user site', function () { eq(p('open mysite').args.url, 'https://example.org'); });
t('javascript url not accepted', function () { var r = p('open javascript:alert(1)'); ok(r.id !== 'web.open'); });
t('file url not accepted', function () { var r = p('open file:///etc/passwd'); ok(r.id !== 'web.open'); });
t('search', function () { var r = p('search for best monitors under 20000'); eq(r.id, 'web.search'); eq(r.args.engine, 'google'); ok(/q=best%20monitors%20under%2020000$/.test(r.args.url)); });
t('search youtube', function () { var r = p('search youtube for lofi beats'); eq(r.args.engine, 'youtube'); ok(/search_query=lofi%20beats$/.test(r.args.url)); });
t('play on youtube', function () { eq(p('play lofi beats on youtube').args.engine, 'youtube'); eq(p('play arijit singh').args.engine, 'youtube'); });
t('google x', function () { eq(p('google react hooks').args.q, 'react hooks'); });
t('look up', function () { eq(p('look up the rule of 40').id, 'web.search'); });
t('search with special chars is encoded', function () { var r = p('search for a&b=c#d'); ok(/q=a%26b%3Dc%23d$/.test(r.args.url)); });
t('directions', function () { var r = p('directions to rajkot airport'); eq(r.id, 'web.search'); ok(/destination=rajkot%20airport$/.test(r.args.url)); });
t('question falls back to a web search', function () { var r = p('why is the sky blue'); eq(r.id, 'web.ask'); ok(r.args.fallback); });
t('search my files goes to files', function () { eq(p('search my files for tax').id, 'file.find'); });

H.group('files');
t('latest download', function () { var r = p('open my latest download'); eq(r.id, 'file.latest'); eq(r.args.open, true); eq(r.args.folder, 'downloads'); });
t('latest screenshot', function () { var r = p('show my latest screenshot'); eq(r.args.screenshot, true); eq(r.args.open, false); });
t('latest video', function () { var r = p('open the newest video in downloads'); eq(r.args.kind, 'video'); eq(r.args.folder, 'downloads'); });
t('find kind and query', function () { var r = p('find my invoice pdf'); eq(r.id, 'file.find'); eq(r.args.query, 'invoice'); eq(r.args.kind, 'pdf'); });
t('find in folder since', function () { var r = p('find videos in downloads from this week'); eq(r.args.folder, 'downloads'); eq(r.args.since, 'this week'); eq(r.args.query, ''); eq(r.args.kind, 'videos'); });
t('where is', function () { eq(p('where is my resume').args.query, 'resume'); eq(p("where's the brand guide").args.query, 'brand guide'); });
t('find online goes to the web', function () { eq(p('find a good pizza place online').id, 'web.search'); eq(p('find lofi on youtube').id, 'web.search'); });
t('open the second one', function () { eq(p('open the second one').args.index, 2); eq(p('open number three').args.index, 3); eq(p('open result 4').args.index, 4); eq(p('open the first').args.index, 1); });
t('open it', function () { var r = p('open it'); eq(r.id, 'file.openResult'); ok(r.args.implicit); });
t('organize downloads confirms', function () { var r = p('organise my downloads'); eq(r.id, 'downloads.organize'); eq(r.risk, 'confirm'); });
t('folder open', function () { eq(p('open downloads').args.folder, 'downloads'); eq(p('open my documents folder').args.folder, 'documents'); eq(p('open clients').args.folder, 'clients'); eq(p('open clients').args.custom, true); });
t('create folder', function () { var r = p('create a folder called Client Work on the desktop'); eq(r.args.name, 'Client Work'); eq(r.args.in, 'desktop'); eq(p('make a folder invoices').args.in, 'documents'); });
t('undo', function () { eq(p('undo').id, 'undo'); eq(p('put them back').id, 'undo'); });

H.group('system');
t('volume set', function () { eq(p('set the volume to 40').args.level, 40); eq(p('volume to fifty five').args.level, 55); eq(p('volume 80').args.level, 80); eq(p('make the volume 75%').args.level, 75); });
t('volume change', function () { eq(p('louder').args, { dir: 'up', by: null }); eq(p('turn the volume down').args.dir, 'down'); eq(p('increase the volume by 20').args, { dir: 'up', by: 20 }); eq(p('lower the volume by twenty percent').args.by, 20); });
t('mute', function () { eq(p('mute').args.mute, true); eq(p('unmute').args.mute, false); eq(p('mute the sound').args.mute, true); });
t('media keys', function () { eq(p('pause').args.key, 'playpause'); eq(p('next song').args.key, 'next'); eq(p('previous track').args.key, 'prev'); eq(p('skip').args.key, 'next'); eq(p('resume').args.key, 'playpause'); });
t('screenshot', function () { eq(p('take a screenshot').id, 'screen.screenshot'); eq(p('screenshot').id, 'screen.screenshot'); });
t('status', function () { eq(p('how much battery do i have').args.what, 'battery'); eq(p('battery').args.what, 'battery'); eq(p('how much disk space is left').args.what, 'disk'); eq(p('how is my laptop doing').args.what, 'all'); eq(p('how much memory is free').args.what, 'memory'); eq(p('what is the uptime').args.what, 'uptime'); });
t('power asks first', function () { ['shut down', 'restart', 'go to sleep'].forEach(function (c) { eq(p(c).risk, 'confirm', c); }); eq(p('lock the screen').risk, 'safe'); });
t('power words need the machine noun', function () { ok(p('turn off the volume').id !== 'power.shutdown'); eq(p('turn off the laptop').id, 'power.shutdown'); });
t('cancel shutdown', function () { eq(p('cancel shutdown').id, 'power.cancel'); });
t('copy to clipboard', function () { eq(p('copy Hello World to clipboard').args.text, 'Hello World'); });

H.group('time');
t('timer', function () { eq(p('set a timer for ten minutes').args.ms, 600000); eq(p('25 minute timer').args.ms, 1500000); eq(p('timer 90 seconds').args.ms, 90000); eq(p('set a timer for an hour and a half').args.ms, 5400000); });
t('timer label', function () { var r = p('set a timer called pasta for 12 minutes'); eq(r.args.label, 'pasta'); eq(p('start a 5 minute timer for tea').args.label, 'tea'); eq(p('set a timer for 10 minutes').args.label, null); });
t('timer without duration asks', function () { eq(p('set a timer').args.need, 'duration'); });
t('timer list and cancel', function () { eq(p('what timers do i have').id, 'timer.list'); eq(p('cancel the timer').args.which, null); eq(p('cancel all timers').args.which, 'all'); eq(p('cancel timer 2').args.which, 't2'); eq(p('stop my timer').id, 'timer.cancel'); });
t('focus', function () { eq(p('focus for 25 minutes').args.ms, 1500000); eq(p('start a focus session').args.ms, 1500000); eq(p('pomodoro').args.defaulted, true); eq(p('focus mode for an hour').args.ms, 3600000); });
t('reminder in', function () { var r = p('remind me to call mom in 20 minutes'); eq(r.id, 'reminder.set'); eq(r.args.text, 'call mom'); eq(r.args.ms, 1200000); });
t('reminder at', function () { var r = p('remind me at 6pm to send the invoice'); eq(r.args.text, 'send the invoice'); eq(new Date(r.args.at).getHours(), 18); });
t('reminder tomorrow', function () { var r = p('remind me tomorrow at 9am to post the reel'); eq(r.args.text, 'post the reel'); var d = new Date(r.args.at); eq(d.getDate(), 27); eq(d.getHours(), 9); });
t('reminder keeps case', function () { eq(p('Remind me to email Riya in 10 minutes').args.text, 'email Riya'); });
t('reminder word order', function () { eq(p('remind me in an hour to stretch').args.text, 'stretch'); eq(p('remind me about the invoice at 5pm').args.text, 'the invoice'); });
t('reminder without time asks', function () { var r = p('remind me to call mom'); eq(r.args.need, 'when'); eq(r.args.text, 'call mom'); });
t('alarm', function () { var r = p('set an alarm for 6am'); eq(r.id, 'reminder.set'); eq(r.args.text, 'Alarm'); eq(new Date(r.args.at).getHours(), 6); });
t('time', function () { eq(p('what time is it').id, 'time.now'); eq(p("what's the time").id, 'time.now'); eq(p('what is the date').id, 'date.today'); eq(p('what day is it').id, 'date.today'); });
t('time in city', function () { eq(p('what time is it in tokyo').args.city, 'tokyo'); eq(p('time in new york').args.city, 'new york'); });
t('time until', function () { eq(p('how long until 6pm').id, 'time.until'); });

H.group('notes and routines');
t('notes', function () { eq(p('note: buy HDMI cables').args.text, 'buy HDMI cables'); eq(p('take a note that the client call moved to friday').args.text, 'the client call moved to friday'); eq(p('remember that rent is due on the 5th').args.text, 'rent is due on the 5th'); eq(p('add milk to my notes').args.text, 'milk'); });
t('note text is not changed by number words', function () { eq(p('note: buy two apples').args.text, 'buy two apples'); });
t('show notes', function () { eq(p('show my notes').id, 'note.list'); eq(p('clear my notes').risk, 'confirm'); });
t('routine create', function () { var r = p('create routine edit mode: open premiere, open spotify, volume to 30'); eq(r.id, 'routine.create'); eq(r.args.name, 'edit mode'); eq(r.args.steps, ['open premiere', 'open spotify', 'volume to 30']); });
t('routine steps with then', function () { eq(p('make a routine called wrap up: take a screenshot then close chrome').args.steps, ['take a screenshot', 'close chrome']); });
t('routine run by name', function () { eq(p('edit mode').id, 'routine.run'); eq(p('run edit mode').args.name, 'edit mode'); eq(p('start my morning routine').args.name, 'morning'); });
t('routine delete and list', function () { eq(p('delete routine edit mode').args.name, 'edit mode'); eq(p('list my routines').id, 'routine.list'); });

H.group('math');
t('calc', function () { var r = p('what is 15 percent of 2400'); eq(r.id, 'math.calc'); H.near(r.args.value, 360); });
t('calc words', function () { H.near(p('what is five plus five').args.value, 10); H.near(p('calculate twelve times three').args.value, 36); });
t('calc with gst', function () { H.near(p('add 18% to 1000').args.value, 1180); });
t('calc error is reported', function () { var r = p('calculate 5 divided by 0'); eq(r.id, 'math.calc'); ok(/zero/.test(r.args.error)); });
t('not math', function () { ok(p('open chrome').id !== 'math.calc'); ok(p('set a timer for 5 minutes').id !== 'math.calc'); ok(p('volume 50').id !== 'math.calc'); });
t('convert', function () { var r = p('convert 5 km to miles'); eq(r.id, 'math.convert'); eq(r.args, { value: 5, from: 'km', to: 'miles' }); eq(p('how many cm in three inches').args.value, 3); });
t('convert currency flagged', function () { var r = p('convert 100 usd to inr'); eq(r.id, 'math.convert'); ok(r.args.currency); });
t('frames', function () { var r = p('how many frames in 2.5 seconds at 30 fps'); eq(r.id, 'math.frames'); eq(r.args.frames.frames, 75); });

H.group('assistant');
t('confirm', function () { eq(p('yes').id, 'confirm.yes'); eq(p('yes please').id, 'confirm.yes'); eq(p('go ahead').id, 'confirm.yes'); eq(p('no').id, 'confirm.no'); eq(p('never mind').id, 'confirm.no'); });
t('stop only cancels when something is pending', function () { ok(p('stop', { pending: false }).id !== 'confirm.no'); eq(p('stop', { pending: true }).id, 'confirm.no'); });
t('exit', function () { eq(p('quit deskhand').id, 'app.exit'); eq(p('close deskhand').id, 'app.exit'); });
t('help', function () { eq(p('help').id, 'help'); eq(p('what can you do').id, 'help'); eq(p('help with timers').args.topic, 'timers'); });
t('repeat', function () { eq(p('again').id, 'repeat'); eq(p('do that again').id, 'repeat'); });
t('smalltalk', function () { eq(p('hello').id, 'talk.hello'); eq(p('thanks').id, 'talk.thanks'); eq(p('who are you').id, 'talk.who'); eq(p('are you jarvis').id, 'talk.jarvis'); eq(p('jarvis').id, 'talk.jarvis'); });

H.group('refusals');
[
  ['delete my downloads', 'delete'], ['delete report.pdf', 'delete'], ['empty the recycle bin', 'delete'], ['remove all files', 'delete'], ['delete all my files', 'delete'], ['delete all of my photos', 'delete'], ['erase everything', 'delete'], ['wipe all the documents', 'delete'], ['remove these files', 'delete'], ['send an email to riya', 'message'], ['call mom', 'message'],
  ['turn on wifi', 'settings'], ['set brightness to 50', 'settings'], ['install photoshop', 'install'], ['download chrome', 'install'], ['click the start button', 'input'], ['type hello world', 'input'],
  ['run the command ls -la', 'shell'], ['execute powershell', 'shell'], ['rm -rf /', 'shell'], ['sudo shutdown now', 'install']
].forEach(function (c) { t(c[0], function () { var r = p(c[0]); eq(r.id, 'unsupported', c[0] + ' -> ' + r.id); eq(r.args.why, c[1]); ok(r.args.say.length > 10); }); });
t('delete a timer or note is still allowed', function () { eq(p('delete timer 2').id, 'timer.cancel'); eq(p('delete all notes').id, 'note.clear'); eq(p('delete routine edit mode').id, 'routine.delete'); });
t('words that only start like a file word are not mistaken for one', function () { var r = p('delete all my items'); ok(!(r.id === 'unsupported' && r.args.why === 'delete'), r.id); eq(p('remove timer 1').id, 'timer.cancel'); });
t('y and n only answer a waiting question', function () { eq(p('y', { pending: true }).id, 'confirm.yes'); eq(p('n', { pending: true }).id, 'confirm.no'); ok(p('y', { pending: false }).id !== 'confirm.yes'); ok(p('n', { pending: false }).id !== 'confirm.no'); });
t('search for wifi router is a web search', function () { eq(p('search for wifi router reviews').id, 'web.search'); });

H.group('unknown, typos and suggestions');
t('empty', function () { eq(p('   ').reason, 'empty'); eq(p('hey deskhand').ok, false); });
t('very long', function () { eq(p(new Array(400).join('a ')).reason, 'long'); });
t('verb typo fixed', function () { var r = p('opn chrome'); ok(r.ok); eq(r.id, 'app.open'); eq(r.corrected, 'open chrome'); eq(p('serach for cats').id, 'web.search'); });
t('unknown gives suggestions', function () { var r = p('timer banana'); ok(!r.ok || r.id); var r2 = p('blorp the frobnicator'); eq(r2.ok, false); eq(r2.reason, 'unknown'); });
t('suggestions are relevant', function () { var s = P.suggest('timer five'); ok(s.length && /^timer|^focus/.test(s[0].id)); var s2 = P.suggest('screen capture please'); ok(s2.length && s2[0].id === 'screen.screenshot'); });
t('no suggestions for noise', function () { eq(P.suggest('zzzz qqqq'), []); });

H.group('more phrases');
t('weather', function () { var r = p('weather in rajkot'); eq(r.id, 'web.search'); eq(r.args.q, 'weather rajkot'); eq(p('what is the weather today').id, 'web.search'); });
t('translate', function () { eq(p('translate good morning to hindi').args.q, 'translate good morning to hindi'); });
t('volume words', function () { eq(p('set the volume to max').args.level, 100); eq(p('volume to zero').args.level, 0); eq(p('set volume to half').args.level, 50); });
t('play some music', function () { eq(p('play some music').args.key, 'playpause'); });
t('recurring reminders are flagged', function () { eq(p('remind me to drink water every hour').args.need, 'recurring'); });
t('log out is refused politely', function () { eq(p('log out').id, 'unsupported'); });
t('suggestions never include risky skills', function () { P.suggest('shut up please turn it off').forEach(function (s) { ok(!/^power\.|^app\.close|^note\.clear|^downloads\.organize/.test(s.id), s.id); }); });

H.group('chained commands');
function line(s, st) { return P.parseLine(s, Object.assign({}, STATE, st || {})); }
t('and', function () { var r = line('open chrome and set a timer for 10 minutes'); ok(r.chained); eq(r.steps.map(function (x) { return x.id; }), ['app.open', 'timer.set']); });
t('then', function () { var r = line('take a screenshot then open downloads'); eq(r.steps.map(function (x) { return x.id; }), ['screen.screenshot', 'folder.open']); });
t('open youtube and search lofi', function () { var r = line('open youtube and search lofi'); eq(r.steps.map(function (x) { return x.id; }), ['web.open', 'web.search']); });
t('free text is never split', function () { eq(line('note: salt and pepper').steps.length, 1); eq(line('search for salt and pepper').steps.length, 1); eq(line('remind me to call and email riya in 10 minutes').steps.length, 1); });
t('both parts must parse', function () { var r = line('open chrome and frobnicate'); eq(r.steps.length, 1); eq(r.steps[0].args.app, 'chrome and frobnicate'); });
t('three steps with commas and then', function () { var r = line('open premiere, open spotify then volume to 30'); eq(r.steps.length, 3); });
t('app names containing "and" are kept when a part does not parse', function () { eq(line('open Adobe Photoshop and Illustrator').steps.length, 1); });
t('routine and confirm words are not chained', function () { eq(line('yes and no').ok, false); eq(line('yes then undo').ok, false); });
t('too many parts', function () { var r = line('open a then open b then open c then open d then open e then open f then open g'); ok(!r.chained); });
t('single', function () { var r = line('open chrome'); eq(r.steps.length, 1); ok(!r.chained); });
t('unknown passes through', function () { var r = line('blorp the frobnicator'); eq(r.ok, false); });

H.group('catalogue');
t('catalogue lists groups with examples', function () { var c = P.catalogue(); ok(c.length >= 8); c.forEach(function (g) { g.skills.forEach(function (s) { ok(s.examples.length >= 1); }); }); });
t('every rule id unique', function () { var seen = {}; P.RULES.forEach(function (r) { ok(!seen[r.id], 'dup ' + r.id); seen[r.id] = 1; }); });
t('every confirm rule is one of the known risky skills', function () { var risky = P.RULES.filter(function (r) { return r.risk === 'confirm'; }).map(function (r) { return r.id; }).sort(); eq(risky, ['app.close', 'downloads.organize', 'note.clear', 'power.restart', 'power.shutdown', 'power.sleep']); });

H.done('parser');
