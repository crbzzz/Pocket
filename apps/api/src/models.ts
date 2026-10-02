import { sse, partialSummary } from './streaming.js';
import { z } from 'zod';
import { DomainError, type Model } from './domain.js';
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search'), query: z.string().max(200) }),
  z.object({ kind: z.literal('read'), path: z.string().max(1000) }),
  z.object({ kind: z.literal('list'), path: z.string().max(1000) }),
  z.object({
    kind: z.literal('write'),
    path: z.string().max(1000),
    content: z.string().max(100000),
  }),
  z.object({ kind: z.literal('run'), command: z.string().max(4000) }),
  z.object({ kind: z.literal('check'), name: z.string().max(80), command: z.string().max(4000) }),
  z.object({ kind: z.literal('finish'), summary: z.string().max(8000) }),
]);
const toolPrefix = 'pocket_';
const actionTools = actionSchema.options.map((schema) => {
  const json = z.toJSONSchema(schema) as {
    properties: Record<string, unknown>;
    required?: string[];
  };
  const kind = schema.shape.kind.value;
  const { kind: _kind, ...properties } = json.properties;
  return {
    name: toolPrefix + kind,
    ...(kind === 'finish' ? { eager_input_streaming: true } : {}),
    description:
      kind === 'finish'
        ? 'Respond to the user with a useful summary in their language. Do not modify files for questions or summaries.'
        : `Execute the ${kind} operation in the repository.`,
    input_schema: {
      type: 'object',
      properties,
      required: (json.required ?? []).filter((k) => k !== 'kind'),
      additionalProperties: false,
    },
  };
});
function anthropicMessages(messages: Message[]) {
  let pending: string | undefined;
  return messages.map((message, index) => {
    if (message.role === 'assistant') {
      try {
        const action = parseAction(message.content);
        const { kind, ...input } = action;
        pending = `pocket_action_${index}`;
        return {
          role: 'assistant',
          content: [{ type: 'tool_use', id: pending, name: toolPrefix + kind, input }],
        };
      } catch {
        pending = undefined;
      }
    } else if (pending) {
      const id = pending;
      pending = undefined;
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: message.content }],
      };
    }
    return message.images?.length
      ? {
          role: message.role,
          content: [
            ...message.images.map((image) => ({
              type: 'image',
              source: { type: 'base64', media_type: image.mimeType, data: image.data },
            })),
            { type: 'text', text: message.content },
          ],
        }
      : { role: message.role, content: message.content };
  });
}
export type AgentAction = z.infer<typeof actionSchema>;
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: { mimeType: string; data: string }[];
}
export interface ModelConfig extends Model {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}
export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface LLMProvider {
  complete(
    model: ModelConfig,
    system: string,
    messages: Message[],
    maxTokens: number,
    signal: AbortSignal,
    actionMode?: boolean,
    allowedKinds?: string[],
    onReply?: (text: string) => void,
  ): Promise<Completion>;
}
const configs = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    provider: z.enum(['openai', 'anthropic', 'google']),
    model: z.string(),
    maxCostCents: z.number().int().positive(),
    inputCentsPerMillion: z.number().nonnegative(),
    outputCentsPerMillion: z.number().nonnegative(),
  }),
);
const envKeys = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
};
export class ModelRouter {
  readonly catalog: ModelConfig[];
  constructor(raw = process.env.MODEL_CATALOG) {
    this.catalog = raw
      ? configs.parse(JSON.parse(raw)).filter((c) => !!process.env[envKeys[c.provider]])
      : [];
  }
  resolve(id: string): ModelConfig {
    const models = this.catalog;
    const model =
      models.find((m) => m.id === id) ??
      (id === 'auto'
        ? models[0]
        : id === 'fast'
          ? [...models].sort((a, b) => a.inputCentsPerMillion - b.inputCentsPerMillion)[0]
          : id === 'powerful'
            ? models.at(-1)
            : undefined);
    if (!model) throw new DomainError(503, 'No configured model is available');
    return model;
  }
  publicCatalog(): Model[] {
    if (!this.catalog.length) return [];
    return [
      {
        id: 'auto',
        name: 'Auto',
        description: 'Balanced for your task',
        provider: 'router',
        maxCostCents: 300,
      },
      {
        id: 'fast',
        name: 'Fast',
        description: 'Lowest configured input cost',
        provider: 'router',
        maxCostCents: 100,
      },
      {
        id: 'powerful',
        name: 'Powerful',
        description: 'Your configured reasoning model',
        provider: 'router',
        maxCostCents: 800,
      },
      ...this.catalog.map(
        ({ model, inputCentsPerMillion, outputCentsPerMillion, ...rest }) => rest,
      ),
    ];
  }
}
export class HTTPModels implements LLMProvider {
  async complete(
    model: ModelConfig,
    system: string,
    messages: Message[],
    maxTokens: number,
    signal: AbortSignal,
    actionMode = false,
    allowedKinds?: string[],
    onReply?: (text: string) => void,
  ): Promise<Completion> {
    const key = process.env[envKeys[model.provider]];
    if (!key) throw new Error('Model credentials are not configured');
    let url: string;
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: unknown;
    if (model.provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers.Authorization = `Bearer ${key}`;
      body = {
        model: model.model,
        messages: [
          { role: 'system', content: system },
          ...messages.map((m) => ({
            role: m.role,
            content: m.images?.length
              ? [
                  { type: 'text', text: m.content },
                  ...m.images.map((image) => ({
                    type: 'image_url',
                    image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                  })),
                ]
              : m.content,
          })),
        ],
        max_completion_tokens: maxTokens,
      };
    } else if (model.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: model.model,
        system,
        messages: anthropicMessages(messages),
        max_tokens: maxTokens,
        ...(actionMode
          ? {
              tools: actionTools.filter(
                (t) =>
                  !allowedKinds ||
                  (allowedKinds.length === 1 && allowedKinds[0] === 'finish') ||
                  allowedKinds.includes(t.name.slice(toolPrefix.length)),
              ),
              tool_choice:
                allowedKinds?.length === 1 && allowedKinds[0] === 'finish'
                  ? { type: 'tool', name: 'pocket_finish', disable_parallel_tool_use: true }
                  : { type: 'any', disable_parallel_tool_use: true },
            }
          : {}),
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`;
      headers['x-goog-api-key'] = key;
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [
            { text: m.content },
            ...(m.images ?? []).map((image) => ({
              inline_data: { mime_type: image.mimeType, data: image.data },
            })),
          ],
        })),
        generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      };
    }
    if (onReply) {
      if (model.provider === 'google')
        url = url.replace(':generateContent', ':streamGenerateContent?alt=sse');
      else
        body = {
          ...(body as object),
          stream: true,
          ...(model.provider === 'openai' ? { stream_options: { include_usage: true } } : {}),
        };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    });
    if (!response.ok) throw new Error(`Model service returned ${response.status}`);
    let d: any;
    if (onReply && response.headers.get('content-type')?.includes('text/event-stream')) {
      let text = '',
        input = 0,
        output = 0,
        toolName = '',
        argumentsText = '',
        lastEmit = 0;
      const emit = () => {
        const answer = partialSummary(toolName ? argumentsText : text);
        if (answer && Date.now() - lastEmit > 80) {
          onReply(answer);
          lastEmit = Date.now();
        }
      };
      for await (const event of sse(response)) {
        if (event.type === 'error' || event.error) throw new Error('Model stream interrupted');
        if (model.provider === 'anthropic') {
          if (event.type === 'message_start') input = event.message?.usage?.input_tokens ?? input;
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
            toolName = event.content_block.name;
          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'input_json_delta')
              argumentsText += event.delta.partial_json ?? '';
            else if (event.delta?.type === 'text_delta') text += event.delta.text ?? '';
          }
          if (event.type === 'message_delta') output = event.usage?.output_tokens ?? output;
          if (toolName === 'pocket_finish') emit();
        } else if (model.provider === 'openai') {
          text += event.choices?.[0]?.delta?.content ?? '';
          input = event.usage?.prompt_tokens ?? input;
          output = event.usage?.completion_tokens ?? output;
          emit();
        } else {
          text +=
            event.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
          input = event.usageMetadata?.promptTokenCount ?? input;
          output = event.usageMetadata?.candidatesTokenCount ?? output;
          emit();
        }
        if (text.length + argumentsText.length > 200000)
          throw new Error('Model output exceeds limit');
      }
      if (toolName) {
        try {
          text = JSON.stringify({
            ...JSON.parse(argumentsText),
            kind: toolName.slice(toolPrefix.length),
          });
        } catch {
          text = argumentsText;
        }
      }
      const answer = partialSummary(text);
      if (answer) onReply(answer);
      return {
        text,
        inputTokens:
          input || Buffer.byteLength(system + messages.map((m) => m.content).join('')) + 512,
        outputTokens: output || maxTokens,
      };
    }
    d = await response.json();
    const inputFallback = Buffer.byteLength(system + messages.map((m) => m.content).join('')) + 512;
    const normalize = (value: Completion) =>
      z
        .object({
          text: z.string().max(200000),
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
        })
        .parse(value);
    if (model.provider === 'openai')
      return normalize({
        text: d.choices?.[0]?.message?.content ?? '',
        inputTokens: d.usage?.prompt_tokens ?? inputFallback,
        outputTokens: d.usage?.completion_tokens ?? maxTokens,
      });
    if (model.provider === 'anthropic') {
      const action = actionMode
        ? d.content?.find(
            (p: any) => p.type === 'tool_use' && actionTools.some((t) => t.name === p.name),
          )
        : undefined;
      return normalize({
        text: action
          ? JSON.stringify({ ...action.input, kind: action.name.slice(toolPrefix.length) })
          : (d.content
              ?.filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('') ?? ''),
        inputTokens: d.usage?.input_tokens ?? inputFallback,
        outputTokens: d.usage?.output_tokens ?? maxTokens,
      });
    }
    return normalize({
      text: d.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '',
      inputTokens: d.usageMetadata?.promptTokenCount ?? inputFallback,
      outputTokens: d.usageMetadata?.totalTokenCount
        ? Math.max(0, d.usageMetadata.totalTokenCount - (d.usageMetadata.promptTokenCount ?? 0))
        : maxTokens,
    });
  }
}
export function parseAction(text: string): AgentAction {
  return actionSchema.parse(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '')
        .trim(),
    ),
  );
}
