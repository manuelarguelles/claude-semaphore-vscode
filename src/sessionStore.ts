import { RawSessionFile, SessionState } from './types';
import { mapStatus } from './stateMapper';

export function isValidRaw(raw: unknown): raw is RawSessionFile {
  if (!raw || typeof raw !== 'object') { return false; }
  const r = raw as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.status === 'string' &&
    typeof r.cwd === 'string' &&
    typeof r.pid === 'number'
  );
}

export interface StoreDeps {
  listSessionFiles: () => { path: string; raw: unknown }[];
  isAlive: (pid: number) => boolean;
  resolveTitle: (raw: RawSessionFile) => string;
}

export function buildSessions(deps: StoreDeps): { sessions: SessionState[]; sawUnknownSchema: boolean } {
  const sessions: SessionState[] = [];
  let sawUnknownSchema = false;

  for (const { raw } of deps.listSessionFiles()) {
    if (!isValidRaw(raw)) {
      sawUnknownSchema = true;
      continue;
    }
    if (raw.kind && raw.kind !== 'interactive' && raw.kind !== 'bg') { continue; }
    if (!deps.isAlive(raw.pid)) { continue; }
    sessions.push({
      sessionId: raw.sessionId,
      pid: raw.pid,
      cwd: raw.cwd,
      title: deps.resolveTitle(raw),
      state: mapStatus(raw.status),
    });
  }

  const titleCounts = new Map<string, number>();
  for (const s of sessions) {
    titleCounts.set(s.title, (titleCounts.get(s.title) ?? 0) + 1);
  }
  for (const s of sessions) {
    if ((titleCounts.get(s.title) ?? 0) > 1) { s.duplicateTitle = true; }
  }

  sessions.sort((a, b) => a.title.localeCompare(b.title));
  return { sessions, sawUnknownSchema };
}
