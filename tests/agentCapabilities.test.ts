import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { inspectAgent } from '../src/agentCapabilities';
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cap-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
describe('CLI capabilities', () => {
  it('inspects real executable help/version without running a prompt', async () => {
    const file = path.join(dir, 'fake codex');
    fs.writeFileSync(file, `#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]==='--help')console.log('resume fork --worktree');else if(a[0]==='--version')console.log('codex-cli 0.160.0');else if(a.join(' ')==='features list')console.log('hooks stable true');else process.exit(9);\n`); fs.chmodSync(file, 0o755);
    expect(await inspectAgent('codex', file)).toMatchObject({ executable: file, start: true, resume: true, fork: true, hooks: true, worktree: true });
  });
  it('reports absent and older binaries honestly', async () => {
    expect((await inspectAgent('claude', path.join(dir, 'absent'))).start).toBe(false);
    const file = path.join(dir, 'old'); fs.writeFileSync(file, `#!${process.execPath}\nconsole.log(process.argv[2]==='--version'?'1.0.0':'--settings');\n`); fs.chmodSync(file, 0o755);
    expect(await inspectAgent('claude', file)).toMatchObject({ start: true, resume: false, fork: false, hooks: false });
  });
});
