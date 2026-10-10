import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
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
