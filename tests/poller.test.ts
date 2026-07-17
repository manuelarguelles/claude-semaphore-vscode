import { describe, it, expect } from 'vitest';
import { Poller } from '../src/poller';

function fakes(intervalMs: number) {
  const armed: number[] = [];
  const cleared: number[] = [];
  let handle = 0;
  let interval = intervalMs;
  const poller = new Poller({
    getIntervalMs: () => interval,
    setInterval: (_fn, ms) => { armed.push(ms); return ++handle as unknown as NodeJS.Timeout; },
    clearInterval: (h) => { cleared.push(h as unknown as number); },
    tick: () => {},
  });
  return { poller, armed, cleared, setInterval: (ms: number) => { interval = ms; } };
}

describe('Poller', () => {
  it('arms the timer with the configured interval', () => {
    const f = fakes(2000);
    f.poller.start();
    expect(f.armed).toEqual([2000]);
  });

  it('rearms with the new interval when the setting changes', () => {
    const f = fakes(2000);
    f.poller.start();
    f.setInterval(60000);
    f.poller.reconfigure();
    expect(f.armed).toEqual([2000, 60000]);
    expect(f.cleared).toEqual([1]);
  });

  it('leaves the timer alone when the interval did not change', () => {
    const f = fakes(2000);
    f.poller.start();
    f.poller.reconfigure();
    expect(f.armed).toEqual([2000]);
    expect(f.cleared).toEqual([]);
  });

  it('clamps intervals that would hammer the disk', () => {
    const f = fakes(10);
    f.poller.start();
    expect(f.armed).toEqual([500]);
  });

  it('stops the timer when disposed', () => {
    const f = fakes(2000);
    f.poller.start();
    f.poller.dispose();
    expect(f.cleared).toEqual([1]);
  });
});
