// Incremental SSE decoding preserves UTF-8 and frames split across network chunks.
export async function* sse(response: Response): AsyncGenerator<any> {
  if (!response.body) throw new Error('Model stream unavailable');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
      if (buffer.length > 250000) throw new Error('Model stream exceeds limit');
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
// Only expose the final answer argument, never tool code, commands or intermediate JSON.
export function partialSummary(json: string): string {
  const match = /"summary"\s*:\s*"/.exec(json);
  if (!match) return '';
  let end = match.index + match[0].length,
    encoded = '';
  for (let i = end; i < json.length; i++) {
    const c = json[i]!;
    if (c === '"') break;
    if (c === '\\') {
      const next = json[i + 1];
      if (!next) break;
      if (next === 'u') {
        const hex = json.slice(i + 2, i + 6);
        if (!/^[0-9a-f]{4}$/i.test(hex)) break;
        encoded += '\\u' + hex;
        i += 5;
      } else {
        if (!'"\\/bfnrt'.includes(next)) break;
        encoded += '\\' + next;
        i++;
      }
    } else {
      if (c.charCodeAt(0) < 32) break;
      encoded += c;
    }
  }
  try {
    return JSON.parse('"' + encoded + '"');
  } catch {
    return '';
  }
}
