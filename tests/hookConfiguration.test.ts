import { describe, it, expect } from 'vitest';
import { mergeHooks, removeOwnHooks, hookCommand } from '../src/hookConfiguration';
describe('optional hooks configuration', () => {
  it.each(['claude', 'codex'] as const)('merges idempotently and removes only owned hooks for %s', provider => {
    const original = { model: 'keep', hooks: { Stop: [{ matcher: 'keep', hooks: [{ type: 'command', command: 'echo existing' }] }] } };
    const once = mergeHooks(provider, original, 'own receiver');
    expect(mergeHooks(provider, once, 'own receiver')).toEqual(once);
    expect(removeOwnHooks(provider, once, 'own receiver')).toEqual(original);
    expect(original.hooks.Stop).toHaveLength(1);
  });
  it('rejects malformed config instead of overwriting it', () => {
    expect(() => mergeHooks('claude', { hooks: [] }, 'own')).toThrow();
    expect(() => mergeHooks('codex', { hooks: { Stop: 'wrong' } }, 'own')).toThrow();
  });
  it('quotes literal paths and provides short nonblocking command hooks', () => {
    const command = hookCommand('/node path/node', '/a path/receiver.cjs', '/a path/events', 'claude', 'linux');
    expect(command).toBe("'/node path/node' '/a path/receiver.cjs' 'claude' '/a path/events'");
    const configured = mergeHooks('codex', {}, command) as any;
    expect(configured.hooks.PermissionRequest[0].hooks[0]).toMatchObject({ type: 'command', timeout: 2, command });
  });
});
