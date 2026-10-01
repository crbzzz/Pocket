import type Fastify from 'fastify';
import { DomainError } from './domain.js';

type RequestData = {
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  rawBody: Buffer | null;
  userId: string;
};
type Handler = (request: RequestData, reply: Reply) => unknown;
class Reply {
  statusCode = 200;
  headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  value: unknown;
  sent = false;
  code(status: number) {
    this.statusCode = status;
    return this;
  }
  header(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  type(value: string) {
    return this.header('content-type', value);
  }
  send(value?: unknown) {
    this.value = value;
    this.sent = true;
    return this;
  }
  redirect(location: string) {
    return this.code(302).header('location', location).send();
  }
}

// Fetch-compatible transport. Route handlers and Zod authorization/validation are shared
// with the local Fastify API; routing never compiles JavaScript at runtime.
export function createEdgeRouter(options: { bodyLimit: number }) {
  const routes: { method: string; segments: string[]; handler: Handler; limit: number }[] = [];
  const hooks: Handler[] = [];
  let errorHandler: (error: Error, request: RequestData, reply: Reply) => unknown;
  const register = (
    method: string,
    path: string,
    config: Handler | { bodyLimit?: number },
    handler?: Handler,
  ) => {
    routes.push({
      method,
      segments: path.split('/'),
      handler: handler ?? (config as Handler),
      limit:
        typeof config === 'function' ? options.bodyLimit : (config.bodyLimit ?? options.bodyLimit),
    });
  };
  const app = {
    get: (path: string, config: Handler | { bodyLimit?: number }, handler?: Handler) =>
      register('GET', path, config, handler),
    post: (path: string, config: Handler | { bodyLimit?: number }, handler?: Handler) =>
      register('POST', path, config, handler),
    delete: (path: string, handler: Handler) => register('DELETE', path, handler),
    decorateRequest() {},
    removeContentTypeParser() {},
    addContentTypeParser() {},
    setSerializerCompiler() {},
    setValidatorCompiler() {},
    addHook(_name: string, handler: Handler) {
      hooks.push(handler);
    },
    setErrorHandler(handler: typeof errorHandler) {
      errorHandler = handler;
    },
    log: {
      error(data: { err: Error }, message: string) {
        console.error(
          JSON.stringify({ event: 'request.failed', message, reason: data.err.message }),
        );
      },
    },
    async inject(input: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      payload?: Buffer | string;
    }) {
      const url = new URL(input.url, 'https://pocket.invalid');
      const segments = url.pathname.split('/');
      const route = routes.find(
        (r) =>
          r.method === input.method &&
          r.segments.length === segments.length &&
          r.segments.every((part, i) => part.startsWith(':') || part === segments[i]),
      );
      const reply = new Reply();
      const request: RequestData = {
        url: input.url,
        headers: Object.fromEntries(
          Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
        ),
        params: {},
        query: Object.fromEntries(url.searchParams),
        userId: '',
        rawBody: input.payload ? Buffer.from(input.payload) : null,
      };
      try {
        if (!route) throw new DomainError(404, 'Not found');
        route.segments.forEach((part, i) => {
          if (part.startsWith(':'))
            request.params[part.slice(1)] = decodeURIComponent(segments[i]!);
        });
        if (request.rawBody) {
          if (request.rawBody.length > route.limit) throw new DomainError(413, 'Request too large');
          if (!request.headers['content-type']?.startsWith('application/json'))
            throw new DomainError(415, 'Expected application/json');
          try {
            request.body = JSON.parse(request.rawBody.toString('utf8'));
          } catch {
            throw new DomainError(400, 'Invalid JSON');
          }
        }
        for (const hook of hooks) await hook(request, reply);
        const result = await route.handler(request, reply);
        if (!reply.sent) reply.send(result);
      } catch (error) {
        await errorHandler(
          error instanceof Error ? error : new Error('Request failed'),
          request,
          reply,
        );
      }
      const rawPayload = Buffer.from(
        reply.statusCode === 204 || reply.value === undefined
          ? ''
          : typeof reply.value === 'string' && !reply.headers['content-type']?.includes('json')
            ? reply.value
            : JSON.stringify(reply.value),
      );
      return {
        statusCode: reply.statusCode,
        headers: reply.headers,
        rawPayload,
        json: () => JSON.parse(rawPayload.toString()),
      };
    },
    async close() {},
  };
  // Fastify's type describes the shared handler contract. Unsupported server APIs
  // are never used by createServer when nativeRateLimit is enabled.
  return app as unknown as ReturnType<typeof Fastify>;
}
