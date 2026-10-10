import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Provider, SessionState, SemaphoreState } from './types';
import { persistentSessionKey } from './sessionIdentity';
const protocol = require('../scripts/hook-protocol.cjs');
export interface NormalizedEvent { provider: Provider; sessionId: string; cwd: string; event: string; at: number; turnId?: string }
export const normalizeEvent: (provider: Provider, raw: unknown, now: number) => NormalizedEvent | undefined = protocol.normalizeEvent;
const eventStates: Record<string, SemaphoreState> = {
  SessionStart: 'stopped', UserPromptSubmit: 'running', PreToolUse: 'running', PostToolUse: 'running',
  PermissionRequest: 'needsInput', Notification: 'needsInput', Question: 'needsInput',
  Stop: 'stopped', Interrupt: 'stopped', SessionEnd: 'stopped', StopFailure: 'error',
};
export function resolveEventState(session: SessionState, event: NormalizedEvent | undefined): SessionState {
  if (!event || event.provider !== (session.provider ?? 'claude') || event.sessionId !== session.sessionId || event.cwd !== session.cwd
    || event.at <= (session.evidence?.at ?? 0) || (event.turnId && session.evidence?.turnId && event.turnId !== session.evidence.turnId)
    || !eventStates[event.event]) return session;
  const state = eventStates[event.event];
  return { ...session, state, waitingFor: state === 'needsInput' ? (event.event === 'PermissionRequest' ? 'Permiso solicitado' : 'Respuesta solicitada') : undefined,
    evidence: { source: `${event.provider}-hook`, reason: event.event, at: event.at, turnId: event.turnId } };
}
/** Bounded filesystem telemetry; ignore untrusted text and stale metadata, clean own expired artifacts. */
export async function readSessionEvents(directory: string, now = Date.now(), active?: readonly SessionState[]): Promise<Map<string, NormalizedEvent>> {
  const result = new Map<string, NormalizedEvent>();
  let names: string[];
  if (active) names = [...new Set(active.map(s => createHash('sha256').update(JSON.stringify([s.provider ?? 'claude', s.sessionId])).digest('hex') + '.json'))];
  else { try { names = await fs.readdir(directory); } catch { return result; } }
  for (const name of names.filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
    const file = path.join(directory, name);
    try {
      const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) continue;
      const e = JSON.parse(await fs.readFile(file, 'utf8')) as NormalizedEvent;
      if (!Number.isFinite(e.at) || e.at > now + 1000 || e.at < now - 30 * 86400000) { if (e.at < now - 30 * 86400000) await fs.unlink(file); continue; }
      const valid = normalizeEvent(e.provider, { session_id: e.sessionId, cwd: e.cwd, hook_event_name: e.event === 'Question' ? 'PermissionRequest' : e.event,
        notification_type: 'input_needed', turn_id: e.turnId }, e.at);
      if (valid) result.set(persistentSessionKey(valid), { ...valid, event: e.event });
    } catch { /* incomplete or corrupt telemetry */ }
  }
  return result;
}
