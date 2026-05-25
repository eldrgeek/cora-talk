const assert = require('assert');

// Inline the handler logic with mocked fetch for testing
let mockStatus = 200;
let mockData = {};
global.fetch = async (url, opts) => ({
  status: mockStatus,
  json: async () => mockData,
});

// Inline a testable version of the handler (copy logic from el-proxy.js)
const EL_BASE = 'https://api.elevenlabs.io/v1';
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function handler(event) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };
  const p = event.queryStringParameters || {};
  const elHeaders = { 'xi-api-key': apiKey };
  try {
    let url, resp;
    if (p.action === 'list') {
      if (!p.agent_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'agent_id required' }) };
      url = `${EL_BASE}/convai/conversations?agent_id=${encodeURIComponent(p.agent_id)}&page_size=50`;
      resp = await fetch(url, { headers: elHeaders });
    } else if (p.action === 'get') {
      if (!p.conversation_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'conversation_id required' }) };
      url = `${EL_BASE}/convai/conversations/${encodeURIComponent(p.conversation_id)}`;
      resp = await fetch(url, { headers: elHeaders });
    } else {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action must be list or get' }) };
    }
    const data = await resp.json();
    return { statusCode: resp.status, headers: cors, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
}

(async () => {
  // Test: missing API key
  delete process.env.ELEVENLABS_API_KEY;
  let r = await handler({ queryStringParameters: { action: 'list', agent_id: 'x' } });
  assert.strictEqual(r.statusCode, 500);
  assert.ok(JSON.parse(r.body).error.includes('not set'));
  console.log('PASS: missing API key returns 500');

  process.env.ELEVENLABS_API_KEY = 'test-key';

  // Test: missing agent_id for list
  r = await handler({ queryStringParameters: { action: 'list' } });
  assert.strictEqual(r.statusCode, 400);
  assert.ok(JSON.parse(r.body).error.includes('agent_id'));
  console.log('PASS: missing agent_id returns 400');

  // Test: missing conversation_id for get
  r = await handler({ queryStringParameters: { action: 'get' } });
  assert.strictEqual(r.statusCode, 400);
  assert.ok(JSON.parse(r.body).error.includes('conversation_id'));
  console.log('PASS: missing conversation_id returns 400');

  // Test: unknown action
  r = await handler({ queryStringParameters: { action: 'delete' } });
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS: unknown action returns 400');

  // Test: list with agent_id
  mockData = { conversations: [{ conversation_id: 'c1', start_time: 1700000000, transcript: [] }] };
  r = await handler({ queryStringParameters: { action: 'list', agent_id: 'agent_123' } });
  assert.strictEqual(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.ok(Array.isArray(body.conversations));
  console.log('PASS: list returns conversations array');

  // Test: get with conversation_id
  mockData = { conversation_id: 'c1', transcript: [{ role: 'agent', message: 'Hello' }] };
  r = await handler({ queryStringParameters: { action: 'get', conversation_id: 'c1' } });
  assert.strictEqual(r.statusCode, 200);
  const body2 = JSON.parse(r.body);
  assert.ok(Array.isArray(body2.transcript));
  console.log('PASS: get returns transcript');

  console.log('\nAll el-proxy tests passed.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
