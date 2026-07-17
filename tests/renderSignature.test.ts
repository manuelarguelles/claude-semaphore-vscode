import { describe, it, expect } from 'vitest';
import { renderSignature } from '../src/renderSignature';
import { SessionState } from '../src/types';

const s1: SessionState = {
  sessionId: 's1',
  pid: 1,
  cwd: '/repo/one',
  title: 'One',
  state: 'running',
};

const sig = (sessions: SessionState[], terminals: number[] = [], theme = 'classic') =>
  renderSignature(sessions, new Set(terminals), theme);

describe('renderSignature', () => {
  it('is stable when nothing the row shows has changed', () => {
    const a = sig([{ ...s1 }]);
    const b = sig([{ ...s1 }]);
    expect(a).toBe(b);
  });

  it('changes when the semaphore state changes', () => {
    expect(sig([s1])).not.toBe(sig([{ ...s1, state: 'needsInput' }]));
  });

  it('changes when the waiting reason changes', () => {
    const waiting: SessionState = { ...s1, state: 'needsInput' };
    expect(sig([waiting])).not.toBe(sig([{ ...waiting, waitingFor: 'permission prompt' }]));
  });

  it('changes when the title changes', () => {
    expect(sig([s1])).not.toBe(sig([{ ...s1, title: 'Other' }]));
  });

  it('changes when a session gains or loses its terminal', () => {
    expect(sig([s1], [])).not.toBe(sig([s1], [1]));
  });

  it('changes when the duplicate-title flag flips', () => {
    expect(sig([s1])).not.toBe(sig([{ ...s1, duplicateTitle: true }]));
  });

  it('changes when the theme changes', () => {
    expect(sig([s1], [], 'classic')).not.toBe(sig([s1], [], 'colorblind'));
  });

  it('changes when a session appears or disappears', () => {
    const s2: SessionState = { ...s1, sessionId: 's2', pid: 2, title: 'Two' };
    expect(sig([s1])).not.toBe(sig([s1, s2]));
  });

  it('ignores fields the row never renders', () => {
    expect(sig([s1])).toBe(sig([{ ...s1, sessionId: 'different-id' }]));
  });

  it('tells apart rows whose fields would run together', () => {
    const a: SessionState = { ...s1, title: 'One', cwd: '/repo/one' };
    const b: SessionState = { ...s1, title: 'One/repo', cwd: '/one' };
    expect(sig([a])).not.toBe(sig([b]));
  });
});
