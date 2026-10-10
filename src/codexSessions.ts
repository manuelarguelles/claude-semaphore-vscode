import { promises as fs } from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { SessionState, SemaphoreState } from './types';

export interface OpenRollout { pid: number; file: string }
/** Only inspect actual top-level events, never prompt/tool-output text. */
export class CodexLogState {
  state: SemaphoreState = 'unknown';
  evidence: SessionState['evidence'];
  private turnId: string | undefined;
  private questions = new Set<string>();
  get waitingFor(): string | undefined {
    return this.questions.size ? 'Codex: pregunta explícita pendiente' : undefined;
  }
  accept(row: unknown): void {
    if (!row || typeof row !== 'object') return;
    const r = row as any;
    const p = r.payload;
    if (!p || typeof p !== 'object') return;
    if (r.type === 'event_msg') {
      if (p.type === 'task_started') {
        this.turnId = p.turn_id; this.questions.clear(); this.state = 'running';
        this.mark(p.type, r.timestamp);
      } else if (['task_complete', 'turn_aborted'].includes(p.type)) {
        if (this.turnId && p.turn_id && this.turnId !== p.turn_id) return;
        this.questions.clear(); this.state = 'stopped';
        this.mark(p.type, r.timestamp);
      }
    } else if (r.type === 'response_item') {
      if (['function_call', 'custom_tool_call'].includes(p.type)) {
        if (typeof p.name === 'string' && /(^|\.)request_user_input$/.test(p.name) && typeof p.call_id === 'string') {
          this.questions.add(p.call_id);
        }
        this.state = this.questions.size ? 'needsInput' : 'running';
        this.mark(p.type, r.timestamp);
      } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
        if (this.questions.delete(p.call_id)) { this.state = this.questions.size ? 'needsInput' : 'running'; this.mark(p.type, r.timestamp); }
      } else if (p.type === 'reasoning' && this.state === 'unknown') {
        this.state = 'running';
        this.mark(p.type, r.timestamp);
      }
    }
  }
  private mark(reason: string, timestamp: unknown): void {
    const at = typeof timestamp === 'string' ? Date.parse(timestamp) : undefined;
    this.evidence = { source: 'codex-rollout', reason, at: at !== undefined && Number.isFinite(at) ? at : undefined, turnId: this.turnId };
  }
}

export function parseOpenRollouts(text: string): OpenRollout[] {
  let pid = 0;
  let writable = false;
  const files = new Map<string, OpenRollout>();
  for (const line of text.split('\n')) {
    if (/^p\d+$/.test(line)) { pid = Number(line.slice(1)); writable = false; }
    if (line.startsWith('f')) writable = false;
    if (line.startsWith('a')) writable = line === 'aw' || line === 'au';
    if (pid > 0 && writable && line.startsWith('n/')) {
      const file = line.slice(1);
      if (file.includes('/sessions/') && /^rollout-.*\.jsonl$/.test(path.basename(file))) {
        files.set(`${pid}:${file}`, { pid, file });
      }
    }
  }
  return [...files.values()];
}

export function discoverCodexRollouts(): Promise<OpenRollout[]> {
  return new Promise((resolve, reject) => {
    execFile('lsof', ['-n', '-P', '-a', '-c', 'codex', '-F', 'pfan'], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // lsof exits 1 with no output when there are no matching processes.
      if (err && !(err.code === 1 && !stdout.trim() && !stderr.trim())) return reject(err);
      resolve(parseOpenRollouts(stdout));
    });
  });
}

const MAX_READ = 1024 * 1024;
interface Cache {
  offset: number; inode: number; pending: Buffer; log: CodexLogState;
  metadata?: { id: string; cwd: string; source: unknown; originator: unknown; threadSource: unknown };
}
/** Bounded asynchronous reads: 1 MiB at bootstrap/gaps, then only appended bytes. */
export class CodexReader {
  private cache = new Map<string, Cache>();
  async read(open: OpenRollout): Promise<SessionState | undefined> {
    const key = `${open.pid}:${open.file}`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(open.file, 'r');
      const stat = await handle.stat();
      let c = this.cache.get(key);
      if (!c || c.inode !== stat.ino || stat.size < c.offset) {
        c = { offset: 0, inode: stat.ino, pending: Buffer.alloc(0), log: new CodexLogState() };
        this.cache.set(key, c);
      }
      if (!c.metadata) {
        const head = Buffer.alloc(Math.min(MAX_READ, stat.size));
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        const end = head.subarray(0, bytesRead).indexOf(10);
        if (end < 0) return undefined;
        const row = JSON.parse(head.subarray(0, end).toString('utf8'));
        const p = row.payload;
        if (row.type !== 'session_meta' || typeof p?.id !== 'string' || typeof p?.cwd !== 'string') return undefined;
        c.metadata = { id: p.id, cwd: p.cwd, source: p.source, originator: p.originator, threadSource: p.thread_source };
      }
      // Recent TUI sessions can be owned by app-server and marked "vscode".
      // Keep other IDE/gateway origins and explicitly non-user threads excluded.
      const meta = c.metadata;
      if (meta.threadSource !== undefined && meta.threadSource !== 'user') return undefined;
      if (meta.source !== 'cli' && !(meta.source === 'vscode' && meta.originator === 'codex-tui')) return undefined;
      let start = c.offset;
      let skipFirst = false;
      if (stat.size - start > MAX_READ) {
        start = stat.size - MAX_READ; skipFirst = true;
        c.pending = Buffer.alloc(0); c.log = new CodexLogState();
      }
      const data = Buffer.alloc(Math.min(MAX_READ, stat.size - start));
      const { bytesRead } = await handle.read(data, 0, data.length, start);
      let bytes = Buffer.concat([c.pending, data.subarray(0, bytesRead)]);
      c.offset = start + bytesRead;
      if (skipFirst) {
        const newline = bytes.indexOf(10);
        bytes = newline >= 0 ? bytes.subarray(newline + 1) : Buffer.alloc(0);
      }
      const last = bytes.lastIndexOf(10);
      if (last >= 0) {
        for (const line of bytes.subarray(0, last).toString('utf8').split('\n')) {
          try { c.log.accept(JSON.parse(line)); } catch { /* incomplete/malformed row */ }
        }
        c.pending = Buffer.from(bytes.subarray(last + 1));
      } else c.pending = bytes;
      if (c.pending.length > MAX_READ) { c.pending = Buffer.alloc(0); c.log = new CodexLogState(); }
      return {
        provider: 'codex', sessionId: c.metadata.id, pid: open.pid, cwd: c.metadata.cwd,
        title: `${path.basename(c.metadata.cwd) || 'Codex'} · ${c.metadata.id.slice(-8)}`,
        state: c.log.state, waitingFor: c.log.waitingFor, evidence: c.log.evidence,
      };
    } catch {
      this.cache.delete(key);
      return undefined;
    } finally { await handle?.close(); }
  }
  prune(open: OpenRollout[]): void {
    const keep = new Set(open.map(o => `${o.pid}:${o.file}`));
    for (const key of this.cache.keys()) if (!keep.has(key)) this.cache.delete(key);
  }
}
