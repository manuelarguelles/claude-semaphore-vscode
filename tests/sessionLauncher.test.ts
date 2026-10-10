import { describe, it, expect } from 'vitest';
import { buildLaunch } from '../src/sessionLauncher';
import { AgentCapabilities } from '../src/agentCapabilities';
const capabilities = (provider: 'claude' | 'codex'): AgentCapabilities => ({ provider, executable: '/bin/agent', start: true, resume: true, fork: true, worktree: true, hooks: true });
describe('literal terminal launch specifications', () => {
  it('uses independent resume and fork operations for both providers', () => {
    expect(buildLaunch({ provider: 'claude', action: 'fork', sessionId: 'abc', cwd: '/path with spaces' }, capabilities('claude')))
      .toEqual({ executable: '/bin/agent', args: ['--resume', 'abc', '--fork-session'], cwd: '/path with spaces' });
    expect(buildLaunch({ provider: 'codex', action: 'fork', sessionId: 'abc', cwd: '/work' }, capabilities('codex')).args).toEqual(['fork', 'abc']);
    expect(buildLaunch({ provider: 'codex', action: 'resume', sessionId: 'abc', cwd: '/work' }, capabilities('codex')).args).toEqual(['resume', 'abc']);
    expect(buildLaunch({ provider: 'claude', action: 'start', cwd: '/work' }, capabilities('claude')).args).toEqual([]);
  });
  it('rejects missing support, unsafe IDs and invalid directories without fallback', () => {
    expect(() => buildLaunch({ provider: 'codex', action: 'fork', sessionId: 'abc', cwd: '/work' }, { ...capabilities('codex'), fork: false })).toThrow();
    for (const sessionId of ['--last', '', '../evil', 'x\nrestart', '$(touch file)']) {
      expect(() => buildLaunch({ provider: 'codex', action: 'resume', sessionId, cwd: '/work' }, capabilities('codex'))).toThrow();
    }
    expect(() => buildLaunch({ provider: 'codex', action: 'start', cwd: 'relative' }, capabilities('codex'))).toThrow();
  });
  it('opens native resume pickers only when explicitly requested', () => {
    expect(buildLaunch({ provider: 'codex', action: 'resume', cwd: '/work', nativePicker: true }, capabilities('codex')).args).toEqual(['resume']);
    expect(buildLaunch({ provider: 'claude', action: 'resume', cwd: '/work', nativePicker: true }, capabilities('claude')).args).toEqual(['--resume']);
  });
});
