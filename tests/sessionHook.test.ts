import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'semaphore-hook-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const run = (input: unknown, dest = directory) => spawnSync(process.execPath, ['scripts/session-hook.cjs', 'codex', dest], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 3000 });
const raw = { session_id: 'abc', cwd: '/work', hook_event_name: 'PermissionRequest', turn_id: 'one', tool_input: { secret: 'SECRET' } };
describe('real hook receiver', () => {
  it('writes only sanitized metadata with no output or permission decision', () => {
    const result = run(raw); expect(result.status).toBe(0); expect(result.stdout).toBe(''); expect(result.stderr).toBe('');
    const files = fs.readdirSync(directory); expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(directory, files[0]), 'utf8');
    expect(content).not.toMatch(/SECRET|tool_input|decision|continue/);
    expect(JSON.parse(content)).toMatchObject({ provider: 'codex', sessionId: 'abc', event: 'PermissionRequest' });
  });
  it('tolerates malformed, oversized, traversal and unwritable input without blocking', () => {
    for (const input of ['{', 'x'.repeat(65537), { ...raw, session_id: '../evil' }, { ...raw, agent_id: 'child' }]) {
      expect(run(input).status).toBe(0);
    }
    expect(fs.readdirSync(directory)).toEqual([]);
    const file = path.join(directory, 'not-a-directory'); fs.writeFileSync(file, 'preserve');
    expect(run(raw, file).status).toBe(0); expect(fs.readFileSync(file, 'utf8')).toBe('preserve');
  });
});

import { createHash } from 'crypto';
import { vi } from 'vitest';
it('concurrent receivers never restore an older permission event', async () => {
  const preload = path.join(directory, 'pause.cjs'); const ready = path.join(directory, 'ready'); const release = path.join(directory, 'release');
  fs.writeFileSync(preload, `const fs=require('fs'); const rename=fs.renameSync; fs.renameSync=(a,b)=>{ fs.writeFileSync(${JSON.stringify(ready)},''); const until=Date.now()+2000; while(!fs.existsSync(${JSON.stringify(release)}) && Date.now()<until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5); return rename(a,b); };`);
  const launch = (event: string, pause = false) => {
    const child = spawn(process.execPath, [...(pause ? ['--require', preload] : []), 'scripts/session-hook.cjs', 'codex', directory]);
    child.stdin.end(JSON.stringify({ ...raw, hook_event_name: event }));
    return new Promise<number | null>(resolve => child.on('exit', resolve));
  };
  const first = launch('PermissionRequest', true);
  await vi.waitFor(() => expect(fs.existsSync(ready)).toBe(true));
  const second = launch('PostToolUse');
  await new Promise(resolve => setTimeout(resolve, 200)); fs.writeFileSync(release, '');
  expect(await first).toBe(0); expect(await second).toBe(0);
  const key = createHash('sha256').update(JSON.stringify(['codex', 'abc'])).digest('hex');
  expect(JSON.parse(fs.readFileSync(path.join(directory, key + '.json'), 'utf8')).event).toBe('PostToolUse');
});
it('bounds retained telemetry and preserves foreign files', () => {
  const old = new Date(Date.now() - 31 * 86400000);
  for (let i = 0; i < 1001; i++) {
    const name = createHash('sha256').update(`old-${i}`).digest('hex') + '.json'; const file = path.join(directory, name);
    fs.writeFileSync(file, '{}'); fs.utimesSync(file, old, old);
  }
  fs.writeFileSync(path.join(directory, 'foreign.txt'), 'preserve'); expect(run(raw).status).toBe(0);
  expect(fs.readdirSync(directory).filter(n => /^[a-f0-9]{64}\.json$/.test(n))).toHaveLength(1);
  expect(fs.readFileSync(path.join(directory, 'foreign.txt'), 'utf8')).toBe('preserve');
});
