import { SemaphoreState, SessionState, Summary } from './types';

const STATUS_MAP: Record<string, SemaphoreState> = {
  busy: 'running',
  needs_input: 'needsInput',
  waiting: 'needsInput',
  blocked: 'needsInput',
  idle: 'stopped',
  paused: 'stopped',
  shell: 'stopped',
  error: 'error',
  failed: 'error',
};

export function mapStatus(status: string): SemaphoreState {
  return STATUS_MAP[status] ?? 'unknown';
}

export function summarize(sessions: SessionState[]): Summary {
  const out: Summary = { running: 0, needsInput: 0, stopped: 0 };
  for (const s of sessions) {
    if (s.state === 'unknown') out.unknown = (out.unknown ?? 0) + 1;
    else if (s.state === 'error') out.error = (out.error ?? 0) + 1;
    else out[s.state]++;
  }
  return out;
}
