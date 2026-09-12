import { describe, it, expect } from 'vitest';
import { TerminalLinker, TerminalLike } from '../src/terminalLinker';

const term = (pid: number | undefined, cwd?: string): TerminalLike => ({
  processId: Promise.resolve(pid),
  shellIntegration: cwd ? { cwd: { fsPath: cwd } } : undefined,
  show: () => {},
});

describe('TerminalLinker.resolve', () => {
  it('matches by process tree: claude ppid === terminal processId', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => 100 });
    const shell = term(100);
    const other = term(200);
    const found = await linker.resolve({ pid: 999, cwd: '/x' }, [other, shell]);
    expect(found).toBe(shell);
  });

  it('falls back to cwd when ppid does not match any terminal', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => 555 });
    const byCwd = term(300, '/work/app');
    const found = await linker.resolve({ pid: 999, cwd: '/work/app' }, [byCwd]);
    expect(found).toBe(byCwd);
  });

  it('returns undefined when neither ppid nor cwd match', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => undefined });
    const t = term(300, '/other');
    const found = await linker.resolve({ pid: 999, cwd: '/work/app' }, [t]);
    expect(found).toBeUndefined();
  });

  it('prefers process-tree match over cwd match', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => 100 });
    const byTree = term(100, '/other');
    const byCwd = term(200, '/work/app');
    const found = await linker.resolve({ pid: 999, cwd: '/work/app' }, [byCwd, byTree]);
    expect(found).toBe(byTree);
  });
  it('walks through a Codex wrapper to the nearest terminal ancestor', async () => {
    const parents = new Map([[999, 500], [500, 100], [100, 50]]);
    const linker = new TerminalLinker({ getParentPid: async pid => parents.get(pid) });
    const nearest = term(100, '/shared');
    expect(await linker.resolve({ pid: 999, cwd: '/shared' }, [term(50), term(200, '/shared'), nearest])).toBe(nearest);
  });

  it('does not pick arbitrarily among terminals with the same cwd', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => undefined });
    expect(await linker.resolve({ pid: 999, cwd: '/shared' }, [term(100, '/shared'), term(200, '/shared')])).toBeUndefined();
  });

  it('does not match the session itself when the process tree cycles', async () => {
    const parents = new Map([[999, 500], [500, 999]]);
    const visited: number[] = [];
    const linker = new TerminalLinker({ getParentPid: async pid => { visited.push(pid); return parents.get(pid); } });
    expect(await linker.resolve({ pid: 999, cwd: '/x' }, [term(999)])).toBeUndefined();
    expect(visited).toEqual([999, 500]);
  });

  it('bounds ancestor discovery to twelve parent lookups', async () => {
    let calls = 0;
    const linker = new TerminalLinker({ getParentPid: async pid => { calls++; return pid + 1; } });
    expect(await linker.resolve({ pid: 100, cwd: '/x' }, [term(113)])).toBeUndefined();
    expect(calls).toBe(12);
  });

  it('can match the twelfth ancestor', async () => {
    const linker = new TerminalLinker({ getParentPid: async pid => pid + 1 });
    const shell = term(112);
    expect(await linker.resolve({ pid: 100, cwd: '/x' }, [shell])).toBe(shell);
  });

  it('caches wrapper ancestry while a session is live and prunes it afterwards', async () => {
    const parents = new Map([[999, 500], [500, 100]]);
    let calls = 0;
    const linker = new TerminalLinker({ getParentPid: async pid => { calls++; return parents.get(pid); } });
    const shell = term(100);
    expect(await linker.resolve({ pid: 999, cwd: '/x' }, [shell])).toBe(shell);
    linker.prune(new Set([999]));
    expect(await linker.resolve({ pid: 999, cwd: '/x' }, [shell])).toBe(shell);
    expect(calls).toBe(2);
    linker.prune(new Set());
    parents.set(500, 200);
    const newShell = term(200);
    expect(await linker.resolve({ pid: 999, cwd: '/x' }, [shell, newShell])).toBe(newShell);
  });

  it('does not associate a root or invalid parent PID with a terminal', async () => {
    for (const parent of [0, 1, -1, NaN, 1.5]) {
      const linker = new TerminalLinker({ getParentPid: async () => parent });
      expect(await linker.resolve({ pid: 999, cwd: '/x' }, [term(parent)])).toBeUndefined();
    }
  });

});
