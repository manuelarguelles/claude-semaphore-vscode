import { describe, it, expect } from 'vitest';
import { mapStatus, summarize } from '../src/stateMapper';
import { SessionState } from '../src/types';

describe('mapStatus', () => {
  it('maps busy to running', () => expect(mapStatus('busy')).toBe('running'));
  it('maps needs_input/waiting/blocked to needsInput', () => {
    expect(mapStatus('needs_input')).toBe('needsInput');
    expect(mapStatus('waiting')).toBe('needsInput');
    expect(mapStatus('blocked')).toBe('needsInput');
  });
  it('maps idle/paused to stopped', () => {
    expect(mapStatus('idle')).toBe('stopped');
    expect(mapStatus('paused')).toBe('stopped');
  });
  it('maps unknown values to stopped', () => expect(mapStatus('wat')).toBe('stopped'));
  // Decision: a session sitting at a shell prompt counts as stopped (red).
  it('maps shell to stopped', () => expect(mapStatus('shell')).toBe('stopped'));
});

describe('summarize', () => {
  it('counts each state', () => {
    const s: SessionState[] = [
      { sessionId: 'a', pid: 1, cwd: '/x', title: 'a', state: 'running' },
      { sessionId: 'b', pid: 2, cwd: '/x', title: 'b', state: 'running' },
      { sessionId: 'c', pid: 3, cwd: '/x', title: 'c', state: 'needsInput' },
      { sessionId: 'd', pid: 4, cwd: '/x', title: 'd', state: 'stopped' },
    ];
    expect(summarize(s)).toEqual({ running: 2, needsInput: 1, stopped: 1 });
  });
});
