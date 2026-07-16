import { spawn } from 'child_process';
import { SoundPlayer } from './notifier';

/** macOS audio player. Fire-and-forget; failures are swallowed. */
export class AfplaySoundPlayer implements SoundPlayer {
  play(file: string): void {
    try {
      const child = spawn('afplay', [file], { stdio: 'ignore', detached: true });
      child.on('error', () => { /* afplay unavailable; ignore */ });
      child.unref();
    } catch {
      /* ignore */
    }
  }
}
