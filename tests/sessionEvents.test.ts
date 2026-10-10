import { describe, it, expect } from 'vitest';
import { normalizeEvent, resolveEventState } from '../src/sessionEvents';
import { SessionState } from '../src/types';
import { CodexLogState } from '../src/codexSessions';
const row: SessionState = { provider: 'codex', sessionId: 'abc', cwd: '/work', pid: 1, title: 'Codex', state: 'running', evidence: { source: 'codex-rollout', reason: 'task_started', at: 100, turnId: 'turn-1' } };
const raw = (event: string) => ({ session_id: 'abc', cwd: '/work', hook_event_name: event, turn_id: 'turn-1' });
describe('lifecycle evidence', () => {
  it('normalizes only metadata and resolves permission and later activity', () => {
    const event = normalizeEvent('codex', { ...raw('PermissionRequest'), tool_input: { secret: 'PRIVATE' } }, 200)!;
    expect(event).toEqual({ provider: 'codex', sessionId: 'abc', cwd: '/work', event: 'PermissionRequest', at: 200, turnId: 'turn-1' });
    expect(resolveEventState(row, event).state).toBe('needsInput');
    expect(resolveEventState(row, normalizeEvent('codex', raw('PostToolUse'), 300)).state).toBe('running');
    expect(resolveEventState(row, normalizeEvent('codex', raw('Stop'), 300)).state).toBe('stopped');
  });
  it('ignores old, mismatched session/turn/path and subagent events', () => {
    const event = normalizeEvent('codex', raw('PermissionRequest'), 50)!;
    expect(resolveEventState(row, event)).toEqual(row);
    expect(resolveEventState(row, { ...event, at: 200, sessionId: 'other' })).toEqual(row);
    expect(resolveEventState(row, { ...event, at: 200, turnId: 'other' })).toEqual(row);
    expect(resolveEventState(row, { ...event, at: 200, cwd: '/other' })).toEqual(row);
    expect(normalizeEvent('codex', { ...raw('Stop'), agent_id: 'child' }, 200)).toBeUndefined();
    expect(normalizeEvent('claude', { ...raw('Stop'), agent_type: 'Explore' }, 200)).toBeUndefined();
  });
  it('does not mistake tool failure for an agent failure, and rejects unknown events', () => {
    expect(normalizeEvent('codex', raw('StopFailure'), 200)).toBeUndefined();
    expect(resolveEventState({ ...row, provider: 'claude' }, normalizeEvent('claude', raw('StopFailure'), 200)).state).toBe('error');
    expect(normalizeEvent('claude', { ...raw('Notification'), notification_type: 'auth_success' }, 200)).toBeUndefined();
    expect(normalizeEvent('codex', raw('Unsupported'), 200)).toBeUndefined();
    expect(normalizeEvent('codex', { ...raw('Stop'), session_id: '../../evil' }, 200)).toBeUndefined();
    expect(resolveEventState(row, undefined)).toBe(row);
  });
  it('newer rollout evidence supersedes a stale permission hook', () => {
    const log = new CodexLogState();
    log.accept({ timestamp: '2026-10-10T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'one' } });
    expect(log.evidence).toEqual({ source: 'codex-rollout', reason: 'task_started', at: 1791633600000, turnId: 'one' });
    log.accept({ timestamp: '2026-10-10T12:00:01.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'irrelevant' } });
    expect(log.evidence?.at).toBe(1791633600000);
  });
});
