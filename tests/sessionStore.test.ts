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

  it('sorts sessions by title', () => {
    const f = [
      { path: 'a', raw: { ...base, sessionId: 's2', name: 'Zebra', pid: 2 } },
      { path: 'b', raw: { ...base, sessionId: 's1', name: 'Apple', pid: 1 } },
    ];
    const { sessions } = buildSessions(deps(f, [1, 2]));
    expect(sessions.map((s) => s.title)).toEqual(['Apple', 'Zebra']);
  });
});
