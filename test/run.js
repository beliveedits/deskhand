'use strict';
// npm test: runs every suite in its own process so one crash cannot hide another.
// Add --e2e to also run the real-browser check (needs Playwright with Chromium installed).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const suites = fs.readdirSync(dir).filter((f) => /\.test\.js$/.test(f)).sort();
const withE2e = process.argv.includes('--e2e');
if (withE2e) suites.push('ui.e2e.js');

let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(dir, s)], { encoding: 'utf8', timeout: 180000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  process.stdout.write(out ? out + '\n' : s + ': no output\n');
  if (r.status !== 0) failed++;
}
console.log('');
console.log(failed ? failed + ' of ' + suites.length + ' suites failed.' : 'All ' + suites.length + ' suites passed.' + (withE2e ? '' : ' (Add --e2e for the real-browser check.)'));
process.exit(failed ? 1 : 0);
