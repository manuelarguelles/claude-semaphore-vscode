import { Provider, SemaphoreState, SessionState } from './types';
import { persistentSessionKey } from './sessionIdentity';

export interface StateEvent { at: number; state: SemaphoreState | 'offline'; reason: string; source: string }
export interface RecordedSession {
  key: string; provider: Provider; sessionId: string; cwd: string; title: string;
  lastSeenAt: number; active: boolean; events: StateEvent[];
}
export interface JournalData { version: 1; sessions: RecordedSession[] }
const states = new Set(['running', 'needsInput', 'stopped', 'error', 'unknown', 'offline']);
const text = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Stores observation intervals, never guesses task progress or activity from elapsed time. */
export class SessionJournal {
  private sessions = new Map<string, RecordedSession>();
  constructor(data: unknown, private readonly now: () => number = Date.now) {
    const raw = data as Partial<JournalData> | undefined;
    if (raw?.version !== 1 || !Array.isArray(raw.sessions)) return;
    for (const r of raw.sessions.slice(-1000)) {
      if (!r || !['claude', 'codex'].includes(r.provider) || !text(r.sessionId, 200) || !r.sessionId || !text(r.cwd, 4096)
        || !text(r.title) || !finite(r.lastSeenAt) || r.lastSeenAt > this.now() || !Array.isArray(r.events)) continue;
      const events: StateEvent[] = [];
      for (const e of r.events.slice(-200)) {
        if (!e || !finite(e.at) || e.at > r.lastSeenAt + (e.state === 'offline' ? Math.max(0, this.now() - r.lastSeenAt) : 0) || (events.length && e.at < events[events.length - 1].at)
          || !states.has(e.state) || !text(e.reason) || !text(e.source, 100)) continue;
        events.push({ at: e.at, state: e.state, reason: e.reason, source: e.source });
      }
      if (!events.length) continue;
      if (events[events.length - 1].state !== 'offline') {
        events.push({ at: r.lastSeenAt, state: 'offline', reason: 'Fin de observación anterior', source: 'monitor' });
      }
      const entry: RecordedSession = { key: persistentSessionKey(r), provider: r.provider, sessionId: r.sessionId,
        cwd: r.cwd, title: r.title, lastSeenAt: r.lastSeenAt, active: false, events: events.slice(-200) };
      this.sessions.set(entry.key, entry);
    }
    this.prune();
  }
  observe(sessions: SessionState[]): boolean {
    const at = this.now(); const seen = new Set<string>(); let changed = false;
    for (const s of sessions) {
      const key = persistentSessionKey(s); seen.add(key);
      let r = this.sessions.get(key);
      if (!r) {
        r = { key, provider: s.provider ?? 'claude', sessionId: s.sessionId, cwd: s.cwd, title: s.title,
          lastSeenAt: at, active: true, events: [] };
        this.sessions.set(key, r); changed = true;
      }
      const reason = (s.evidence?.reason ?? (s.state === 'needsInput' ? 'Respuesta pendiente observada' : s.state)).slice(0, 500).replace(/[\u0000-\u001f]/g, ' ');
      const source = (s.evidence?.source ?? 'local-reader').slice(0, 100);
      const last = r.events[r.events.length - 1];
      if (!last || last.state !== s.state || last.reason !== reason || last.source !== source) {
        r.events.push({ at, state: s.state, reason, source }); r.events = r.events.slice(-200); changed = true;
      }
      if (r.title !== s.title || r.cwd !== s.cwd || !r.active) changed = true;
      r.title = s.title; r.cwd = s.cwd; r.active = true; r.lastSeenAt = at;
    }
    for (const r of this.sessions.values()) {
      if (r.active && !seen.has(r.key)) {
        r.active = false;
        r.events.push({ at, state: 'offline', reason: 'Sesión no observada', source: 'monitor' });
        r.events = r.events.slice(-200); changed = true;
      }
    }
    return this.prune() || changed;
  }
  private prune(): boolean {
    const before = this.sessions.size;
    for (const [key, r] of this.sessions) if (this.now() - r.lastSeenAt > 30 * 86400000) this.sessions.delete(key);
    const newest = [...this.sessions.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.key.localeCompare(b.key));
    for (const r of newest.slice(1000)) this.sessions.delete(r.key);
    return this.sessions.size !== before;
  }
  recent(): RecordedSession[] { return copy([...this.sessions.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.key.localeCompare(b.key))); }
  snapshot(): JournalData { return { version: 1, sessions: this.recent() }; }
  clear(): void { this.sessions.clear(); }
}
export function observedDurations(session: RecordedSession): Partial<Record<SemaphoreState, number>> {
  const result: Partial<Record<SemaphoreState, number>> = {};
  session.events.forEach((event, i) => {
    if (event.state === 'offline') return;
    const end = session.events[i + 1]?.at ?? session.lastSeenAt;
    result[event.state] = (result[event.state] ?? 0) + Math.max(0, end - event.at);
  });
  return result;
}
