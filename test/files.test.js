var H = require('./helpers'), fs = require('fs'), os = require('os'), path = require('path');
var F = require('../src/files');
var t = H.t, eq = H.eq, ok = H.ok;
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dhf-')); }
function put(dir, rel, age, body) { var p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body || 'x'); var tt = (Date.now() - (age == null ? 3600 * 1000 : age)) / 1000; fs.utimesSync(p, tt, tt); return p; }
var DAY = 86400000;
var NOW = Date.now();

(async function () {
  H.group('find');
  var root = tmp();
  put(root, 'Invoice_2026-11 Acme.pdf', DAY); put(root, 'invoice-old.pdf', 40 * DAY); put(root, 'sub/deeper/Invoice Draft.docx', 2 * DAY); put(root, 'logo_final.png', 3600 * 1000); put(root, 'Logo Final v2.png', 600 * 1000);
  put(root, 'clip.mp4', 5 * 3600 * 1000); put(root, '.hidden.pdf', 1000); put(root, 'node_modules/pkg/invoice.pdf', 1000); put(root, 'partial.crdownload', 1000); put(root, 'notes.txt', 1000);
  var far = path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'); put(far, 'invoice-too-deep.pdf', 1000);
  await H.tAsync('name match, ranked', async function () { var r = await F.find({ roots: [root], query: 'invoice' }); eq(r.items.map(function (x) { return x.name; }), ['Invoice_2026-11 Acme.pdf', 'Invoice Draft.docx', 'invoice-old.pdf']); });
  await H.tAsync('kind filter', async function () { var r = await F.find({ roots: [root], query: 'invoice', exts: ['pdf'] }); eq(r.items.length, 2); });
  await H.tAsync('kind only, newest first', async function () { var r = await F.find({ roots: [root], query: '', exts: ['png'] }); eq(r.items.map(function (x) { return x.name; }), ['Logo Final v2.png', 'logo_final.png']); });
  await H.tAsync('multi-word query matches across separators', async function () { var r = await F.find({ roots: [root], query: 'logo final' }); eq(r.items.length, 2); });
  await H.tAsync('extension in the query', async function () { var r = await F.find({ roots: [root], query: 'invoice-old.pdf' }); eq(r.items.length, 1); eq(r.items[0].name, 'invoice-old.pdf'); });
  await H.tAsync('hidden, partial, node_modules and too deep are skipped', async function () { var r = await F.find({ roots: [root], query: '', limit: 100 }); var names = r.items.map(function (x) { return x.name; }); ok(names.indexOf('.hidden.pdf') < 0); ok(names.indexOf('partial.crdownload') < 0); ok(r.items.every(function (x) { return x.path.indexOf('node_modules') < 0; })); ok(names.indexOf('invoice-too-deep.pdf') < 0); });
  await H.tAsync('since today', async function () { var r = await F.find({ roots: [root], query: '', since: 'today', now: NOW, limit: 50 }); ok(r.items.every(function (x) { return x.mtimeMs >= new Date(new Date(NOW).setHours(0, 0, 0, 0)).getTime(); })); });
  await H.tAsync('no results', async function () { var r = await F.find({ roots: [root], query: 'zzzz' }); eq(r.items, []); eq(r.total, 0); });
  await H.tAsync('missing root is fine', async function () { var r = await F.find({ roots: ['/definitely/not/here'], query: 'x' }); eq(r.items, []); });
  await H.tAsync('limit', async function () { eq((await F.find({ roots: [root], query: '', limit: 2 })).items.length, 2); });
  await H.tAsync('symlinks are not followed', async function () { var outside = tmp(); put(outside, 'secret-invoice.pdf'); var r2 = tmp(); try { fs.symlinkSync(outside, path.join(r2, 'link')); } catch (e) { return; } put(r2, 'ok.txt'); var r = await F.find({ roots: [r2], query: '' }); eq(r.items.map(function (x) { return x.name; }), ['ok.txt']); });
  await H.tAsync('scan limit reports truncation', async function () { var big = tmp(); for (var i = 0; i < 30; i++) put(big, 'f' + i + '.txt'); var r = await F.find({ roots: [big], query: '', maxEntries: 10 }); ok(r.truncated); });
  t('sinceRange', function () { var now = new Date(2026, 10, 26, 15, 0).getTime(); var d0 = new Date(2026, 10, 26).getTime(); eq(F.sinceRange('today', now), [d0, Infinity]); eq(F.sinceRange('yesterday', now), [d0 - DAY, d0]); eq(F.sinceRange('this week', now)[0], new Date(2026, 10, 23).getTime()); eq(F.sinceRange('last week', now), [new Date(2026, 10, 16).getTime(), new Date(2026, 10, 23).getTime()]); eq(F.sinceRange('this month', now)[0], new Date(2026, 10, 1).getTime()); eq(F.sinceRange(null, now), null); });

  H.group('latest');
  await H.tAsync('newest first, partial skipped', async function () { var d = tmp(); put(d, 'old.pdf', 5 * DAY); put(d, 'new.pdf', 1000); put(d, 'half.crdownload', 10); put(d, 'img.png', 3000); var r = await F.latest({ roots: [d] }); eq(r.items.map(function (x) { return x.name; }), ['new.pdf', 'img.png', 'old.pdf']); });
  await H.tAsync('kind and screenshot name filters', async function () { var d = tmp(); put(d, 'Screenshot 2026-11-26.png', 1000); put(d, 'photo.png', 500); var r = await F.latest({ roots: [d], nameRe: /screenshot|screen shot/i }); eq(r.items.length, 1); var r2 = await F.latest({ roots: [d], exts: ['pdf'] }); eq(r2.items, []); });
  await H.tAsync('does not go into subfolders by default', async function () { var d = tmp(); put(d, 'sub/inner.pdf', 100); var r = await F.latest({ roots: [d] }); eq(r.items, []); });

  H.group('organize');
  function dl() { var d = tmp(); put(d, 'photo.jpg', DAY); put(d, 'photo2.PNG', DAY); put(d, 'clip.mp4', DAY); put(d, 'report.pdf', DAY); put(d, 'data.csv', DAY); put(d, 'setup.exe', DAY); put(d, 'weird.xyz', DAY); put(d, 'fresh.pdf', 10 * 1000); put(d, 'dl.crdownload', DAY); put(d, '.hidden.jpg', DAY); put(d, 'noext', DAY); put(d, 'keep/inside.jpg', DAY); return d; }
  t('plan', function () { var d = dl(), p = F.planOrganize(d, Date.now()); eq(p.moves.length, 6); eq(p.counts, { Images: 2, Videos: 1, Documents: 1, Spreadsheets: 1, Installers: 1 }); eq(p.left, 2); eq(p.recent, 1); ok(p.moves.every(function (m) { return path.dirname(m.from) === d; })); });
  t('plan text', function () { var p = F.planOrganize(dl(), Date.now()), s = F.describePlan(p); ok(/Move 6 files/.test(s) && /Nothing is deleted/.test(s) && /undo/.test(s) && /2 files of other types/.test(s) && /1 very recent file is skipped/.test(s)); eq(F.describePlan({ moves: [] }), null); });
  t('execute moves, never deletes, and logs for undo', function () {
    var d = dl(), before = fs.readdirSync(d).length, p = F.planOrganize(d, Date.now()), r = F.executeOrganize(p);
    eq(r.moved.length, 6); eq(r.failed, 0); ok(fs.existsSync(path.join(d, 'Images', 'photo.jpg'))); ok(!fs.existsSync(path.join(d, 'photo.jpg'))); ok(fs.existsSync(path.join(d, 'weird.xyz'))); ok(fs.existsSync(path.join(d, 'fresh.pdf'))); ok(fs.existsSync(path.join(d, 'keep', 'inside.jpg')));
    eq(r.createdDirs.length, 5);
    var total = 0; (function count(x) { fs.readdirSync(x, { withFileTypes: true }).forEach(function (e) { if (e.isDirectory()) count(path.join(x, e.name)); else total++; }); })(d); eq(total, 12);
  });
  t('never overwrites: name clashes get a number', function () {
    var d = tmp(); put(d, 'a.jpg', DAY, 'NEW'); put(d, 'Images/a.jpg', DAY, 'OLD'); var p = F.planOrganize(d, Date.now()); eq(p.moves[0].toName, 'a (2).jpg'); F.executeOrganize(p);
    eq(fs.readFileSync(path.join(d, 'Images', 'a.jpg'), 'utf8'), 'OLD'); eq(fs.readFileSync(path.join(d, 'Images', 'a (2).jpg'), 'utf8'), 'NEW');
  });
  t('two files with one name in the same plan do not clash', function () { var d = tmp(); put(d, 'a.jpg', DAY); put(d, 'a.JPG', DAY); var p = F.planOrganize(d, Date.now()); if (p.moves.length === 2) ok(p.moves[0].toName !== p.moves[1].toName); });
  t('a file blocking a category name is left alone', function () { var d = tmp(); put(d, 'Images', DAY, 'iam a file'); put(d, 'a.jpg', DAY); var p = F.planOrganize(d, Date.now()); eq(p.moves.length, 0); eq(p.left, 2); });
  t('existing category folder is reused', function () { var d = tmp(); fs.mkdirSync(path.join(d, 'Images')); put(d, 'a.jpg', DAY); var p = F.planOrganize(d, Date.now()); var r = F.executeOrganize(p); eq(r.createdDirs, []); ok(fs.existsSync(path.join(d, 'Images', 'a.jpg'))); });
  t('undo restores everything and removes the empty folders it made', function () {
    var d = dl(), snap = fs.readdirSync(d).sort(), p = F.planOrganize(d, Date.now()), r = F.executeOrganize(p), u = F.undoBatch({ moves: r.moved, createdDirs: r.createdDirs });
    eq(u.restored, 6); eq(u.skipped, 0); eq(u.removedDirs, 5); eq(fs.readdirSync(d).sort(), snap);
  });
  t('undo does not clobber a file that was recreated', function () { var d = tmp(); put(d, 'a.jpg', DAY, 'ORIG'); var r = F.executeOrganize(F.planOrganize(d, Date.now())); fs.writeFileSync(path.join(d, 'a.jpg'), 'NEWER'); var u = F.undoBatch({ moves: r.moved, createdDirs: r.createdDirs }); eq(u.restored, 0); eq(u.skipped, 1); eq(fs.readFileSync(path.join(d, 'a.jpg'), 'utf8'), 'NEWER'); eq(fs.readFileSync(path.join(d, 'Images', 'a.jpg'), 'utf8'), 'ORIG'); });
  t('undo keeps a folder that now has other files', function () { var d = tmp(); put(d, 'a.jpg', DAY); var r = F.executeOrganize(F.planOrganize(d, Date.now())); put(d, 'Images/other.jpg', DAY); var u = F.undoBatch({ moves: r.moved, createdDirs: r.createdDirs }); eq(u.removedDirs, 0); ok(fs.existsSync(path.join(d, 'Images', 'other.jpg'))); });
  t('dry run changes nothing', function () { var d = dl(), snap = fs.readdirSync(d).sort(); var r = F.executeOrganize(F.planOrganize(d, Date.now()), { dry: true }); eq(r.moved.length, 6); eq(fs.readdirSync(d).sort(), snap); });
  t('a plan that was tampered with cannot leave the folder', function () { var d = tmp(), other = tmp(); put(other, 'victim.jpg', DAY); var p = { dir: d, moves: [{ from: path.join(other, 'victim.jpg'), toDir: path.join(d, 'Images'), toName: 'victim.jpg' }, { from: path.join(d, 'x.jpg'), toDir: path.join(other, 'Images'), toName: 'x.jpg' }] }; put(d, 'x.jpg', DAY); var r = F.executeOrganize(p); eq(r.moved.length, 0); eq(r.failed, 2); ok(fs.existsSync(path.join(other, 'victim.jpg'))); ok(fs.existsSync(path.join(d, 'x.jpg'))); });
  t('a file that vanished after the preview is skipped', function () { var d = tmp(); var f = put(d, 'a.jpg', DAY); var p = F.planOrganize(d, Date.now()); fs.unlinkSync(f); var r = F.executeOrganize(p); eq(r.moved.length, 0); eq(r.failed, 1); });
  t('capped at 500', function () { var d = tmp(); for (var i = 0; i < 520; i++) fs.writeFileSync(path.join(d, 'f' + i + '.jpg'), 'x'); var old = (Date.now() - DAY) / 1000; fs.readdirSync(d).forEach(function (n) { fs.utimesSync(path.join(d, n), old, old); }); var p = F.planOrganize(d, Date.now()); eq(p.moves.length, 500); ok(p.capped); eq(p.left, 20); });
  t('empty folder', function () { eq(F.planOrganize(tmp(), Date.now()).moves.length, 0); });

  H.group('folder names');
  t('good', function () { eq(F.cleanFolderName('  Client   Work '), { name: 'Client Work' }); eq(F.cleanFolderName('2026 Invoices').name, '2026 Invoices'); });
  ['', '   ', '../etc', 'a/b', 'a\\b', 'x:y', 'a*', '.hidden', 'trail.', 'CON', 'nul.txt', 'com1', 'a|b', 'q?', new Array(90).join('x')].forEach(function (b) { t('refuses ' + JSON.stringify(b.slice(0, 20)), function () { ok(F.cleanFolderName(b).error); }); });

  H.group('misc');
  t('linux user dirs', function () { var r = F.linuxUserDirs('# comment\nXDG_DESKTOP_DIR="$HOME/Escritorio"\nXDG_DOWNLOAD_DIR="$HOME/Descargas"\nXDG_VIDEOS_DIR="/mnt/media/vids"\nXDG_MUSIC_DIR="$HOME"\nXDG_PICTURES_DIR="relative"\n', '/home/b'); eq(r, { desktop: '/home/b/Escritorio', downloads: '/home/b/Descargas', videos: '/mnt/media/vids' }); });
  t('ago and size', function () { var n = 1e12; eq(F.ago(n - 5000, n), 'just now'); eq(F.ago(n - 120000, n), '2 minutes ago'); eq(F.ago(n - 3600 * 1000, n), '60 minutes ago'.replace('60 minutes', '1 hour')); eq(F.ago(n - 5 * 86400000, n), '5 days ago'); eq(F.sizeText(500), '500 B'); eq(F.sizeText(2048), '2 KB'); eq(F.sizeText(5 * 1048576), '5.0 MB'); });
  H.done('files');
})();
