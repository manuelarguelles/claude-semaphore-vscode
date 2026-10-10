import { describe, expect, it } from 'vitest';
import { presentSessions, defaultViewOptions } from '../src/sessionPresentation';
import { persistentSessionKey } from '../src/sessionIdentity';
import { mapStatus } from '../src/stateMapper';
import { styleFor } from '../src/theme';
import { SessionState } from '../src/types';

const row = (id: string, cwd = '/one/app', state: SessionState['state'] = 'running'): SessionState =>
  ({ provider: 'claude', sessionId: id, pid: 100, cwd, title: id, state });
describe('session organization', () => {
  it('keeps projects with equal basenames separate', () => {
    expect(presentSessions([row('a'), row('b', '/two/app')], defaultViewOptions(), new Set()).map(g => g.cwd))
      .toEqual(['/one/app', '/two/app']);
  });
  it('applies all filters before grouping and removes empty groups', () => {
    const a = { ...row('DataBricks'), state: 'needsInput' as const };
    const b = { ...row('databricks', '/two/app'), provider: 'codex' as const };
    const result = presentSessions([a, b], { ...defaultViewOptions(), query: 'DATA', provider: 'claude', state: 'needsInput', favoritesOnly: true }, new Set([persistentSessionKey(a)]));
    expect(result.map(g => g.sessions.map(s => s.sessionId))).toEqual([['DataBricks']]);
  });
  it('attention precedes favorite idle and favorites precede peers', () => {
    const a = row('idle', '/one/app', 'stopped');
    const b = row('waiting', '/one/app', 'needsInput');
    const c = row('z'); const d = row('a');
    expect(presentSessions([a, d, c, b], defaultViewOptions(), new Set([persistentSessionKey(a), persistentSessionKey(c)]))[0].sessions.map(s => s.sessionId))
      .toEqual(['waiting', 'z', 'a', 'idle']);
  });
  it('flat view searches provider and path and has deterministic identities', () => {
    const a = row('a'); const b = { ...row('a'), provider: 'codex' as const };
    expect(persistentSessionKey(a)).not.toBe(persistentSessionKey(b));
    const moved = { ...a, pid: 99 };
    expect(persistentSessionKey(a)).toBe(persistentSessionKey(moved));
    expect(presentSessions([a, b], { ...defaultViewOptions(), grouped: false, query: 'codex' }, new Set())[0].sessions).toEqual([b]);
    expect(presentSessions([a], { ...defaultViewOptions(), query: 'absent' }, new Set())).toEqual([]);
  });
  it('unknown data is unknown and idle never uses an error glyph', () => {
    expect(mapStatus('unrecognized')).toBe('unknown');
    expect(mapStatus('error')).toBe('error');
    expect(styleFor('classic', 'stopped').summaryGlyph).toBe('⚪');
    expect(styleFor('classic', 'error').summaryGlyph).toBe('🔴');
  });
});
