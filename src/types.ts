export type Provider = 'claude' | 'codex' | 'opencode';
export type SemaphoreState = 'running' | 'needsInput' | 'stopped' | 'error' | 'unknown';

export type ThemeName = 'classic' | 'colorblind' | 'highContrast';

export interface RawSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  status: string;
  name?: string;
  kind?: string;
  statusUpdatedAt?: number;
  /** Free-form reason, e.g. "permission prompt", "dialog open", "input needed". */
  waitingFor?: string;
}

export interface SessionState {
  provider?: Provider;
  sessionId: string;
  pid: number;
  cwd: string;
  title: string;
  state: SemaphoreState;
  /** True when another live session resolved to the same title (e.g. a fork). */
  duplicateTitle?: boolean;
  /** Why the session is waiting, when Claude Code reports it. */
  waitingFor?: string;
  evidence?: { source: string; reason: string; at?: number; turnId?: string };
}

export interface Summary {
  unknown?: number;
  error?: number;
  running: number;
  needsInput: number;
  stopped: number;
}
