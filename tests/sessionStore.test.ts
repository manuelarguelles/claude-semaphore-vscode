import { describe, it, expect } from 'vitest';
import { buildSessions, isValidRaw, StoreDeps } from '../src/sessionStore';

function deps(files: { path: string; raw: unknown }[], alivePids: number[]): StoreDeps {
  return {
    listSessionFiles: () => files,
    isAlive: (pid) => alivePids.includes(pid),
    resolveTitle: (raw) => raw.name ?? raw.cwd,
  };
}

const base = { pid: 1, sessionId: 's1', cwd: '/repo/one', status: 'busy', name: 'One', kind: 'interactive' };

describe('isValidRaw', () => {
  it('accepts a well-formed session file', () => expect(isValidRaw(base)).toBe(true));
  it('rejects objects missing required keys', () => {
    expect(isValidRaw({ pid: 1 })).toBe(false);
    expect(isValidRaw(null)).toBe(false);
  });
});

describe('buildSessions', () => {
  it('maps live interactive sessions to SessionState', () => {
    const { sessions } = buildSessions(deps([{ path: 'a', raw: base }], [1]));
    expect(sessions).toEqual([
      { sessionId: 's1', pid: 1, cwd: '/repo/one', title: 'One', state: 'running' },
    ]);
  });

  it('drops sessions whose pid is not alive', () => {
    const { sessions } = buildSessions(deps([{ path: 'a', raw: base }], []));
    expect(sessions).toHaveLength(0);
  });

  it('skips non-interactive sessions', () => {
    const bg = { ...base, kind: 'background' };
    const { sessions } = buildSessions(deps([{ path: 'a', raw: bg }], [1]));
    expect(sessions).toHaveLength(0);
  });

  it('flags unknown schema and skips the bad file', () => {
    const { sessions, sawUnknownSchema } = buildSessions(
      deps([{ path: 'a', raw: { foo: 'bar' } }], [1]),
    );
    expect(sessions).toHaveLength(0);
    expect(sawUnknownSchema).toBe(true);
  });

  it('includes daemon-backed sessions (kind "bg", e.g. forks)', () => {
    const fork = { ...base, kind: 'bg', sessionId: 's2', pid: 2, name: 'Forked' };
    const { sessions } = buildSessions(deps([{ path: 'a', raw: fork }], [2]));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Forked');
  });

  it('flags sessions that share a title so the UI can disambiguate', () => {
    const f = [
      { path: 'a', raw: { ...base, sessionId: 's1', pid: 1, name: 'Same title' } },
      { path: 'b', raw: { ...base, sessionId: 's2', pid: 2, name: 'Same title' } },
      { path: 'c', raw: { ...base, sessionId: 's3', pid: 3, name: 'Unique' } },
    ];
    const { sessions } = buildSessions(deps(f, [1, 2, 3]));
    const byPid = new Map(sessions.map((s) => [s.pid, s]));
    expect(byPid.get(1)?.duplicateTitle).toBe(true);
    expect(byPid.get(2)?.duplicateTitle).toBe(true);
    expect(byPid.get(3)?.duplicateTitle).toBeFalsy();
  });

  it('sorts sessions by title', () => {
    const f = [
      { path: 'a', raw: { ...base, sessionId: 's2', name: 'Zebra', pid: 2 } },
      { path: 'b', raw: { ...base, sessionId: 's1', name: 'Apple', pid: 1 } },
    ];
    const { sessions } = buildSessions(deps(f, [1, 2]));
    expect(sessions.map((s) => s.title)).toEqual(['Apple', 'Zebra']);
  });

  it('carries waitingFor through so the UI can say why a session is amber', () => {
    const waiting = { ...base, status: 'waiting', waitingFor: 'permission prompt' };
    const { sessions } = buildSessions(deps([{ path: 'a', raw: waiting }], [1]));
    expect(sessions[0].waitingFor).toBe('permission prompt');
  });

  it('leaves waitingFor undefined when the session file omits it', () => {
    const { sessions, sawUnknownSchema } = buildSessions(deps([{ path: 'a', raw: base }], [1]));
    expect(sessions[0].waitingFor).toBeUndefined();
    expect(sawUnknownSchema).toBe(false);
  });

  it('ignores a non-string waitingFor rather than dropping the session', () => {
    const bogus = { ...base, status: 'waiting', waitingFor: 42 };
    const { sessions } = buildSessions(deps([{ path: 'a', raw: bogus }], [1]));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].waitingFor).toBeUndefined();
  });
});
