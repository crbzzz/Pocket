import { z } from 'zod';
export const intentSystem = `Classify the user's request before any repository work. Return only JSON: {"intent":"analysis"} or {"intent":"change"}. Use analysis for summaries, explanations, audits, questions, plans, recommendations, or code examples requested as an answer. Use change only when the user asks to actually create, edit, fix or implement repository files. If unclear, choose analysis. Do not execute the request.`;
export function parseIntent(text: string): 'analysis' | 'change' {
  return z.object({ intent: z.enum(['analysis', 'change']) }).parse(
    JSON.parse(
      text
        .trim()
        .replace(/^\x60\x60\x60(?:json)?\s*/, '')
        .replace(/\s*\x60\x60\x60$/, ''),
    ),
  ).intent;
}
