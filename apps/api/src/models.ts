import { z } from 'zod';
import { DomainError, type Model } from './domain.js';
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search'), query: z.string().max(200) }),
  z.object({ kind: z.literal('read'), path: z.string().max(1000) }),
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
    return message;
  });
}
export type AgentAction = z.infer<typeof actionSchema>;
export interface Message {
  role: 'user' | 'assistant';
  content: string;
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
        messages: [{ role: 'system', content: system }, ...messages],
        max_completion_tokens: maxTokens,
      };
    } else if (model.provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: model.model,
        system,
        messages: actionMode ? anthropicMessages(messages) : messages,
        max_tokens: maxTokens,
        ...(actionMode
          ? { tools: actionTools, tool_choice: { type: 'any', disable_parallel_tool_use: true } }
          : {}),
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`;
      headers['x-goog-api-key'] = key;
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    });
    if (!response.ok) throw new Error(`Model service returned ${response.status}`);
    const d = (await response.json()) as any;
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
