import { execFile } from 'child_process';

export interface TerminalLike {
  readonly processId: Thenable<number | undefined>;
  readonly shellIntegration?: { cwd?: { fsPath: string } };
  show(preserveFocus?: boolean): void;
}

export interface LinkerDeps {
  getParentPid: (pid: number) => Promise<number | undefined>;
}

export class TerminalLinker {
  /** Ancestor chains are scoped to the live session so prune also drops wrappers. */
  private ancestorCache = new Map<number, number[]>();

  constructor(private deps: LinkerDeps) {}

  async resolve(
    session: { pid: number; cwd: string },
    terminals: readonly TerminalLike[],
  ): Promise<TerminalLike | undefined> {
    const terminalPids = await Promise.all(terminals.map(t => t.processId));
    const ancestors = this.ancestorCache.get(session.pid) ?? [];
    const seen = new Set([session.pid]);
    let current = session.pid;
    for (let depth = 0; depth < 12 && Number.isInteger(current) && current > 1; depth++) {
      const parent = ancestors[depth] ?? await this.deps.getParentPid(current);
      if (parent === undefined || !Number.isInteger(parent) || parent <= 1 || seen.has(parent)) {
        break;
      }
      ancestors[depth] = parent;
      this.ancestorCache.set(session.pid, ancestors);
      seen.add(parent);
      const terminalIndex = terminalPids.indexOf(parent);
      if (terminalIndex !== -1) { return terminals[terminalIndex]; }
      current = parent;
    }
    // Multiple agents commonly share a cwd. Never reveal an arbitrary terminal.
    const candidates = terminals.filter(t => {
      const cwd = t.shellIntegration?.cwd?.fsPath;
      return !!cwd && cwd === session.cwd;
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  /** Drop complete ancestor chains for sessions no longer alive. */
  prune(livePids: ReadonlySet<number>): void {
    for (const pid of this.ancestorCache.keys()) {
      if (!livePids.has(pid)) { this.ancestorCache.delete(pid); }
    }
  }
}

export function psParentPid(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (err, stdout) => {
      if (err) { return resolve(undefined); }
      const n = parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(n) ? n : undefined);
    });
  });
}
