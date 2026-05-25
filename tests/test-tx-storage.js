const assert = require('assert');

// Mock localStorage
const store = {};
global.localStorage = {
  getItem: (k) => k in store ? store[k] : null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// Inline the storage functions
const STORE_PFX = 'el-tx-edit:';
const TX_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';

function ekey(id) { return STORE_PFX + TX_AGENT_ID + ':' + id; }
function loadEdit(id) { try { return localStorage.getItem(ekey(id)); } catch(e) { return null; } }
function saveEditLS(id, txt) { try { localStorage.setItem(ekey(id), txt); return true; } catch(e) { return false; } }
function clearEditLS(id) { try { localStorage.removeItem(ekey(id)); } catch(e) {} }
function hasEdit(id) { return loadEdit(id) !== null; }

// Tests
assert.strictEqual(hasEdit('conv1'), false, 'should not have edit initially');
console.log('PASS: no edit initially');

assert.strictEqual(saveEditLS('conv1', 'My edited text'), true, 'saveEditLS returns true');
console.log('PASS: saveEditLS returns true');

assert.strictEqual(hasEdit('conv1'), true, 'should have edit after save');
console.log('PASS: hasEdit true after save');

assert.strictEqual(loadEdit('conv1'), 'My edited text', 'loadEdit returns saved text');
console.log('PASS: loadEdit returns saved text');

clearEditLS('conv1');
assert.strictEqual(hasEdit('conv1'), false, 'no edit after clear');
console.log('PASS: no edit after clearEditLS');

// Different convId has separate key
saveEditLS('conv1', 'text1');
saveEditLS('conv2', 'text2');
assert.strictEqual(loadEdit('conv1'), 'text1');
assert.strictEqual(loadEdit('conv2'), 'text2');
console.log('PASS: different convIds have separate storage keys');

// Key format includes agent ID
const k = ekey('conv1');
assert.ok(k.includes(TX_AGENT_ID), 'key includes agent ID');
assert.ok(k.includes('conv1'), 'key includes conv ID');
assert.ok(k.startsWith(STORE_PFX), 'key starts with prefix');
console.log('PASS: key format is correct');

console.log('\nAll tx-storage tests passed.');
