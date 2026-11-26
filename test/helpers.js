// Tiny test helper: no dependencies.
var assert = require('assert');
var results = { pass: 0, fail: 0, failures: [] };
var current = '';
function group(name) { current = name; }
function t(name, fn) {
  try { var r = fn(); if (r && typeof r.then === 'function') throw new Error('use tAsync for async tests'); results.pass++; }
  catch (e) { results.fail++; results.failures.push(current + ' > ' + name + ': ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
async function tAsync(name, fn) {
  try { await fn(); results.pass++; }
  catch (e) { results.fail++; results.failures.push(current + ' > ' + name + ': ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg || 'expected truthy'); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' expected ' + b + ' got ' + a); }
function done(label) {
  console.log((results.fail ? 'FAIL ' : 'ok   ') + label + ': ' + results.pass + ' passed, ' + results.fail + ' failed');
  results.failures.forEach(function (f) { console.log('  - ' + f); });
  if (results.fail) process.exitCode = 1;
  return results;
}
module.exports = { group: group, t: t, tAsync: tAsync, eq: eq, ok: ok, near: near, done: done, assert: assert, results: results };
