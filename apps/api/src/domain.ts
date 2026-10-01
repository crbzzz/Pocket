import { z } from 'zod';
export const phases = [
  'queued',
  'analyzing',
  'planning',
  'editing',
  'testing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type Phase = (typeof phases)[number];
export const terminal = new Set<Phase>(['completed', 'failed', 'cancelled']);
export const taskInput = z
  .object({
    projectId: z.string().uuid(),
    branch: z
      .string()
      .min(1)
      .max(200)
      .regex(/^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\\\s])[\w./-]+$/),
    prompt: z.string().trim().min(3).max(12000),
    modelId: z.string().max(100).default('auto'),
    maxCostCents: z.number().int().min(1).max(5000).default(300),
  })
  .strict();
export interface Model {
  id: string;
  name: string;
  description: string;
  provider: string;
  maxCostCents: number;
}
export interface Project {
  id: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  color: string;
  branch: string;
  branches: string[];
  branchSaves?: Record<string, string>;
  memory: { stack: string[]; objective: string; decisions: string[]; recentWork: string[] };
  updatedAt: string;
}
export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}
export interface Report {
  summary: string;
  files: DiffFile[];
  checks: { name: string; status: 'passed' | 'failed' | 'skipped'; detail: string }[];
  snapshotRef: string;
  baseRef: string;
  costCents: number;
}
export interface Job {
  id: string;
  projectId: string;
  branch: string;
  prompt: string;
  modelId: string;
  status: Phase;
  maxCostCents: number;
  createdAt: string;
  updatedAt: string;
  report: Report | null;
  error: string | null;
  demo: boolean;
}
export interface Save {
  id: string;
  projectId: string;
  jobId: string;
  branch: string;
  number: number;
  title: string;
  snapshotRef: string;
  createdAt: string;
}
export interface Event {
  sequence: number;
  jobId: string;
  phase: Phase;
  message: string;
  createdAt: string;
}
export class DomainError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const reportSchema = z.object({
  summary: z.string().max(16000),
  files: z
    .array(
      z.object({
        path: z.string().max(1000),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
        patch: z.string().max(500000),
      }),
    )
    .max(200),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['passed', 'failed', 'skipped']),
      detail: z.string(),
    }),
  ),
  snapshotRef: z.string().min(1),
  baseRef: z.string().min(1),
  costCents: z.number().int().nonnegative(),
});
