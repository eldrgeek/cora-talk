const assert = require('assert');

let fetchCalls = [];
let fetchResponses = [];

global.fetch = async (url, opts) => {
  const r = fetchResponses.shift() || { status: 200, json: async () => ({}) };
  fetchCalls.push({ url, opts });
  return { status: r.status, ok: r.status < 400, json: async () => r.json() };
};

function resetFetch() { fetchCalls = []; fetchResponses = []; }

const EL_BASE = 'https://api.elevenlabs.io/v1';
const BILL_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

async function handler(event) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'GET only' }) };

  const agentResp = await fetch(`${EL_BASE}/convai/agents/${BILL_AGENT_ID}`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!agentResp.ok) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Failed to fetch agent config' }) };
  }

  const agentData = await agentResp.json();
  const kb = agentData?.conversation_config?.agent?.prompt?.knowledge_base || [];

  const documents = kb.map(entry => ({
    id: entry.id,
    name: entry.name,
    usage_mode: entry.usage_mode,
    type: entry.type,
  }));

  return { statusCode: 200, headers: cors, body: JSON.stringify({ documents }) };
}

(async () => {
  delete process.env.ELEVENLABS_API_KEY;
  let r = await handler({ httpMethod: 'GET' });
  assert.strictEqual(r.statusCode, 500);
  console.log('PASS: missing API key -> 500');

  process.env.ELEVENLABS_API_KEY = 'test-key';

  r = await handler({ httpMethod: 'OPTIONS' });
  assert.strictEqual(r.statusCode, 204);
  console.log('PASS: OPTIONS -> 204');

  r = await handler({ httpMethod: 'POST' });
  assert.strictEqual(r.statusCode, 405);
  console.log('PASS: POST -> 405');

  resetFetch();
  fetchResponses = [{ status: 503, json: () => ({ error: 'unavailable' }) }];
  r = await handler({ httpMethod: 'GET' });
  assert.strictEqual(r.statusCode, 502);
  console.log('PASS: agent fetch failure -> 502');

  resetFetch();
  fetchResponses = [{ status: 200, json: () => ({ conversation_config: { agent: { prompt: { knowledge_base: [] } } } }) }];
  r = await handler({ httpMethod: 'GET' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).documents.length, 0);
  console.log('PASS: empty KB -> empty documents');

  resetFetch();
  fetchResponses = [{ status: 200, json: () => ({ conversation_config: { agent: { prompt: { knowledge_base: [
    { id: 'abc', name: 'Bill Notes', type: 'file', usage_mode: 'auto' },
  ] } } } }) }];
  r = await handler({ httpMethod: 'GET' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).documents[0].id, 'abc');
  console.log('PASS: KB with docs -> returns documents');

  console.log('\nAll kb-list tests passed.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
