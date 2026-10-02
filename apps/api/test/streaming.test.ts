import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sse, partialSummary } from '../src/streaming.js';
import { HTTPModels, type ModelConfig } from '../src/models.js';
test('SSE decodes split Unicode frames and JSON string escapes without exposing tool payloads', async () => {
  const source = 'data: {"text":"été"}\r\n\r\ndata: [DONE]\r\n\r\n',
    bytes = new TextEncoder().encode(source);
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        c.close();
      },
    }),
  );
  const result = [];
  for await (const event of sse(response)) result.push(event);
  assert.deepEqual(result, [{ text: 'été' }]);
  assert.equal(partialSummary('{"summary":"Hello\\nwor'), 'Hello\nwor');
  assert.equal(partialSummary('{"summary":"a\\u00'), 'a');
  assert.equal(partialSummary('{"summary":"a\\u00e9\\"b"}'), 'aé"b');
  assert.equal(partialSummary('{"kind":"write","content":"secret"}'), '');
});
test('Anthropic vision and real tool stream expose only final answer fragments and account usage', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'fixture';
  const model: ModelConfig = {
    id: 'fixture',
    name: 'fixture',
    description: 'fixture',
    provider: 'anthropic',
    model: 'fixture',
    maxCostCents: 10,
    inputCentsPerMillion: 100,
    outputCentsPerMillion: 100,
  };
  let sent: any;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 123 } } },
      { type: 'content_block_start', content_block: { type: 'tool_use', name: 'pocket_finish' } },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"summary":"Bonjour' },
      },
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: ' le monde"}' },
      },
      { type: 'message_delta', usage: { output_tokens: 30 } },
    ];
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  try {
    const fragments: string[] = [];
    const result = await new HTTPModels().complete(
      model,
      'test',
      [{ role: 'user', content: 'Describe', images: [{ mimeType: 'image/png', data: 'fixture' }] }],
      256,
      new AbortController().signal,
      true,
      ['finish'],
      (text) => fragments.push(text),
    );
    assert.equal(sent.stream, true);
    assert.equal(sent.messages[0].content[0].type, 'image');
    assert.equal(sent.messages[0].content[0].source.data, 'fixture');
    assert.equal(
      sent.tools.find((t: any) => t.name === 'pocket_finish').eager_input_streaming,
      true,
    );
    assert.equal(fragments[0], 'Bonjour');
    assert.equal(fragments.at(-1), 'Bonjour le monde');
    assert.equal(result.inputTokens, 123);
    assert.equal(result.outputTokens, 30);
    assert.deepEqual(JSON.parse(result.text), { kind: 'finish', summary: 'Bonjour le monde' });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});
