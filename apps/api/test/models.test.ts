import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTTPModels, parseAction, type ModelConfig } from '../src/models.js';

test('action parser accepts JSON fences with leading whitespace but rejects malformed actions', () => {
  assert.deepEqual(parseAction('\n  ```json\n{"kind":"finish","summary":"Bonjour"}\n```\n'), {
    kind: 'finish',
    summary: 'Bonjour',
  });
  assert.throws(() => parseAction('{"kind":"write","path":"a.ts"}'));
});

test('Anthropic agent actions use explicit tools and return valid actions with native tool results', async () => {
  const previousFetch = globalThis.fetch,
    priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const model: ModelConfig = {
    id: 'test',
    name: 'Test',
    description: 'Test',
    provider: 'anthropic',
    model: 'test-model',
    maxCostCents: 100,
    inputCentsPerMillion: 100,
    outputCentsPerMillion: 500,
  };
  const bodies: any[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return Response.json({
      content: [
        { type: 'text', text: 'Explanatory prose' },
        {
          type: 'tool_use',
          id: 'tool-test',
          name: 'pocket_write',
          input: { path: 'hello.ts', content: 'export const hello = true;' },
        },
      ],
      usage: { input_tokens: 20, output_tokens: 30 },
    });
  };
  try {
    const llm = new HTTPModels();
    const result = await llm.complete(
      model,
      'Use tools.',
      [{ role: 'user', content: 'Write a file.' }],
      256,
      new AbortController().signal,
      true,
    );
    assert.deepEqual(parseAction(result.text), {
      kind: 'write',
      path: 'hello.ts',
      content: 'export const hello = true;',
    });
    assert.equal(result.outputTokens, 30);
    assert.equal(bodies[0].tools.length, 6);
    assert.deepEqual(bodies[0].tool_choice, { type: 'any', disable_parallel_tool_use: true });
    await llm.complete(
      model,
      'Use tools.',
      [
        { role: 'user', content: 'Write a file.' },
        { role: 'assistant', content: result.text },
        { role: 'user', content: 'File written' },
      ],
      256,
      new AbortController().signal,
      true,
    );
    const [_, call, response] = bodies[1].messages;
    assert.equal(call.content[0].type, 'tool_use');
    assert.equal(call.content[0].name, 'pocket_write');
    assert.equal(response.content[0].type, 'tool_result');
    assert.equal(response.content[0].tool_use_id, call.content[0].id);
    assert.equal(response.content[0].content, 'File written');
  } finally {
    globalThis.fetch = previousFetch;
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  }
});
