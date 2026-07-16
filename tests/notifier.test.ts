import { describe, it, expect, beforeEach } from 'vitest';
import { Notifier, SoundPlayer } from '../src/notifier';
import { SessionState, SemaphoreState } from '../src/types';

function sess(id: string, state: SemaphoreState): SessionState {
  return { sessionId: id, pid: 1, cwd: '/x', title: id, state };
}

class FakePlayer implements SoundPlayer {
  public plays = 0;
  play(): void { this.plays++; }
}

describe('Notifier', () => {
  let player: FakePlayer;
  let focused: boolean;
  let enabled: boolean;
  let n: Notifier;

  beforeEach(() => {
    player = new FakePlayer();
    focused = false;
    enabled = true;
    n = new Notifier({
      player,
      isWindowFocused: () => focused,
      isEnabled: () => enabled,
      soundFile: () => '/honk.aiff',
    });
  });

  it('does not honk on the initial baseline scan', () => {
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(0);
  });

  it('honks on a transition into needsInput', () => {
    n.update([sess('a', 'running')]);      // baseline
    n.update([sess('a', 'needsInput')]);   // transition
    expect(player.plays).toBe(1);
  });

  it('does not re-honk while staying needsInput', () => {
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(1);
  });

  it('honks again after leaving and re-entering needsInput', () => {
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(2);
  });

  it('does not honk when the window is focused', () => {
    focused = true;
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(0);
  });

  it('does not honk when sound is disabled', () => {
    enabled = false;
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(0);
  });
});
