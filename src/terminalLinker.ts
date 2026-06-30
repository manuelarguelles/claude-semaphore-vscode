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
  /** claudePid -> ppid (estable durante la vida del proceso). */
  private ppidCache = new Map<number, number>();

  constructor(private deps: LinkerDeps) {}

  async resolve(
    session: { pid: number; cwd: string },
    terminals: readonly TerminalLike[],
  ): Promise<TerminalLike | undefined> {
    let ppid = this.ppidCache.get(session.pid);
    if (ppid === undefined) {
      const looked = await this.deps.getParentPid(session.pid);
      if (looked !== undefined) {
        ppid = looked;
        this.ppidCache.set(session.pid, looked);
      }
    }
    if (ppid !== undefined) {
      for (const t of terminals) {
        if ((await t.processId) === ppid) { return t; }
      }
    }
    // Fallback: cwd.
    for (const t of terminals) {
      const tcwd = t.shellIntegration?.cwd?.fsPath;
      if (tcwd && tcwd === session.cwd) { return t; }
    }
    return undefined;
  }

  /** Limpia el cache de pids que ya no están en la lista de sesiones vigentes. */
  prune(livePids: ReadonlySet<number>): void {
    for (const pid of this.ppidCache.keys()) {
      if (!livePids.has(pid)) { this.ppidCache.delete(pid); }
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
