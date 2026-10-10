import { Provider, SemaphoreState, SessionState } from './types';
import { persistentSessionKey, sessionKey } from './sessionIdentity';

export interface ViewOptions { query: string; provider?: Provider; state?: SemaphoreState; favoritesOnly: boolean; grouped: boolean }
export interface ProjectGroup { kind: 'project'; id: string; cwd: string; sessions: SessionState[] }
export function defaultViewOptions(): ViewOptions { return { query: '', favoritesOnly: false, grouped: true }; }
export const stateLabels: Record<SemaphoreState, string> = {
  running: 'trabajando', needsInput: 'necesita respuesta', stopped: 'inactivo / finalizado', error: 'error observado', unknown: 'desconocido',
};
const priority: Record<SemaphoreState, number> = { needsInput: 0, error: 1, running: 2, stopped: 3, unknown: 4 };
export function presentSessions(sessions: SessionState[], options: ViewOptions, favorites: ReadonlySet<string>): ProjectGroup[] {
  const query = options.query.trim().toLocaleLowerCase();
  const filtered = sessions.filter(s => (!options.provider || (s.provider ?? 'claude') === options.provider)
    && (!options.state || s.state === options.state)
    && (!options.favoritesOnly || favorites.has(persistentSessionKey(s)))
    && (!query || [s.title, s.cwd, s.provider ?? 'claude'].join('\n').toLocaleLowerCase().includes(query)));
  const compare = (a: SessionState, b: SessionState) => priority[a.state] - priority[b.state]
    || Number(favorites.has(persistentSessionKey(b))) - Number(favorites.has(persistentSessionKey(a)))
    || a.title.localeCompare(b.title) || sessionKey(a).localeCompare(sessionKey(b));
  const groups = new Map<string, ProjectGroup>();
  for (const s of filtered) {
    const cwd = options.grouped ? s.cwd : '';
    if (!groups.has(cwd)) groups.set(cwd, { kind: 'project', id: JSON.stringify(['project', cwd]), cwd, sessions: [] });
    groups.get(cwd)!.sessions.push(s);
  }
  const result = [...groups.values()];
  result.forEach(g => g.sessions.sort(compare));
  return result.sort((a, b) => priority[a.sessions[0].state] - priority[b.sessions[0].state] || a.cwd.localeCompare(b.cwd));
}
