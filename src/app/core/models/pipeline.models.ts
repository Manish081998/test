// ── Step UI types ──────────────────────────────────────────────────────────

export type StepStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';

export interface Step {
  id: string;
  label: string;
  sublabel: string;
  status: StepStatus;
  detail: string;
}

export interface LogEntry {
  time: string;
  label: string;
  status: StepStatus;
  text: string;
}

export interface PrResult {
  title: string;
  url: string;
  status: 'created' | 'exists';
  number: number;
  merged?: boolean;
}

// ── GitPushService event discriminated union ───────────────────────────────
// Maps to SSE events from the local express server (/api/dotnet/build)

export type BuildEvent =
  | { type: 'stdout';      text: string }
  | { type: 'stderr';      text: string }
  | { type: 'build-done' }
  | { type: 'build-fatal'; text: string };

// Maps to SSE events from the local express server (/api/git/push)
export type GitPushEvent =
  | { type: 'step-start'; id: string; cmd: string }
  | { type: 'stdout';     text: string }
  | { type: 'stderr';     text: string }
  | { type: 'step-end';   id: string; ok: boolean; noop?: boolean }
  | { type: 'fatal';      id: string; text: string }
  | { type: 'git-done' };

// ── PipelineService event discriminated union ──────────────────────────────

export type PipelineEvent =
  | { type: 'step-start';   id: string }
  | { type: 'step-running'; id: string; detail: string }
  | { type: 'step-done';    id: string; detail: string }
  | { type: 'step-skipped'; id: string; detail: string }
  | { type: 'step-error';   id: string; detail: string }
  | { type: 'pr-result';    prResult: PrResult }
  | { type: 'complete' };

export interface PipelineConfig {
  owner: string;
  repo: string;
  token: string;
  headBranch: string;
  baseBranch: string;
  description: string;
}
