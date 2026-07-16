export type SemaphoreState = 'running' | 'needsInput' | 'stopped';

export type ThemeName = 'classic' | 'colorblind' | 'highContrast';

export interface RawSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  status: string;
  name?: string;
  kind?: string;
  statusUpdatedAt?: number;
}

export interface SessionState {
  sessionId: string;
  pid: number;
  cwd: string;
  title: string;
  state: SemaphoreState;
  /** True when another live session resolved to the same title (e.g. a fork). */
  duplicateTitle?: boolean;
}

export interface Summary {
  running: number;
  needsInput: number;
  stopped: number;
}
