/* Deskhand command parser. Turns "hey deskhand, set a timer for ten minutes" into {id:'timer.set', args:{ms:600000}}.
   Plain rules, no AI, no network. Every rule carries example phrases and the test suite runs all of them, so a rule that stops matching its own examples fails the build.
   Pure: works in Node and in the browser (window.DeskhandLib.parser). */
(function (g, factory) {
  var dep = (typeof module === 'object' && module.exports) ? function (n) { return require('./' + n); } : function (n) { return g.DeskhandLib[n]; };
  var api = factory(dep('text'), dep('calc'), dep('clock'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { g.DeskhandLib = g.DeskhandLib || {}; g.DeskhandLib.parser = api; }
})(typeof self !== 'undefined' ? self : this, function (T, C, K) {
  'use strict';

  var FOLDERS = { downloads: 'downloads', download: 'downloads', documents: 'documents', docs: 'documents', desktop: 'desktop', pictures: 'pictures', photos: 'pictures', images: 'pictures',
    videos: 'videos', movies: 'videos', music: 'music', home: 'home', 'my files': 'home' };
  var FOLDER_RE = 'downloads|documents|desktop|pictures|videos|music|home';

  var SITES = {
    youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', google: 'https://www.google.com', 'google drive': 'https://drive.google.com', 
    'google docs': 'https://docs.google.com', 'google sheets': 'https://sheets.google.com', 'google calendar': 'https://calendar.google.com', calendar: 'https://calendar.google.com',
    'google maps': 'https://www.google.com/maps', github: 'https://github.com', linkedin: 'https://www.linkedin.com',
    instagram: 'https://www.instagram.com', facebook: 'https://www.facebook.com', twitter: 'https://x.com', reddit: 'https://www.reddit.com',
    wikipedia: 'https://www.wikipedia.org', canva: 'https://www.canva.com', figma: 'https://www.figma.com', chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai',
    'whatsapp web': 'https://web.whatsapp.com', netflix: 'https://www.netflix.com', amazon: 'https://www.amazon.com', flipkart: 'https://www.flipkart.com',
    'ads manager': 'https://adsmanager.facebook.com', 'meta ads manager': 'https://adsmanager.facebook.com', 'meta ads': 'https://adsmanager.facebook.com', 'google ads': 'https://ads.google.com',
    'google analytics': 'https://analytics.google.com', 'search console': 'https://search.google.com/search-console', 'google search console': 'https://search.google.com/search-console'
  };

  var ENGINES = {
    google: 'https://www.google.com/search?q=', youtube: 'https://www.youtube.com/results?search_query=', maps: 'https://www.google.com/maps/search/', 'google maps': 'https://www.google.com/maps/search/',
    amazon: 'https://www.amazon.com/s?k=', flipkart: 'https://www.flipkart.com/search?q=', wikipedia: 'https://en.wikipedia.org/w/index.php?search=', github: 'https://github.com/search?q=',
    bing: 'https://www.bing.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=', images: 'https://www.google.com/search?tbm=isch&q='
  };
  var ENGINE_RE = 'youtube|google maps|google|maps|amazon|flipkart|wikipedia|github|bing|duckduckgo';

  var KINDS = {
    pdf: ['pdf'], pdfs: ['pdf'], image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'tif', 'tiff', 'bmp'], images: null, picture: null, pictures: null, photo: null, photos: null,
    video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mxf'], videos: null, movie: null, movies: null, clip: null, clips: null, recording: ['mp4', 'mov', 'mkv', 'webm', 'wav', 'mp3', 'm4a'],
    audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'], song: null, songs: null,
    document: ['doc', 'docx', 'pdf', 'txt', 'rtf', 'odt', 'md', 'pages'], documents: null, doc: null, docs: null, word: ['doc', 'docx'],
    spreadsheet: ['xls', 'xlsx', 'csv', 'ods', 'numbers'], spreadsheets: null, excel: null, sheet: null, sheets: null, csv: ['csv'],
    presentation: ['ppt', 'pptx', 'key', 'odp'], presentations: null, slides: null, deck: null, powerpoint: null,
    zip: ['zip', 'rar', '7z', 'tar', 'gz'], zips: null, archive: null, archives: null,
    design: ['psd', 'ai', 'fig', 'sketch', 'xd', 'indd', 'aep', 'prproj', 'drp'], project: null
  };
  (function () { var map = { images: 'image', picture: 'image', pictures: 'image', photo: 'image', photos: 'image', videos: 'video', movie: 'video', movies: 'video', clip: 'video', clips: 'video',
    song: 'audio', songs: 'audio', documents: 'document', doc: 'document', docs: 'document', spreadsheets: 'spreadsheet', excel: 'spreadsheet', sheet: 'spreadsheet', sheets: 'spreadsheet',
    presentations: 'presentation', slides: 'presentation', deck: 'presentation', powerpoint: 'presentation', zips: 'zip', archive: 'zip', archives: 'zip', project: 'design', pdfs: 'pdf' };
    Object.keys(map).forEach(function (k) { KINDS[k] = KINDS[map[k]]; }); })();
  var KIND_RE = Object.keys(KINDS).sort(function (a, b) { return b.length - a.length; }).join('|');
  var FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|rtf|png|jpe?g|gif|webp|svg|heic|mp4|mov|mkv|avi|webm|mp3|wav|m4a|zip|rar|7z|psd|ai|fig|aep|prproj|drp|srt|json)$/i;
  var DOMAIN = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|in|dev|app|ai|me|edu|gov|info|xyz|tv|us|uk|ca|de|fr|au|biz|online|site|shop|store|tech|page|ly)(?:[:/?#][^\s]*)?$/i;
  var APP_OK = /^[\p{L}\p{N} ._+\-]{1,60}$/u;
  var ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };

  function stripArticles(s) { return s.replace(/^(?:the|my|a|an|up|app called|application called)\s+/i, '').replace(/^(?:the|my)\s+/i, ''); }
  function cleanApp(s) {
    s = stripArticles(String(s).trim());
    s = s.replace(/\s+(?:app|application|program|software|on my (?:laptop|computer|pc)|for me|again)$/i, '').trim();
    s = s.replace(/^(?:the )/i, '');
    return s;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- helpers for rules --------------------------------------------------------------------------------
  function rx(list, key) {
    var res = list.map(function (p) { return new RegExp(p, 'i'); });
    return function (c) { var s = c[key || 'clean']; for (var i = 0; i < res.length; i++) { var m = res[i].exec(s); if (m) return m; } return null; };
  }
  function timerCount(c) { return c.state && c.state.timers ? c.state.timers : 0; }

  var RULES = [];
  function rule(id, group, risk, examples, fn) { RULES.push({ id: id, group: group, risk: risk, examples: examples, fn: fn }); }

  // ================= assistant: confirmation, exit, help =================================================
  rule('confirm.yes', 'Assistant', 'safe', ['yes', 'yeah', 'do it', 'go ahead', 'confirm'], function (c) {
    return /^(?:yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|proceed|affirmative|absolutely|yes please|please do|do that|yes do it|sounds good)$/i.test(c.clean) || (c.state && c.state.pending && /^y$/i.test(c.clean)) ? {} : null;
  });
  rule('confirm.no', 'Assistant', 'safe', ['no', 'cancel', 'never mind', 'nope', 'no thanks'], function (c) {
    return /^(?:no|nope|nah|cancel|never ?mind|don'?t|do not|abort|negative|no thanks|stop that|leave it)$/i.test(c.clean) || (c.state && c.state.pending && /^(?:stop|n)$/i.test(c.clean)) ? {} : null;
  });
  rule('app.exit', 'Assistant', 'safe', ['exit deskhand', 'quit deskhand', 'close deskhand'], rx(['^(?:exit|quit|close|stop|shut ?down|turn off|end)(?: the)?(?: app)? desk ?hand$', '^desk ?hand (?:exit|quit|stop)$']));
  rule('help', 'Assistant', 'safe', ['help', 'what can you do', 'what can i say', 'show examples'], function (c) {
    var m = /^(?:help(?: me)?(?: with| on| about)?|what can (?:you|i) (?:do|say)(?: with)?|what do you do|commands|show commands|examples|show examples|what are your skills|how do i use you|how does this work)\s*(.*)$/i.exec(c.clean);
    return m ? { topic: m[1].trim().toLowerCase() } : null;
  });
  rule('history.show', 'Assistant', 'safe', ['show history', 'what did i do today', 'recent commands'], rx(['^(?:show |what(?:\'s| is| was)? )?(?:my |the )?(?:history|recent commands|recent activity|command history)$', '^what did i (?:do|ask|say)(?: today| earlier| recently| before)?$']));
  rule('repeat', 'Assistant', 'safe', ['again', 'do that again', 'repeat that'], rx(['^(?:again|do (?:that|it) again|repeat(?: that| it| the last (?:command|one))?|same again|one more time|once more)$']));
  rule('undo', 'Files', 'safe', ['undo', 'undo that', 'put them back', 'undo organize'], rx(['^(?:undo|undo that|undo the last (?:thing|action|one)|put (?:them|it|everything) back|revert(?: that)?|undo (?:the )?(?:organi[sz]e|organi[sz]ing|sort|sorting|tidy)(?: downloads)?)$']));

  // ================= power (always confirm) ================================================================
  rule('power.cancel', 'System', 'safe', ['cancel shutdown', 'abort restart'], rx(['^(?:cancel|abort|stop) (?:the |my )?(?:scheduled )?(?:shut ?down|restart|reboot)$']));
  rule('power.shutdown', 'System', 'confirm', ['shut down', 'shutdown', 'turn off the laptop', 'power off'], rx(['^(?:shut ?down|power off|power down)(?: the| my)?(?: laptop| computer| pc| machine| system)?$', '^(?:turn|switch) off (?:the |my )?(?:laptop|computer|pc|machine|system)$']));
  rule('power.restart', 'System', 'confirm', ['restart', 'reboot the computer', 'restart my laptop'], rx(['^(?:restart|reboot)(?: the| my)?(?: laptop| computer| pc| machine| system)?$']));
  rule('power.sleep', 'System', 'confirm', ['go to sleep', 'sleep', 'put the laptop to sleep'], rx(['^(?:go to sleep|sleep|suspend|hibernate)(?: the| my)?(?: laptop| computer| pc| machine)?$', '^put (?:the |my )?(?:laptop|computer|pc|machine) to sleep$']));
  rule('power.lock', 'System', 'safe', ['lock the screen', 'lock my laptop', 'lock'], rx(['^lock(?: the| my)?(?: screen| laptop| computer| pc| machine| it)?$']));

  // ================= timers and reminders ================================================================
  rule('timer.list', 'Time', 'safe', ['show my timers', 'what timers do i have', 'how long is left on my timer', 'list reminders'], function (c) {
    return /^(?:show|list|what|which|any|see|check)(?: me)?(?: are)?(?: my| the| all)?(?: active| running| current| set)? (?:timers?|reminders?|alarms?)(?: do i have| are running| are set| are active| left)?$/i.test(c.clean) ||
      /^how (?:long|much time) (?:is )?(?:left|remaining) (?:on|for) (?:my |the )?(?:timer|reminder)s?$/i.test(c.clean) || /^(?:my )?(?:timers|reminders)$/i.test(c.clean) ? {} : null;
  });
  rule('timer.cancel', 'Time', 'safe', ['cancel the timer', 'stop my timer', 'cancel all timers', 'delete timer 2'], function (c) {
    var m = /^(?:cancel|stop|delete|clear|remove|kill|end)(?: my| the| all)?(?: (?:of )?(?:my |the )?)?(timers?|reminders?|alarms?)(?: (all|everything|t?\d+))?$/i.exec(c.clean);
    if (!m) { m = /^(?:cancel|stop|delete|clear|remove|kill|end) (all|every) (timers?|reminders?|alarms?)$/i.exec(c.clean); if (m) return { which: 'all' }; return null; }
    var w = m[2] ? m[2].toLowerCase() : (/\ball\b/i.test(c.clean) || /s$/i.test(m[1]) ? 'all' : null);
    if (w === 'everything') w = 'all';
    if (w && /^\d+$/.test(w)) w = 't' + w;
    return { which: w || null };
  });
  rule('focus.start', 'Time', 'safe', ['start a focus session', 'focus for 25 minutes', 'pomodoro', 'focus mode for an hour'], function (c) {
    if (!/^(?:start |begin |set )?(?:a |an )?(?:focus|pomodoro|work)(?: session| mode| timer| time| block)?(?:\s+(?:for|of)\s+.+)?$/i.test(c.clean)) return null;
    var d = T.parseDuration(c.clean);
    return { ms: d ? d.ms : 25 * 60000, defaulted: !d };
  });
  rule('timer.set', 'Time', 'safe', ['set a timer for 10 minutes', 'timer 5 minutes', '25 minute timer', 'set a timer called pasta for 12 minutes', 'start a 30 second timer'], function (c) {
    if (!/\b(?:timer|countdown)\b/i.test(c.clean)) return null;
    if (/\b(?:cancel|stop|delete|clear|remove|list|show|what|which|how)\b/i.test(c.clean)) return null;
    var d = T.parseDuration(c.clean);
    if (!d) {
      if (/^(?:set|start|create|make|begin)(?: me)?(?: a| an| the)? (?:timer|countdown)$/i.test(c.clean) || /^timer$/i.test(c.clean)) return { ms: null, need: 'duration' };
      return null;
    }
    var rest = (c.clean.slice(0, d.start) + ' ' + c.clean.slice(d.end)).replace(/\s+/g, ' ');
    var label = null, m = /\b(?:called|named|for|labell?ed|to)\s+(.+?)\s*$/i.exec(rest.replace(/\b(?:timer|countdown)\b/i, ' '));
    if (m) label = m[1].replace(/^(?:the|a|an|my)\s+/i, '').replace(/\s+(?:timer|countdown)$/i, '').trim();
    if (label && (/^(?:me)?$/i.test(label) || !/[a-z]/i.test(label) || label.length > 60)) label = null;
    return { ms: d.ms, label: label };
  });
  rule('reminder.set', 'Time', 'safe', ['set an alarm for 6am', 'remind me to call mom in 20 minutes', 'remind me at 6pm to send the invoice', 'remind me in an hour to stretch', 'remind me tomorrow at 9am to post the reel'], function (c) {
    var m = /^(?:set )?(?:a |an )?(remind(?:er)?(?: me)?|alert me|ping me|notify me|alarm)\b[ ,:]*(.*)$/i.exec(c.clean);
    if (!m) return null;
    var isAlarm = /^alarm$/i.test(m[1]), body = m[2], w = T.parseWhen(body, c.now);
    if (/\bevery (?:day|hour|morning|evening|night|week|\d+|other|minute)/i.test(body)) return { text: body, at: null, need: 'recurring' };
    function trim(x) { return x.replace(/\s+/g, ' ').trim().replace(/^(?:to|about|that|of|for|at)(?:\s+|$)/i, '').replace(/\s+(?:to|about|that|for|at)$/i, '').replace(/[ ,]+$/, '').replace(/^(?:to|about|that)\s+/i, ''); }
    if (!w) return { text: trim(body) || (isAlarm ? 'Alarm' : ''), at: null, need: 'when' };
    var rest = trim(body.slice(0, w.start) + ' ' + body.slice(w.end));
    if (!rest && isAlarm) rest = 'Alarm';
    return { text: rest, at: w.at.getTime(), ms: w.at - c.now, kind: w.kind, exact: w.exact !== false };
  });
  rule('time.until', 'Time', 'safe', ['how long until 6pm', 'how long till tomorrow at 9'], function (c) {
    var m = /^how (?:long|much time) (?:is it )?(?:until|till|before|to) (.+)$/i.exec(c.clean);
    if (!m) return null;
    var w = T.parseClock(m[1], c.now);
    return w ? { at: w.at.getTime() } : null;
  });
  rule('time.in', 'Time', 'safe', ['what time is it in tokyo', 'time in new york', 'tell me the time in london'], function (c) {
    var m = /^(?:what(?: is|'s)? )?(?:the )?(?:current )?(?:local )?time(?: is it)? (?:in|at) (.+)$/i.exec(c.clean) || /^what time is it in (.+)$/i.exec(c.clean) || /^tell me the time in (.+)$/i.exec(c.clean);
    return m ? { city: m[1].trim() } : null;
  });
  rule('time.now', 'Time', 'safe', ['what time is it', 'tell me the time', 'what is the time'], rx(['^(?:what(?: is|\'s)? )?(?:the )?(?:current )?(?:local )?time(?: is it)?(?: now)?(?: right now)?$', '^tell me the time$', '^what time is it(?: now| right now)?$', '^time$', '^got the time$']));
  rule('date.today', 'Time', 'safe', ['what is the date', 'what day is it', "today's date"], rx(['^(?:what(?: is|\'s)? )?(?:the |today\'s |todays )?(?:date|day)(?: is it)?(?: today)?$', '^what day is it(?: today)?$', '^what(?: is|\'s)? today\'?s? date$', '^today\'?s date$', '^what is today$']));

  // ================= notes and clipboard ==================================================================
  rule('note.clear', 'Notes', 'confirm', ['clear my notes', 'delete all notes'], rx(['^(?:clear|delete|erase|wipe|remove)(?: all)?(?: of)?(?: my| the)? notes$']));
  rule('note.list', 'Notes', 'safe', ['show my notes', 'read my notes', 'list notes'], rx(['^(?:show|list|read|open|see|what(?: are|\'s)?)(?: me)?(?: all)?(?: my| the)? notes(?: do i have)?$', '^(?:my )?notes$']));
  rule('note.add', 'Notes', 'safe', ['note: buy HDMI cables', 'take a note that the client call moved to friday', 'remember that rent is due on the 5th', 'jot down call the printer'], function (c) {
    var m = /^(?:(?:add|take|make|write|save|create)(?: me)?(?: a| an)? )?note(?: that| to self| down)?\s*[:,\-]?\s+(.+)$/i.exec(c.clean) ||
      /^(?:remember|jot down|write down|note down|make a note of)(?: that| this)?\s*[:,\-]?\s+(.+)$/i.exec(c.clean) ||
      /^add (.+?) to (?:my )?notes?$/i.exec(c.clean);
    return m ? { text: m[1].trim() } : null;
  });
  rule('clipboard.copy', 'System', 'safe', ['copy hello world to clipboard', 'put my email on the clipboard'], function (c) {
    var m = /^copy (.+?) (?:to|into|onto) (?:my |the )?clipboard$/i.exec(c.clean) || /^(?:put|place|save) (.+?) (?:in|on|into) (?:my |the )?clipboard$/i.exec(c.clean) || /^copy (?:this|text)\s*[:,]\s*(.+)$/i.exec(c.clean);
    return m ? { text: m[1].trim().replace(/^["'](.*)["']$/, '$1') } : null;
  });

  // ================= routines =============================================================================
  function splitSteps(s) { return s.split(/\s*(?:;|\band then\b|\bthen\b|,\s*(?:and\s+)?|\band\s+(?=(?:open|close|set|start|play|pause|mute|volume|take|search|launch|quit|run)\b))\s*/i).map(function (x) { return x.trim(); }).filter(Boolean); }
  rule('routine.create', 'Routines', 'safe', ['create routine edit mode: open premiere, open spotify, volume to 30', 'make a routine called wrap up: take a screenshot, close chrome'], function (c) {
    var m = /^(?:create|make|add|save|define|set up|new|teach(?: me)?)(?: a| an| new)? (?:routine|macro|workflow)(?: called| named| for)? ["']?([^:=]+?)["']?\s*(?::|=|\bthat\b|\bto\b|\bwhich does\b)\s*(.+)$/i.exec(c.clean);
    if (!m) return null;
    return { name: m[1].trim().toLowerCase(), steps: splitSteps(m[2]) };
  });
  rule('routine.list', 'Routines', 'safe', ['list my routines', 'what routines do i have'], rx(['^(?:list|show|what)(?: me)?(?: are)?(?: my| the| all)? (?:routines|macros|workflows)(?: do i have)?$', '^(?:my )?routines$']));
  rule('routine.delete', 'Routines', 'safe', ['delete routine edit mode', 'forget the routine focus'], function (c) {
    var m = /^(?:delete|remove|forget)(?: my| the)? (?:routine|macro|workflow) (.+)$/i.exec(c.clean) || /^(?:delete|remove|forget)(?: my| the)? (.+?) (?:routine|macro|workflow)$/i.exec(c.clean);
    return m ? { name: m[1].trim().toLowerCase() } : null;
  });
  rule('routine.run', 'Routines', 'safe', ['run my edit mode routine'], function (c) {
    var names = (c.state && c.state.routines) || [], lc = c.clean.toLowerCase();
    var m = /^(?:run|start|do|launch|activate|trigger|begin)(?: my| the)? (.+?) (?:routine|macro|workflow)$/i.exec(c.clean);
    if (m) return { name: m[1].trim().toLowerCase() };
    m = /^(?:run|start|do|launch|activate|trigger|begin)(?: my| the)? (?:routine|macro|workflow) (.+)$/i.exec(c.clean);
    if (m) return { name: m[1].trim().toLowerCase() };
    if (names.indexOf(lc) >= 0) return { name: lc };
    m = /^(?:run|start|do|launch|activate|trigger|begin)(?: my| the)? (.+)$/i.exec(c.clean);
    if (m && names.indexOf(m[1].trim().toLowerCase()) >= 0) return { name: m[1].trim().toLowerCase() };
    return null;
  });

  // ================= files ==========================================================================
  rule('downloads.organize', 'Files', 'confirm', ['organize my downloads', 'clean up downloads', 'sort my downloads', 'tidy my downloads folder'], rx(['^(?:organi[sz]e|clean up|clean|sort|tidy(?: up)?|declutter|sort out)(?: out)?(?: my| the)? downloads(?: folder)?$']));
  rule('folder.create', 'Files', 'safe', ['create a folder called client work on the desktop', 'make a new folder invoices in documents'], function (c) {
    var m = new RegExp('^(?:create|make|add|new)(?: a| an)?(?: new)? folder(?: called| named)? (.+?)(?: (?:in|on|inside|under) (?:my |the )?(' + FOLDER_RE + ')(?: folder)?)?$', 'i').exec(c.clean);
    return m ? { name: m[1].trim().replace(/^["'](.*)["']$/, '$1'), in: m[2] ? FOLDERS[m[2].toLowerCase()] : 'documents' } : null;
  });
  rule('file.latest', 'Files', 'safe', ['open my latest download', 'open the newest file in downloads', 'show my latest screenshot', 'what is my most recent video'], function (c) {
    var m = new RegExp('^(open|show|what is|get|find|reveal)(?: me)?(?: my| the)? (?:latest|newest|most recent|last|recent)(?: (' + KIND_RE + '|downloads?|screenshots?|files?))?(?: (downloads?|screenshots?|files?))?(?: (?:in|from|on) (?:my |the )?(' + FOLDER_RE + ')(?: folder)?)?$', 'i').exec(c.clean);
    if (!m) return null;
    var kindWord = (m[2] || m[3] || '').toLowerCase().replace(/s$/, ''), folder = m[4] ? FOLDERS[m[4].toLowerCase()] : null;
    var shot = /^screenshot/.test(kindWord) || /^screenshot/.test((m[3] || '').toLowerCase());
    if (/^download/.test(kindWord)) { folder = folder || 'downloads'; kindWord = ''; }
    if (kindWord === 'file') kindWord = '';
    if (!kindWord && !shot && !folder && !m[2] && !m[3]) return null;
    return { open: /^open$/i.test(m[1]), kind: kindWord && !shot ? kindWord : null, folder: folder || null, screenshot: shot };
  });
  rule('file.openResult', 'Files', 'safe', ['open the first one', 'open the second', 'open number 3', 'open result 2'], function (c) {
    var m = /^(?:open|show|launch|reveal)(?: me)?(?: the| result| file| number| no\.?| #)* ?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|\d{1,2})(?: one| result| file)?$/i.exec(c.num);
    if (m) { var k = m[1].toLowerCase(); return { index: ORD[k] || parseInt(k, 10) }; }
    if (/^(?:open|show|launch)(?: it| that| this| that one| this one| the file)$/i.test(c.clean)) return { index: 1, implicit: true };
    return null;
  });
  rule('file.find', 'Files', 'safe', ['find my invoice pdf', 'find files named logo', 'where is my resume', 'find videos in downloads from this week', 'search my files for tax'], function (c) {
    var s = c.clean, m, openIt = false, folder = null, text = null;
    if ((m = /^(?:where(?:'s| is| are)|locate)(?: my| the| a| an)? (.+)$/i.exec(s))) text = m[1];
    else if ((m = /^(?:find|locate|look for|search(?: my (?:files|documents|computer|laptop|pc|downloads|folders))?(?: for)?|look(?: for)?)(?: me)?(?: my| the| a| an| any| all| some)? (.+)$/i.exec(s))) {
      if (/^search(?! my (?:files|documents|computer|laptop|pc|downloads|folders))/i.test(s)) return null;
      text = m[1];
    }
    if (text === null) {
      if (FILE_EXT.test(s) && /^open\s+(\S+)$/i.test(s)) { text = /^open\s+(\S+)$/i.exec(s)[1]; openIt = true; }
      else return null;
    }
    if (/^look up\b/i.test(s) || /\b(?:online|on the web|on the internet)\b/i.test(text) || new RegExp('\\b(?:on|in|at) (?:' + ENGINE_RE + ')$', 'i').test(text)) return null;
    var since = null;
    var sm = /\s+(?:from |modified |changed |made |created )?(today|yesterday|this week|last week|this month)$/i.exec(text);
    if (sm) { since = sm[1].toLowerCase(); text = text.slice(0, sm.index); }
    var fm = new RegExp('\\s+(?:in|on|inside|within|under|from)\\s+(?:my |the )?(' + FOLDER_RE + ')(?: folder)?$', 'i').exec(text);
    if (fm) { folder = FOLDERS[fm[1].toLowerCase()]; text = text.slice(0, fm.index); }
    var kind = null, words = text.split(/\s+/).filter(Boolean), out = [];
    var STOP = /^(?:file|files|named|called|name|with|about|containing|the|my|a|an|of|for|that|is|are|has|have|any|some)$/i;
    words.forEach(function (w) {
      var lw = w.toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (!kind && KINDS[lw]) { kind = lw; return; }
      if (STOP.test(w)) return;
      out.push(w);
    });
    var q = out.join(' ').trim();
    if (!q && !kind) return null;
    return { query: q, kind: kind, folder: folder, since: since, open: openIt };
  });

  // ================= system ==================================================================================
  rule('system.status', 'System', 'safe', ['how is my laptop doing', 'how much battery do i have', 'how much disk space is left', 'system status', 'how much memory is free', 'what is the uptime'], function (c) {
    var s = c.clean.toLowerCase();
    if (/^(?:battery|battery level|battery status|power level|charge)$/.test(s) || /\b(?:battery|charge level|charging)\b/.test(s) && /^(?:how|what|is|check|show|am|tell)/.test(s)) return { what: 'battery' };
    if (/\b(?:disk|storage|drive space|hard drive|free space|space left)\b/.test(s) && /^(?:how|what|check|show|tell|is)/.test(s)) return { what: 'disk' };
    if (/\b(?:memory|ram)\b/.test(s) && /^(?:how|what|check|show|tell|is)/.test(s)) return { what: 'memory' };
    if (/\b(?:uptime|how long (?:has|have) (?:my|the|this) (?:laptop|computer|pc)|been (?:on|running|up))\b/.test(s)) return { what: 'uptime' };
    if (/\bcpu\b/.test(s) && /^(?:how|what|check|show|tell|is)/.test(s)) return { what: 'cpu' };
    if (/^(?:system|laptop|computer|pc|machine) (?:status|info|health|stats)$/.test(s) || /^(?:how(?:'s| is| are)|check) (?:my |the )?(?:laptop|computer|pc|machine|system)(?: doing| running| holding up)?$/.test(s) || /^(?:status|system info|health check|diagnostics)$/.test(s)) return { what: 'all' };
    return null;
  });
  rule('volume.mute', 'System', 'safe', ['mute', 'unmute', 'mute the sound'], function (c) {
    var m = /^(un ?mute|mute|silence)(?: the| my)?(?: sound| volume| laptop| computer| audio| it| speakers)?$/i.exec(c.clean);
    return m ? { mute: !/^un/i.test(m[1]) } : null;
  });
  rule('volume.set', 'System', 'safe', ['set the volume to max', 'set the volume to 40', 'volume to fifty', 'volume at 30 percent', 'make the volume 75'], function (c) {
    var m = /^(?:set|change|turn|put|make|bring)?(?: the| my)?(?: system| master)? ?(?:volume|sound)(?: level)?(?: to| at| on)? (\d{1,3})\s*(?:%|percent)?$/i.exec(c.num) || /^(?:volume|sound) (\d{1,3})$/i.exec(c.num);
    if (!m) {
      var w = /^(?:set|turn|put|make|bring)?(?: the| my)?(?: system| master)? ?(?:volume|sound)(?: level)?(?: to| at| on)? (max|maximum|full|half|min|minimum|zero)$/i.exec(c.clean);
      if (w) return { level: { max: 100, maximum: 100, full: 100, half: 50, min: 0, minimum: 0, zero: 0 }[w[1].toLowerCase()] };
      return null;
    }
    return { level: parseInt(m[1], 10) };
  });
  rule('volume.change', 'System', 'safe', ['turn the volume up', 'louder', 'quieter', 'volume down', 'turn it down', 'increase the volume by 20'], function (c) {
    var s = c.num.toLowerCase(), m, dir = null, by = null;
    if (/^(?:louder|turn it up|volume up|sound up|raise (?:the )?volume|increase (?:the )?volume|turn (?:the )?(?:volume|sound) up|turn up (?:the )?(?:volume|sound)?)(?: a (?:bit|little|notch|lot))?$/.test(s)) dir = 'up';
    else if (/^(?:quieter|softer|lower|turn it down|volume down|sound down|lower (?:the )?volume|decrease (?:the )?volume|reduce (?:the )?volume|turn (?:the )?(?:volume|sound) down|turn down (?:the )?(?:volume|sound)?)(?: a (?:bit|little|notch|lot))?$/.test(s)) dir = 'down';
    else if ((m = /^(raise|increase|lower|decrease|reduce|turn (?:the )?volume (?:up|down)|volume (?:up|down)) (?:the )?(?:volume )?(?:by )?(\d{1,3})\s*(?:%|percent)?$/.exec(s))) { dir = /raise|increase|up/.test(m[1]) ? 'up' : 'down'; by = parseInt(m[2], 10); }
    if (!dir) return null;
    if (!by) { var a = /(?:by )?(\d{1,3})\s*(?:%|percent)/.exec(s); if (a) by = parseInt(a[1], 10); }
    return { dir: dir, by: by };
  });
  rule('media.key', 'System', 'safe', ['pause', 'play', 'next song', 'skip', 'previous track', 'pause the music', 'resume', 'stop the music'], function (c) {
    var s = c.clean.toLowerCase();
    if (/^(?:play|pause|resume|continue|toggle)(?: the| some)?(?: music| song| track| audio| video| media| playback| it| something)?$/.test(s) || /^(?:play\s?\/?\s?pause)$/.test(s) || /^(?:stop|pause) (?:the )?(?:music|song|track|audio|video|media|playback)$/.test(s)) return { key: 'playpause' };
    if (/^(?:next|skip)(?: the)?(?: song| track| one)?$/.test(s) || /^(?:play )?(?:the )?next (?:song|track)$/.test(s)) return { key: 'next' };
    if (/^(?:previous|prev|last|go back)(?: the)?(?: song| track)?$/.test(s) || /^(?:play )?(?:the )?(?:previous|last) (?:song|track)$/.test(s)) return /^last$/.test(s) ? null : { key: 'prev' };
    return null;
  });
  rule('screen.screenshot', 'System', 'safe', ['take a screenshot', 'screenshot', 'capture the screen', 'grab a screen capture'], rx(['^(?:take |grab |capture |make |get )?(?:a |the |my )?(?:screenshot|screen shot|screen capture|screengrab|screen grab)(?: of (?:my|the) screen)?$', '^(?:capture|grab|snap) (?:my |the )?screen$']));

  // ================= math ====================================================================================
  rule('math.frames', 'Math', 'safe', ['how many frames in 2.5 seconds at 30 fps', 'how many seconds is 120 frames at 24 fps', 'timecode for 1500 frames at 25 fps'], function (c) {
    var r = C.parseFrames(c.clean);
    return r ? { frames: r } : null;
  });
  rule('math.convert', 'Math', 'safe', ['convert 5 km to miles', '72 f in celsius', 'how many cm in 3 inches', 'what is 10 kg in pounds'], function (c) {
    var r = C.parseConvert(c.num);
    if (!r) return null;
    var CUR = /^(?:usd|inr|eur|gbp|aed|cad|aud|jpy|cny|sgd|rupees?|dollars?|euros?|pounds? sterling|dirhams?)$/i;
    if (CUR.test(r.from) || CUR.test(r.to)) return { value: r.value, from: r.from, to: r.to, currency: true };
    if (!C.unitOf(r.from) || !C.unitOf(r.to)) return /^convert\b/i.test(c.clean) ? { value: r.value, from: r.from, to: r.to } : null;
    return { value: r.value, from: r.from, to: r.to };
  });
  rule('math.calc', 'Math', 'safe', ['what is 15 percent of 2400', 'calculate 12 * (3 + 4)', 'add 18% to 1000', '20% off 500', 'what is 5 lakh plus 2 lakh', '2 plus 2'], function (c) {
    var m = /^(?:calculate|compute|work out|solve|what is|how much is|how much|tell me|math|calc|equals?)\s+(.+)$/i.exec(c.num), body = m ? m[1] : c.num, prefixed = !!m;
    try { var r = C.natural(body); return r ? { expr: r.expr, value: r.value, pct: !!r.pct } : null; }
    catch (e) { return e && e.calc && prefixed ? { expr: body, error: e.message } : null; }
  });

  // ================= web ===================================================================================
  rule('web.search', 'Web', 'safe', ['weather in rajkot', 'translate good morning to hindi', 'search for best monitors under 20000', 'google react hooks', 'search youtube for lofi beats', 'play lofi beats on youtube', 'look up the rule of 40', 'directions to rajkot airport'], function (c) {
    var s = c.clean, m, q, engine = 'google';
    if ((m = new RegExp('^(?:search|look up|lookup|google|find|play)(?: for| up)? (.+?) (?:on|in|at|using) (' + ENGINE_RE + ')$', 'i').exec(s))) { q = m[1]; engine = m[2]; }
    else if ((m = new RegExp('^(?:search|look)(?: up)? (' + ENGINE_RE + ') for (.+)$', 'i').exec(s))) { engine = m[1]; q = m[2]; }
    else if ((m = new RegExp('^(' + ENGINE_RE + ') (?:search )?(?:for )?(.+)$', 'i').exec(s)) && !SITES[s.toLowerCase()]) { engine = m[1]; q = m[2]; }
    else if ((m = /^(?:what is |what's |how is )?(?:the )?weather(?: today| now| right now| forecast| like)?(?: (?:in|for|at|of) (.+))?$/i.exec(s))) { q = m[1] ? 'weather ' + m[1] : 'weather'; }
    else if ((m = /^translate (.+)$/i.exec(s))) { q = 'translate ' + m[1]; }
    else if ((m = /^(?:directions|navigate|route|how do i get|how to get|take me) (?:to|from) (.+)$/i.exec(s))) { return { url: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(m[1].trim()), q: m[1].trim(), engine: 'maps', directions: true }; }
    else if ((m = /^play (.+)$/i.exec(s)) && !/^(?:the |some )?(?:music|song|track|audio|video|media|something|it|again)$/i.test(m[1])) { q = m[1].replace(/^some\s+/i, ''); engine = 'youtube'; }
    else if ((m = /^(?:search|google|look up|lookup|look)(?: the web| online| the internet)?(?: for| up| about)? (.+)$/i.exec(s)) && !/^(?:my |the )?(?:files|documents|computer|laptop|pc|downloads|folders)\b/i.test(m[1])) q = m[1];
    else if ((m = /^find (.+?) (?:online|on the web|on google|on the internet)$/i.exec(s))) q = m[1];
    else return null;
    q = q.trim().replace(/^["'](.*)["']$/, '$1').trim();
    var key = engine.toLowerCase();
    if (!q || !ENGINES[key]) return null;
    return { q: q, engine: key, url: ENGINES[key] + encodeURIComponent(q), play: /^play\b/i.test(s) };
  });
  rule('web.open', 'Web', 'safe', ['open youtube', 'go to github.com', 'open meta ads manager', 'visit vaghelabhavesh.com'], function (c) {
    var m = /^(?:open|go to|visit|launch|browse to|take me to|load|bring up|navigate to|show me)(?: the| my)? (.+?)(?: website| site| page| in (?:the |my )?browser| online)?$/i.exec(c.clean);
    if (!m) return null;
    var name = m[1].trim().replace(/[.,!?]+$/, ''), lc = name.toLowerCase();
    var userSites = (c.state && c.state.sites) || {};
    var said = c.clean.replace(/^(?:open|go to|visit|launch|browse to|take me to|load|bring up|navigate to|show me)\s+/i, '').replace(/[.,!?]+$/, '').toLowerCase();
    if (userSites[said]) return { url: userSites[said], name: said };
    if (userSites[lc]) return { url: userSites[lc], name: name };
    if (SITES[lc]) return { url: SITES[lc], name: name };
    if (DOMAIN.test(name) && !FILE_EXT.test(name.replace(/[/?#].*$/, ''))) return { url: /^https?:\/\//i.test(name) ? name : 'https://' + name, name: name };
    if (/^https?:\/\/\S+$/i.test(name)) return { url: name, name: name };
    return null;
  });

  // ================= refusals: things people will ask that Deskhand will not do ==============================
  var NO = [
    ['delete', /^(?:delete|remove|erase|trash|wipe|shred|destroy|empty)\b(?:\s+(?:my|the|all|this|that|these|those|of))*\s*(?:(?:file|files|folder|folders|trash|recycle bin|bin|downloads|documents|pictures|photos|videos|everything|it|them)\b|[\w .-]+\.\w{2,4})/i,
      'I never delete files. That is on purpose, so a misheard word can never wipe your work. Use your file manager for that.'],
    ['message', /^(?:send|email|mail|message|text|call|dial|whatsapp|dm|reply)\b/i, 'I do not send messages or make calls. I can open Gmail or WhatsApp Web so you can do it yourself.'],
    ['settings', /\b(?:wi-?fi|bluetooth|brightness|airplane mode|dark mode|night (?:light|shift)|do not disturb|resolution|display settings|hotspot)\b/i, 'I cannot change that setting yet. Volume, mute, lock, sleep and screenshots I can do.'],
    ['logout', /^(?:log ?out|sign ?out|log off|switch user)\b/i, 'I cannot sign you out yet. I can lock the screen if you say "lock the screen".'],
    ['install', /^(?:install|uninstall|update|upgrade|download|sudo|apt|brew|npm|pip)\b/i, 'I do not install, remove or download software. That is a deliberate limit.'],
    ['input', /^(?:type|click|double ?click|right ?click|press|scroll|drag|hit)\b/i, 'I do not control the keyboard or mouse. I only run a fixed set of safe skills.'],
    ['shell', /^(?:run|execute|exec)(?: the| a| this)? (?:command|script|shell|terminal command|powershell|cmd|bash|code)\b|^(?:cmd|powershell|bash|sh|rm|del|rmdir|format|chmod|kill -9)\b/i, 'I do not run arbitrary commands. Only a fixed list of skills, so nothing a mic picks up can run code.']
  ];
  rule('unsupported', 'Assistant', 'safe', ['log out', 'delete my downloads', 'send an email to riya', 'turn on wifi', 'install photoshop', 'type hello', 'run the command ls'], function (c) {
    for (var i = 0; i < NO.length; i++) if (NO[i][1].test(c.clean)) return { why: NO[i][0], say: NO[i][2] };
    return null;
  });

  // ================= folders and apps ====================================================================
  rule('folder.open', 'Files', 'safe', ['open downloads', 'open my documents folder', 'show the desktop folder', 'open pictures'], function (c) {
    var m = /^(?:open|show|go to|browse|take me to|launch|bring up)(?: me)?(?: the| my)? (.+?)(?: folder| directory)?$/i.exec(c.clean);
    if (!m) return null;
    var name = m[1].trim().toLowerCase(), uf = (c.state && c.state.folders) || {};
    var said = c.clean.replace(/^(?:open|show|go to|browse|take me to|launch|bring up)(?: me)?\s+/i, '').replace(/\s+(?:folder|directory)$/i, '').toLowerCase();
    if (uf[said]) return { folder: said, custom: true };
    if (uf[name]) return { folder: name, custom: true };
    if (FOLDERS[name]) return { folder: FOLDERS[name] };
    return null;
  });
  rule('app.close', 'Apps', 'confirm', ['close chrome', 'quit spotify', 'exit premiere pro'], function (c) {
    var m = /^(?:close|quit|exit|kill|terminate|shut ?down|end)(?: the| my)? (.+)$/i.exec(c.clean);
    if (!m) return null;
    var name = cleanApp(m[1]);
    if (/^(?:this|that|the|current|active)?\s*(?:window|tab|tabs|windows|program|app|everything|all|all apps|all windows|file|document)$/i.test(name)) return { app: null, vague: true };
    if (!name || !APP_OK.test(name)) return { app: null, bad: true };
    return { app: name };
  });
  rule('app.open', 'Apps', 'safe', ['open chrome', 'launch premiere pro', 'start spotify', 'open the calculator', 'run notepad'], function (c) {
    var m = /^(?:open|launch|start|run|fire up|bring up|load|switch to|go to|open up)(?: up)?(?: the| my)? (.+)$/i.exec(c.clean);
    if (!m) return null;
    var name = cleanApp(m[1]);
    if (!name) return null;
    if (!APP_OK.test(name)) return { app: null, bad: true };
    return { app: name };
  });

  // ================= small talk ==============================================================================
  rule('talk.jarvis', 'Assistant', 'safe', ['are you jarvis', 'hey jarvis'], rx(['^(?:are you|be|you are|you\'re) (?:jarvis|j\\.?a\\.?r\\.?v\\.?i\\.?s\\.?|friday|vision|iron man)\\??$', '^(?:hey |ok |okay )?jarvis\\b.*$']));
  rule('talk.hello', 'Assistant', 'safe', ['hello', 'good morning', 'namaste'], rx(['^(?:hello|hi|hey|yo|hiya|namaste|hey there|hi there|hello there|good (?:morning|afternoon|evening)|are you there|wake up)(?: there| deskhand)?$']));
  rule('talk.thanks', 'Assistant', 'safe', ['thanks', 'thank you', 'great'], rx(['^(?:thanks|thank you|thx|cheers|great|nice|awesome|perfect|cool|good job|well done|brilliant)(?: a lot| so much| deskhand)?$']));
  rule('talk.who', 'Assistant', 'safe', ['who are you', 'what is your name'], rx(['^(?:who|what) are you$', '^what is your name$', '^introduce yourself$', '^who is this$']));
  rule('talk.how', 'Assistant', 'safe', ['how are you'], rx(['^how are you(?: doing)?(?: today)?$', '^how is it going$']));
  rule('talk.bye', 'Assistant', 'safe', ['goodbye', 'good night'], rx(['^(?:bye|goodbye|good night|see you|see you later|that is all|that\'s all|cya)(?: deskhand)?$']));
  rule('talk.joke', 'Assistant', 'safe', ['tell me a joke'], rx(['^(?:tell me )?(?:a )?(?:joke|something funny)$']));

  // last resort: a question we cannot answer ourselves becomes a web search
  rule('web.ask', 'Web', 'safe', ['who is the prime minister of india', 'why is the sky blue', 'how do i export a gif from after effects'], function (c) {
    var m = /^(?:who|what|where|when|why|how|which)\b.{4,}$/i.exec(c.clean);
    if (!m || c.clean.split(/\s+/).length < 3) return null;
    return { q: c.clean, engine: 'google', url: ENGINES.google + encodeURIComponent(c.clean), fallback: true };
  });

  // ---- fuzzy help -----------------------------------------------------------------------------------
  var VERBS = ['open', 'close', 'launch', 'quit', 'search', 'find', 'set', 'show', 'take', 'mute', 'unmute', 'remind', 'start', 'play', 'pause', 'convert', 'calculate', 'organize', 'create', 'copy', 'shutdown', 'restart', 'lock', 'cancel', 'volume', 'timer', 'note', 'screenshot'];
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);   // swapped letters count as one slip
    }
    return d[m][n];
  }
  function fixVerb(text) {
    var m = /^(\S+)(\s.*)?$/.exec(text);
    if (!m) return null;
    var w = m[1].toLowerCase();
    if (w.length < 3 || VERBS.indexOf(w) >= 0) return null;
    var best = null, bd = 2;
    VERBS.forEach(function (v) { var d = lev(w, v); if (d < bd && Math.abs(v.length - w.length) <= 1 && (w.length > 3 || w[0] === v[0])) { bd = d; best = v; } });
    return best ? best + (m[2] || '') : null;
  }
  function tokens(s) { return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (w) { return w && !/^(?:the|a|an|my|to|for|of|me|please|on|in)$/.test(w); }).map(function (w) { return w.replace(/s$/, ''); }); }
  function suggest(text, max) {
    var tt = tokens(text), seen = {}, scored = [];
    if (!tt.length) return [];
    RULES.forEach(function (r) {
      if (r.id === 'unsupported' || r.id === 'web.ask' || r.risk === 'confirm' || /^(?:confirm|talk)\./.test(r.id)) return;
      r.examples.forEach(function (ex) {
        var et = tokens(ex), inter = 0;
        tt.forEach(function (w) { if (et.indexOf(w) >= 0) inter++; });
        var union = tt.length + et.length - inter, sc = union ? inter / union : 0;
        if (sc > 0 && (!seen[r.id] || sc > seen[r.id].score)) seen[r.id] = { id: r.id, example: ex, score: sc };
      });
    });
    Object.keys(seen).forEach(function (k) { scored.push(seen[k]); });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.filter(function (s) { return s.score >= 0.2; }).slice(0, max || 3);
  }

  // ---- main entry -------------------------------------------------------------------------------------
  function parse(raw, state) {
    state = state || {};
    var now = state.now instanceof Date ? state.now : new Date();
    var clean = T.clean(raw);
    if (!clean) return { ok: false, reason: 'empty', say: 'Say or type a command, for example "open Chrome" or "set a timer for 10 minutes".' };
    if (clean.length > 300) return { ok: false, reason: 'long', say: 'That is too long for me. Try a shorter command.' };
    function attempt(text) {
      var c = { raw: raw, clean: text, num: T.numberWords(text), now: now, state: state };
      for (var i = 0; i < RULES.length; i++) {
        var r = RULES[i], args = r.fn(c);
        if (args) {
          if (Array.isArray(args)) args = {};   // rx() helpers return match arrays; rules without arguments have none
          return { ok: true, id: r.id, group: r.group, risk: r.risk, args: args, heard: text };
        }
      }
      return null;
    }
    var res = attempt(clean);
    if (res) return res;
    var fixed = fixVerb(clean);
    if (fixed) { res = attempt(fixed); if (res) { res.corrected = fixed; return res; } }
    return { ok: false, reason: 'unknown', heard: clean, suggestions: suggest(clean, 3) };
  }

  // Several commands in one sentence: "open chrome and set a timer for 10 minutes", "take a screenshot then open downloads".
  // Only split when every part is understood by itself, and never inside free text such as notes or searches.
  var FREE = /^(?:note\.add|web\.search|web\.ask|reminder\.set|file\.find|clipboard\.copy|routine\.create|folder\.create)$/;
  var NOCHAIN = /^(?:routine\.|confirm\.|repeat|undo|app\.exit|help|unsupported)/;
  var SEPS = [
    /\s*(?:;|,\s*(?:and\s+)?|\band then\b|\bthen\b|\bafter that\b|\s+and\s+)\s*/i,   // everything
    /\s*(?:;|,\s*(?:and\s+)?|\band then\b|\bthen\b|\bafter that\b)\s*/i,                 // no plain "and"
    /\s*(?:;|\band then\b|\bthen\b|\bafter that\b)\s*/i                                    // only explicit sequencing
  ];
  function parseLine(raw, state) {
    var whole = parse(raw, state);
    var clean = T.clean(raw);
    if (whole.ok && FREE.test(whole.id)) return { ok: true, steps: [whole] };
    if (/\s(?:and|then)\s|[;,]|after that/i.test(clean)) {
      for (var k = 0; k < SEPS.length; k++) {
        var parts = clean.split(SEPS[k]).map(function (x) { return x.trim(); }).filter(Boolean);
        if (parts.length < 2 || parts.length > 6) continue;
        var steps = parts.map(function (x) { return parse(x, state); });
        if (steps.every(function (r) { return r.ok && !NOCHAIN.test(r.id) && !(r.args && (r.args.bad || r.args.vague)); })) return { ok: true, steps: steps, chained: true };
      }
    }
    return whole.ok ? { ok: true, steps: [whole] } : whole;
  }

  function catalogue() {
    var groups = {}, order = [];
    RULES.forEach(function (r) {
      if (/^(?:confirm|talk|unsupported|web\.ask)/.test(r.id)) return;
      if (!groups[r.group]) { groups[r.group] = []; order.push(r.group); }
      groups[r.group].push({ id: r.id, risk: r.risk, examples: r.examples.slice(0, 3) });
    });
    return order.map(function (g) { return { group: g, skills: groups[g] }; });
  }

  return { parse: parse, parseLine: parseLine, suggest: suggest, catalogue: catalogue, RULES: RULES, FOLDERS: FOLDERS, SITES: SITES, ENGINES: ENGINES, KINDS: KINDS, splitSteps: splitSteps, APP_OK: APP_OK, cleanApp: cleanApp, fixVerb: fixVerb, DOMAIN: DOMAIN };
});
