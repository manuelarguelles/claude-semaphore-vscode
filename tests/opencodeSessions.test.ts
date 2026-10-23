import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { OpenCodeLogState, parseOpenCodeLsof, parseOpenCodePs, OpenCodeReader } from '../src/opencodeSessions';

const msg = (role: string, extra = {}) => ({ sessionID: 'ses_live', role, time: { created: 1000, ...extra } });
const part = (type: string, extra = {}) => ({ sessionID: 'ses_live', part: { type, time: { created: 1001 }, ...extra } });

describe('OpenCodeLogState', () => {
  it('stays unknown before a lifecycle event', () => {
    const s = new OpenCodeLogState();
    s.accept('message.part.updated.1', part('tool'));
    expect(s.state).toBe('unknown');
  });
  it('marks running on step-start and stopped on a completed assistant message', () => {
    const s = new OpenCodeLogState();
    s.accept('message.part.updated.1', part('step-start'));
    expect(s.state).toBe('running');
    expect(s.evidence?.reason).toBe('step-start');
    s.accept('message.updated.1', { info: { role: 'assistant', time: { created: 1000, completed: 2000 } } });
    expect(s.state).toBe('stopped');
    expect(s.evidence?.reason).toBe('message_completed');
  });
  it('keeps running through a continued assistant draft message', () => {
    const s = new OpenCodeLogState();
    s.accept('message.part.updated.1', part('step-start'));
    s.accept('message.updated.1', { info: { role: 'assistant', time: { created: 1002 } } });
    expect(s.state).toBe('running');
  });
});

describe('OpenCode discovery parsing', () => {
  it('extracts cwd and database usage from lsof output', () => {
    const text = 'p42\nfcwd\na \nn/Users/work\nftxt\na \nn/Users/macdenix/.local/share/opencode/opencode.db-shm\np99\nfcwd\na \nn/elsewhere\n';
    const parsed = parseOpenCodeLsof(text);
    expect(parsed.get(42)).toEqual({ cwd: '/Users/work', usesDb: true });
    expect(parsed.get(99)).toEqual({ cwd: '/elsewhere', usesDb: false });
  });
  it('extracts the -s argument and ignores other executables', () => {
    const text = '  42 /opt/homebrew/bin/opencode -s ses_abcdefAaaafffeatt\n99 other -s ses_x\n7 opencode\n';
    const parsed = parseOpenCodePs(text);
    expect(parsed.get(42)).toBe('ses_abcdefAaaafffeatt');
    expect(parsed.get(7)).toBeUndefined();
    expect(parsed.has(99)).toBe(false);
  });
});

describe('OpenCodeReader', () => {
  let dir: string;
  let dbPath: string;
  const sqlite = (sql: string): string => execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  const lit = (o: unknown): string => `'${JSON.stringify(o).replace(/'/g, "''")}'`;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-db-'));
    dbPath = path.join(dir, 'opencode.db');
    execFileSync('sqlite3', [dbPath, `CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL, directory text NOT NULL, title text NOT NULL, version text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, time_archived integer);
      CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
      CREATE TABLE event (rowid integer PRIMARY KEY, id text, aggregate_id text, seq integer NOT NULL, type text NOT NULL, data text NOT NULL);`]);
    sqlite(`INSERT INTO session (id, project_id, directory, title, slug, version, time_created, time_updated) VALUES
      ('ses_live', 'p', '/work/project', 'Diseño semáforo', 's1', '1.0', 1000, ${Date.now()}),
      ('ses_old', 'p', '/work/project', 'Vieja', 's2', '1.0', 100, 200),
      ('ses_arg', 'q', '/other/arg', 'Adjunta', 's3', '1.0', 100, 200);
      INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m1', 'ses_live', 1000, 1000, ${lit(msg('user'))}), ('m2', 'ses_live', 1100, 1100, ${lit(msg('assistant', { completed: 1200 }))});
      INSERT INTO event (seq, type, data) VALUES (1, 'message.part.updated.1', ${lit(part('step-start'))});`);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('shows live cwd sessions and derives state from the event tail', async () => {
    const reader = new OpenCodeReader(dbPath);
    const sessions = await reader.read([{ pid: 42, cwd: '/work/project' }]);
    expect(sessions).toMatchObject([{ provider: 'opencode', sessionId: 'ses_live', pid: 42, cwd: '/work/project' }]);
    expect(sessions[0].title).toBe('project · Diseño semáforo');
    expect(sessions[0].state).toBe('stopped'); // bootstrap: última respuesta del asistente completada
  });
  it('attributes argv sessions to their own pid even outside the activity window', async () => {
    const reader = new OpenCodeReader(dbPath);
    const sessions = await reader.read([{ pid: 7, cwd: '/work/project', argSession: 'ses_arg' }]);
    expect(sessions).toMatchObject([{ sessionId: 'ses_arg', pid: 7, state: 'unknown' }]);
  });
  it('advances state from appended events across polls', async () => {
    const reader = new OpenCodeReader(dbPath);
    const processes = [{ pid: 42, cwd: '/work/project' }];
    expect((await reader.read(processes))[0]?.state).toBe('stopped'); // bootstrap + historial ignorado
    sqlite(`INSERT INTO event (seq, type, data) VALUES (2, 'message.part.updated.1', ${lit({ sessionID: 'ses_live', part: { type: 'step-start', time: { created: 3000 } } })});`);
    expect((await reader.read(processes))[0]?.state).toBe('running');
    sqlite(`INSERT INTO event (seq, type, data) VALUES (3, 'message.updated.1', ${lit({ sessionID: 'ses_live', info: { role: 'assistant', time: { created: 2500, completed: 3000 } } })});`);
    expect((await reader.read(processes))[0]?.state).toBe('stopped');
  });
  it('keeps sessions without observing other sessions\' events cross-talk', async () => {
    const reader = new OpenCodeReader(dbPath);
    sqlite(`INSERT INTO event (seq, type, data) VALUES (3, 'message.part.updated.1', ${lit({ ...part('step-start'), sessionID: 'ses_untouched' })});`);
    const sessions = await reader.read([{ pid: 42, cwd: '/work/project' }]);
    expect(sessions.map(s => s.sessionId)).toEqual(['ses_live']);
  });
});
