import { describe, it, expect } from 'vitest';
import { SessionJournal, observedDurations } from '../src/sessionJournal';
import { SessionState } from '../src/types';
const session: SessionState = { provider: 'codex', sessionId: 'one', pid: 1, cwd: '/work/app', title: 'App', state: 'running' };
describe('local session journal', () => {
  it('deduplicates ticks and PID changes but records transitions and disappearance', () => {
    let now = 1000; const journal = new SessionJournal(undefined, () => now);
    expect(journal.observe([session])).toBe(true);
    now = 2000; expect(journal.observe([{ ...session, pid: 2 }])).toBe(false);
    expect(journal.recent()[0].events).toHaveLength(1);
    now = 3000; journal.observe([{ ...session, state: 'needsInput' }]);
    now = 4000; journal.observe([]); now = 5000; expect(journal.observe([])).toBe(false);
    expect(journal.recent()[0].events.map(e => e.state)).toEqual(['running', 'needsInput', 'offline']);
    expect(observedDurations(journal.recent()[0])).toMatchObject({ running: 2000, needsInput: 1000 });
    const reloaded = new SessionJournal(journal.snapshot(), () => now);
    expect(observedDurations(reloaded.recent()[0]).needsInput).toBe(1000);
  });
  it('cuts observation at the saved heartbeat on reload, without counting offline time', () => {
    let now = 1000; const journal = new SessionJournal(null, () => now);
    journal.observe([session]); now = 2000; journal.observe([session]);
    now = 20000; const reloaded = new SessionJournal(journal.snapshot(), () => now);
    expect(reloaded.recent()[0].active).toBe(false);
    reloaded.observe([session]); now = 21000; reloaded.observe([session]);
    expect(observedDurations(reloaded.recent()[0]).running).toBe(2000);
  });
  it('rejects malformed journals and copies only allowed metadata', () => {
    expect(new SessionJournal({ version: 42, sessions: [] }, () => 1000).recent()).toEqual([]);
    const journal = new SessionJournal(null, () => 1000);
    journal.observe([{ ...session, prompt: 'SECRET', toolOutput: 'PRIVATE' } as any]);
    expect(JSON.stringify(journal.snapshot())).not.toMatch(/SECRET|PRIVATE|prompt|toolOutput/);
    const saved = journal.snapshot(); saved.sessions[0].title = 'mutated';
    expect(journal.recent()[0].title).toBe('App');
    journal.clear(); expect(journal.recent()).toEqual([]);
  });
  it('caps events and sessions and expires entries after 30 days', () => {
    let now = 1000; const journal = new SessionJournal(null, () => now);
    for (let i = 0; i < 205; i++) { now++; journal.observe([{ ...session, state: i % 2 ? 'running' : 'stopped' }]); }
    expect(journal.recent()[0].events).toHaveLength(200);
    journal.observe(Array.from({ length: 1005 }, (_, i) => ({ ...session, sessionId: `s${i}` })));
    expect(journal.recent()).toHaveLength(1000);
    now += 31 * 86400000; journal.observe([]); expect(journal.recent()).toEqual([]);
  });
});
