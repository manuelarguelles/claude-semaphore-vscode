import { describe, it, expect } from 'vitest';
import { formatTooltip } from '../src/tooltip';
import { SessionState } from '../src/types';

const base: SessionState = {
  sessionId: 's1',
  pid: 1,
  cwd: '/repo/one',
  title: 'One',
  state: 'running',
};

describe('formatTooltip', () => {
  it('shows title, cwd and label', () => {
    expect(formatTooltip(base, 'corriendo', true)).toBe('One\n/repo/one\ncorriendo');
  });

  it('notes when the session has no terminal in this window', () => {
    expect(formatTooltip(base, 'corriendo', false)).toBe(
      'One\n/repo/one\ncorriendo\n(sin terminal en esta ventana)',
    );
  });

  it('explains why a session needs input', () => {
    const waiting: SessionState = {
      ...base,
      state: 'needsInput',
      waitingFor: 'permission prompt',
    };
    expect(formatTooltip(waiting, 'necesita atención', true)).toBe(
      'One\n/repo/one\nnecesita atención — permission prompt',
    );
  });

  it('stays unchanged when the reason is missing', () => {
    const waiting: SessionState = { ...base, state: 'needsInput' };
    expect(formatTooltip(waiting, 'necesita atención', true)).toBe(
      'One\n/repo/one\nnecesita atención',
    );
  });

  it('ignores a reason on sessions that are not waiting', () => {
    const busy: SessionState = { ...base, state: 'running', waitingFor: 'stale reason' };
    expect(formatTooltip(busy, 'corriendo', true)).toBe('One\n/repo/one\ncorriendo');
  });
});
