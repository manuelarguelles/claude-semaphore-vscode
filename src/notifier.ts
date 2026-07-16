import { SemaphoreState, SessionState } from './types';

export interface SoundPlayer {
  play(file: string): void;
}

export interface NotifierDeps {
  player: SoundPlayer;
  isWindowFocused: () => boolean;
  isEnabled: () => boolean;
  soundFile: () => string;
}

export class Notifier {
  private prev = new Map<string, SemaphoreState>();
  private baselineSet = false;

  constructor(private deps: NotifierDeps) {}

  update(sessions: SessionState[]): void {
    const current = new Map<string, SemaphoreState>(
      sessions.map((s) => [s.sessionId, s.state]),
    );
    if (this.baselineSet) {
      for (const [id, state] of current) {
        if (state === 'needsInput' && this.prev.get(id) !== 'needsInput') {
          this.maybeHonk();
        }
      }
    }
    this.prev = current;
    this.baselineSet = true;
  }

  private maybeHonk(): void {
    if (!this.deps.isEnabled()) { return; }
    if (this.deps.isWindowFocused()) { return; }
    this.deps.player.play(this.deps.soundFile());
  }
}
