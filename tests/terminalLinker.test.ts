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
});
