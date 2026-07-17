/** Below this the poll would hammer the disk for no benefit. */
const MIN_INTERVAL_MS = 500;

export interface PollerDeps {
  getIntervalMs: () => number;
  setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (h: NodeJS.Timeout) => void;
  tick: () => void;
}

/**
 * The fallback poll, rearmable at runtime.
 *
 * Reading the interval once at activation left the setting inert until the
 * window was reloaded, so changing it appeared to do nothing.
 */
export class Poller {
  private handle: NodeJS.Timeout | undefined;
  private armedMs: number | undefined;

  constructor(private deps: PollerDeps) {}

  start(): void {
    this.arm();
  }

  /** Call when configuration changed; rearms only if the interval really moved. */
  reconfigure(): void {
    if (this.resolveMs() === this.armedMs) { return; }
    this.arm();
  }

  dispose(): void {
    if (this.handle === undefined) { return; }
    this.deps.clearInterval(this.handle);
    this.handle = undefined;
    this.armedMs = undefined;
  }

  private arm(): void {
    const ms = this.resolveMs();
    if (this.handle !== undefined) { this.deps.clearInterval(this.handle); }
    this.handle = this.deps.setInterval(() => this.deps.tick(), ms);
    this.armedMs = ms;
  }

  private resolveMs(): number {
    return Math.max(MIN_INTERVAL_MS, this.deps.getIntervalMs());
  }
}
