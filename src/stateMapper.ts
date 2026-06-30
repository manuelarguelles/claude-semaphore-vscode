import { SemaphoreState, SessionState, Summary } from './types';

const STATUS_MAP: Record<string, SemaphoreState> = {
  busy: 'running',
  needs_input: 'needsInput',
  waiting: 'needsInput',
  blocked: 'needsInput',
  idle: 'stopped',
  paused: 'stopped',
};

export function mapStatus(status: string): SemaphoreState {
  return STATUS_MAP[status] ?? 'stopped';
}

export function summarize(sessions: SessionState[]): Summary {
  const out: Summary = { running: 0, needsInput: 0, stopped: 0 };
  for (const s of sessions) {
    out[s.state]++;
  }
  return out;
}
