const assert = require('assert');

let fetchCalls = [];
let fetchResponses = [];

global.fetch = async (url, opts) => {
  const r = fetchResponses.shift() || { status: 200, json: async () => ({}) };
  fetchCalls.push({ url, opts });
  return { status: r.status, ok: r.status < 400, json: async () => r.json() };
};
global.FormData = class { append() {} };
global.Blob = class { constructor(d, o) { this.data = d; this.type = o?.type; } };
global.Buffer = Buffer;

function resetFetch() { fetchCalls = []; fetchResponses = []; }

const EL_BASE = 'https://api.elevenlabs.io/v1';
const BILL_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function parseGdocId(url) {
  const m = url.match(/\/document\/d\/([-\w]+)/);
  return m ? m[1] : null;
}

async function handler(event) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid JSON' }) };
  }

  const elHeaders = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };
  const { type, url, text, name } = body;
  let createResp, docId, docName;

  if (type === 'url') {
    if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'url required' }) };
    const gdocId = parseGdocId(url);
    if (gdocId) {
      const exportUrl = `https://docs.google.com/document/d/${gdocId}/export?format=txt`;
      const gdocResp = await fetch(exportUrl);
      if (!gdocResp.ok) {
        return { statusCode: 422, headers: cors, body: JSON.stringify({ error: 'Google Doc not accessible. Make sure it is shared with "Anyone with the link".' }) };
      }
      const gdocText = await gdocResp.json();
      createResp = await fetch(`${EL_BASE}/convai/knowledge-base/text`, {
        method: 'POST', headers: elHeaders,
        body: JSON.stringify({ text: String(gdocText), name: name || 'Google Doc upload' }),
      });
      docName = name || 'Google Doc upload';
    } else {
      createResp = await fetch(`${EL_BASE}/convai/knowledge-base/url`, {
        method: 'POST', headers: elHeaders,
        body: JSON.stringify({ url, name: name || url }),
      });
      docName = name || url;
    }
  } else if (type === 'text') {
    if (!text) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'text required' }) };
    createResp = await fetch(`${EL_BASE}/convai/knowledge-base/text`, {
      method: 'POST', headers: elHeaders,
      body: JSON.stringify({ text, name: name || 'Pasted text' }),
    });
    docName = name || 'Pasted text';
  } else {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'type must be url or text' }) };
  }

  if (!createResp.ok) {
    const err = await createResp.json().catch(() => ({}));
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'ElevenLabs KB create failed', detail: err }) };
  }
  const created = await createResp.json();
  docId = created.id;

  const agentResp = await fetch(`${EL_BASE}/convai/agents/${BILL_AGENT_ID}`, { headers: elHeaders });
  const agentData = await agentResp.json();
  const existingKb = agentData?.conversation_config?.agent?.prompt?.knowledge_base || [];
  const newEntry = { type: 'file', id: docId, name: docName, usage_mode: 'auto' };
  const updatedKb = [...existingKb, newEntry];

  const patchResp = await fetch(`${EL_BASE}/convai/agents/${BILL_AGENT_ID}`, {
    method: 'PATCH', headers: elHeaders,
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: updatedKb } } } }),
  });

  if (!patchResp.ok) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'ElevenLabs agent patch failed' }) };
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, id: docId, name: docName }) };
}

(async () => {
  delete process.env.ELEVENLABS_API_KEY;
  let r = await handler({ httpMethod: 'POST', body: '{}' });
  assert.strictEqual(r.statusCode, 500);
  console.log('PASS: missing key -> 500');

  process.env.ELEVENLABS_API_KEY = 'test-key';

  r = await handler({ httpMethod: 'OPTIONS', body: '' });
  assert.strictEqual(r.statusCode, 204);
  console.log('PASS: OPTIONS -> 204');

  r = await handler({ httpMethod: 'GET', body: '' });
  assert.strictEqual(r.statusCode, 405);
  console.log('PASS: GET -> 405');

  r = await handler({ httpMethod: 'POST', body: 'notjson' });
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS: invalid JSON -> 400');

  r = await handler({ httpMethod: 'POST', body: JSON.stringify({ type: 'file' }) });
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS: unknown type -> 400');

  r = await handler({ httpMethod: 'POST', body: JSON.stringify({ type: 'url' }) });
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS: url without url -> 400');

  r = await handler({ httpMethod: 'POST', body: JSON.stringify({ type: 'text' }) });
  assert.strictEqual(r.statusCode, 400);
  console.log('PASS: text without text -> 400');

  resetFetch();
  fetchResponses = [
    { status: 200, json: () => ({ id: 'doc123' }) },
    { status: 200, json: () => ({ conversation_config: { agent: { prompt: { knowledge_base: [] } } } }) },
    { status: 200, json: () => ({}) },
  ];
  r = await handler({ httpMethod: 'POST', body: JSON.stringify({ type: 'text', text: 'hello', name: 'My Doc' }) });
  assert.strictEqual(r.statusCode, 200);
  assert.ok(JSON.parse(r.body).success);
  const kb = JSON.parse(fetchCalls[2].opts.body).conversation_config.agent.prompt.knowledge_base;
  assert.strictEqual(kb[0].id, 'doc123');
  console.log('PASS: text upload happy path');

  resetFetch();
  fetchResponses = [{ status: 422, json: () => ({ detail: 'bad' }) }];
  r = await handler({ httpMethod: 'POST', body: JSON.stringify({ type: 'text', text: 'x' }) });
  assert.strictEqual(r.statusCode, 502);
  console.log('PASS: KB create failure -> 502');

  console.log('\nAll kb-upload tests passed.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
