// Isolated synthetic AG-UI service. No database, upstream, API key or write tools.
// POST is accepted ONLY for the simulated assistant transport; all other writes fail.
import http from 'node:http';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let seq = 0;
http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/storage')) return res.end(JSON.stringify({ mode: 'harness', target: 'harness', storage: ':memory:', memory: true, persistent: false, database: ':memory:' }));
    return res.end('[]');
  }
  if (req.method !== 'POST' || req.url !== '/api/agent/run') { res.writeHead(405); return res.end('Fixture refuses writes'); }
  let body = ''; for await (const part of req) body += part;
  const input = JSON.parse(body).forwardedProps ?? {};
  const messages = input.messages ?? [];
  const prompt = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const id = 'fixture-' + ++seq;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const event = (type, data = {}) => res.write(`data: ${JSON.stringify({ type, ...(type === 'TOOL_CALL_RESULT' ? { messageId: id + '-result', role: 'tool' } : {}), ...data })}\n\n`);
  const custom = (name, value) => event('CUSTOM', { name, value });
  event('RUN_STARTED', { threadId: id, runId: id });
  if (input.approvals?.length) {
    for (const a of input.approvals) event('TOOL_CALL_RESULT', { toolCallId: a.toolUseId, content: JSON.stringify(a.approved ? { simulated: true } : { error: 'Rejected by operator; no synthetic operation performed.' }) });
    event('TEXT_MESSAGE_START', { messageId: id, role: 'assistant' });
    event('TEXT_MESSAGE_CONTENT', { messageId: id, delta: 'Synthetic decision received. No farm data was modified.' });
    event('TEXT_MESSAGE_END', { messageId: id });
  } else {
    event('TEXT_MESSAGE_START', { messageId: id, role: 'assistant' });
    const long = 'synthetic_reference_'.repeat(35);
    const text = prompt.includes('long') || prompt.includes('stream') ? `## Synthetic long response\n\n${long}\n\n| Animal | Notes | Value |\n|---|---|---|\n| SYN-001 | ${long} | 0 L |\n\n\`\`\`json\n{"reference":"${long}"}\n\`\`\`\n\n` + ('Earlier content for scroll testing.\n\n'.repeat(35)) : 'Synthetic assistant fixture. Try: long, streaming, error, tools, chart, no data, confirm.';
    const wideTable = '\n\n|' + Array.from({ length: 18 }, (_, i) => 'Field ' + (i + 1)).join('|') + '|\n|' + Array(18).fill('---').join('|') + '|\n|' + Array(18).fill('Synthetic').join('|') + '|\n\n';
    event('TEXT_MESSAGE_CONTENT', { messageId: id, delta: text + (prompt.includes('long') ? wideTable : '') });
    if (prompt.includes('stream')) for (let i = 0; i < 12; i++) { await pause(250); event('TEXT_MESSAGE_CONTENT', { messageId: id, delta: `Streaming segment ${i + 1}.\n\n` }); }
    event('TEXT_MESSAGE_END', { messageId: id });
    if (prompt.includes('tools')) {
      for (const [n, result] of [['read_animals', '{"count":0}'], ['read_feed', '{"error":"Synthetic service refused the read: fixture failure."}']]) {
        const tid = id + n; event('TOOL_CALL_START', { toolCallId: tid, toolCallName: n });
        event('TOOL_CALL_ARGS', { toolCallId: tid, delta: JSON.stringify({ reference: long }) }); event('TOOL_CALL_END', { toolCallId: tid });
        await pause(1500); event('TOOL_CALL_RESULT', { toolCallId: tid, content: result });
      }
    }
    if (prompt.includes('chart') || prompt.includes('no data')) custom('agent.dataset', { datasetId: id, kind: 'timeseries', scopeLabel: 'Synthetic herd', interval: 'day', points: prompt.includes('no data') ? [] : [{ periodStart: '2026-09-17', totalLitres: 0, avgPerAnimal: 0 }, { periodStart: '2026-09-18', totalLitres: 12, avgPerAnimal: 6 }] });
    if (prompt.includes('confirm')) {
      const tid = id + '-write'; event('TOOL_CALL_START', { toolCallId: tid, toolCallName: 'log_milking' }); event('TOOL_CALL_END', { toolCallId: tid });
      custom('agent.pending', [{ toolUseId: tid, toolName: 'log_milking', summary: 'Record 6 L for synthetic animal SYN-001', details: [{ label: 'Target', value: 'SYN-001 · Synthetic only' }, { label: 'Date', value: '2026-09-17' }, { label: 'Session', value: 'morning' }], rows: [{ tag: 'SYN-001', value: '6 L' }] }]);
    }
    if (prompt.includes('error')) { custom('agent.messages', messages); event('RUN_ERROR', { message: 'Synthetic connection failure. No automatic retry.' }); return res.end(); }
  }
  custom('agent.messages', messages);
  event('RUN_FINISHED', { threadId: id, runId: id }); res.end();
}).listen(6490, '127.0.0.1', () => console.log('Synthetic assistant only on 6490; no database or upstream.'));
