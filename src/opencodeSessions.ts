import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { SessionState, SemaphoreState } from './types';

export interface OpenCodeProcess { pid: number; cwd: string; argSession?: string }

/** Parses `lsof -nP -a -c opencode -F pfan` output into live opencode processes. */
export function parseOpenCodeLsof(text: string): Map<number, { cwd?: string; usesDb: boolean }> {
  const processes = new Map<number, { cwd?: string; usesDb: boolean }>();
  let pid = 0;
  let pendingCwd = false;
  for (const line of text.split('\n')) {
    if (/^p\d+$/.test(line)) {
      pid = Number(line.slice(1));
      processes.set(pid, { usesDb: false });
      pendingCwd = false;
      continue;
    }
    const p = processes.get(pid);
    if (!p) continue;
    if (line === 'fcwd') { pendingCwd = true; continue; }
    if (!line.startsWith('n')) continue;
    const name = line.slice(1);
    if (pendingCwd) { p.cwd = name; pendingCwd = false; }
    if (name.includes('/.local/share/opencode/opencode.db')) p.usesDb = true;
  }
  return processes;
}

/** Maps live pids to their `opencode` entry point and the `-s/--session` argument, when present. */
export function parseOpenCodePs(text: string): Map<number, string | undefined> {
  const out = new Map<number, string | undefined>();
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const command = m[2];
    if (command.split(' ')[0]?.split('/').pop() !== 'opencode') continue;
    const match = /(?:^|\s)(?:-s|--session)(?:=|\s+)(ses_[A-Za-z0-9]+)/.exec(command);
    out.set(Number(m[1]), match?.[1]);
  }
  return out;
}

export function discoverOpenCodeProcesses(): Promise<OpenCodeProcess[]> {
  const lsof = new Promise<Map<number, { cwd?: string; usesDb: boolean }>>((resolve, reject) => {
    execFile('lsof', ['-n', '-P', '-a', '-c', 'opencode', '-F', 'pfan'], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !(err.code === 1 && !stdout.trim() && !stderr.trim())) return reject(err);
      resolve(parseOpenCodeLsof(stdout));
    });
  });
  const ps = new Promise<Map<number, string | undefined>>((resolve, reject) => {
    execFile('ps', ['ax', '-o', 'pid=,command='], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(parseOpenCodePs(stdout));
    });
  });
  return Promise.all([lsof, ps]).then(([files, commands]) => {
    const out: OpenCodeProcess[] = [];
    for (const [pid, info] of files) {
      const cwd = info.cwd;
      if (!info.usesDb || !cwd) continue;
      const argSession = commands.get(pid);
      if (argSession === undefined && !commands.has(pid)) continue;
      out.push({ pid, cwd, argSession });
    }
    return out.sort((a, b) => a.pid - b.pid);
  });
}

const numeric = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** Lifecycle state from opencode's event log. Unknown until the DB itself proves a state. */
export class OpenCodeLogState {
  state: SemaphoreState = 'unknown';
  evidence: SessionState['evidence'];
  accept(type: string, payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as any;
    if (type === 'message.part.updated.1' && p.part?.type === 'step-start') {
      this.state = 'running';
      this.evidence = { source: 'opencode-db', reason: 'step-start', at: numeric(p.part.time?.created) };
    } else if (type === 'message.updated.1' && p.info?.role === 'assistant' && typeof p.info.time?.completed === 'number') {
      this.state = 'stopped';
      this.evidence = { source: 'opencode-db', reason: 'message_completed', at: numeric(p.info.time.completed) };
    }
  }
}

interface SessionRow { id: string; directory: string; title: string }
interface EventRow { rowid: number; type: string; data: string }

export const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 100;
/** Uses the global opencode SQLite database; subprocess-only, no native deps. */
export class OpenCodeReader {
  private cache = new Map<string, OpenCodeLogState>();
  private maxRowid = 0;
  constructor(private readonly dbPath: string = path.join(os.homedir(), '.local/share/opencode/opencode.db'), private readonly maxRows = 5000) {}

  private query(sql: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      execFile('sqlite3', ['-readonly', '-json', this.dbPath, sql], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        const text = stdout.trim();
        try { resolve(text ? JSON.parse(text) : []); } catch (e) { reject(e); }
      });
    });
  }

  async read(processes: OpenCodeProcess[], windowMs = DEFAULT_WINDOW_MS, now = Date.now()): Promise<SessionState[]> {
    let resolved: { id: string; directory: string; title: string; pid: number }[];
    try { resolved = await this.resolve(processes, windowMs, now); }
    catch (e) { this.cache.clear(); this.maxRowid = 0; throw e; }
    if (!resolved.length) { this.cache.clear(); this.maxRowid = 0; return []; }
    resolved = resolved.slice(0, MAX_SESSIONS);
    const ids = resolved.map(s => s.id); const idSet = new Set(ids);
    await this.bootstrap(ids);
    await this.advanceEvents(idSet);
    for (const key of [...this.cache.keys()]) if (!idSet.has(key)) this.cache.delete(key);
    const out: SessionState[] = [];
    for (const s of resolved) {
      const log = this.cache.get(s.id) ?? new OpenCodeLogState();
      out.push({
        provider: 'opencode', sessionId: s.id, pid: s.pid, cwd: s.directory,
        title: `${path.basename(s.directory) || 'OpenCode'} · ${(s.title || s.id.slice(-8)).slice(0, 80)}`,
        state: log.state, waitingFor: undefined, evidence: log.evidence,
      });
    }
    return out;
  }

  private async resolve(processes: OpenCodeProcess[], windowMs: number, now: number) {
    const byArg = new Map<string, OpenCodeProcess>();
    const dirs = new Set<string>();
    for (const p of processes) {
      if (p.argSession) byArg.set(p.argSession, p);
      dirs.add(p.cwd);
    }
    const resolved = new Map<string, { directory: string; title: string; pid: number }>();
    const argvIds = [...byArg.keys()];
    if (argvIds.length) {
      const rows = await this.query(`SELECT id, directory, title FROM session WHERE parent_id IS NULL AND time_archived IS NULL AND id IN (${sqlList(argvIds)});`) as SessionRow[];
      for (const r of rows) resolved.set(r.id, { directory: r.directory, title: r.title, pid: byArg.get(r.id)!.pid });
    }
    if (dirs.size) {
      const rows = await this.query(`SELECT id, directory, title FROM session WHERE parent_id IS NULL AND time_archived IS NULL AND time_updated > ${Math.floor(now - windowMs)} AND directory IN (${sqlList([...dirs])}) ORDER BY time_updated DESC;`) as SessionRow[];
      for (const r of rows) {
        if (resolved.has(r.id)) continue;
        const pid = liveRepPids(processes, r.directory)[0];
        if (pid === undefined) continue;
        resolved.set(r.id, { directory: r.directory, title: r.title, pid });
      }
    }
    return [...resolved].map(([id, e]) => ({ id, directory: e.directory, title: e.title, pid: e.pid }));
  }

  /** Bootstrap state for unseen sessions: the latest message alone (never invents states). */
  private async bootstrap(ids: string[]): Promise<void> {
    const missing = ids.filter(id => !this.cache.has(id));
    if (!missing.length) return;
    const rows = await this.query(`SELECT session_id, data FROM message WHERE session_id IN (${sqlList(missing)}) ORDER BY time_created DESC LIMIT 400;`) as { session_id: string; data: string }[];
    const latest = new Map<string, unknown>();
    for (const r of rows) if (!latest.has(r.session_id)) latest.set(r.session_id, safeParse(r.data));
    for (const id of missing) {
      const log = new OpenCodeLogState();
      const msg = latest.get(id) as any;
      if (msg?.role === 'assistant' && typeof msg?.time?.completed === 'number') {
        log.state = 'stopped';
        log.evidence = { source: 'opencode-db', reason: 'message_completed', at: numeric(msg.time.completed) };
      }
      this.cache.set(id, log);
    }
  }

  /** Incremental event tail since the last observed rowid, bounded per tick. */
  private async advanceEvents(idSet: ReadonlySet<string>): Promise<void> {
    if (this.maxRowid === 0) {
      // Arrancar en el final de la tabla: el historial previo no es señal de actividad actual.
      const head = await this.query('SELECT IFNULL(MAX(rowid), 0) AS max FROM event;') as { max: number }[];
      this.maxRowid = head[0]?.max ?? 0;
      return;
    }
    const events = await this.query(`SELECT rowid, type, data FROM event WHERE rowid > ${this.maxRowid} LIMIT ${this.maxRows};`) as EventRow[];
    for (const e of events) {
      if (e.rowid > this.maxRowid) this.maxRowid = e.rowid;
      const data = safeParse(e.data);
      const id = data?.sessionID;
      const log = typeof id === 'string' && idSet.has(id) ? this.cache.get(id) : undefined;
      if (!log) continue;
      log.accept(e.type, data);
    }
  }
}

/** Live opencode pids for a working directory; the lowest pid represents an unattributed session. */
function liveRepPids(processes: OpenCodeProcess[], directory: string): number[] {
  return processes.filter(p => p.cwd === directory && !p.argSession).map(p => p.pid).sort((a, b) => a - b);
}

const sqlList = (values: string[]): string => values.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
const safeParse = (text: string): any => { try { return JSON.parse(text); } catch { return undefined; } };
