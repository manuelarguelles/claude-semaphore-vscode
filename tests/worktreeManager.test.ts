import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { execFileSync } from 'child_process';
import { createWorktree } from '../src/worktreeManager';
let dir: string; let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semaphore-git-')); repo = path.join(dir, 'repo with spaces'); fs.mkdirSync(repo); git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const commit = () => { fs.writeFileSync(path.join(repo, 'file.txt'), 'original'); git('add', '.'); git('commit', '-m', 'fixture'); };
describe('real git worktrees', () => {
  it('creates a new branch/worktree from committed HEAD and preserves local changes', async () => {
    commit(); const head = git('rev-parse', 'HEAD'); fs.writeFileSync(path.join(repo, 'file.txt'), 'uncommitted');
    const dest = path.join(dir, 'worktree with spaces');
    expect(await createWorktree(repo, 'feature/new', dest)).toBe(dest);
    expect(fs.readFileSync(path.join(dest, 'file.txt'), 'utf8')).toBe('original');
    expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('uncommitted');
    expect(git('rev-parse', 'feature/new')).toBe(head);
  });
  it('rejects existing destinations/branches and invalid branches without touching them', async () => {
    commit(); const dest = path.join(dir, 'existing'); fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, 'keep'), 'safe');
    await expect(createWorktree(repo, 'feature/new', dest)).rejects.toThrow();
    git('branch', 'taken'); await expect(createWorktree(repo, 'taken', path.join(dir, 'new'))).rejects.toThrow();
    await expect(createWorktree(repo, '--orphan', path.join(dir, 'new'))).rejects.toThrow();
    expect(fs.readFileSync(path.join(dest, 'keep'), 'utf8')).toBe('safe');
    expect(fs.existsSync(path.join(dir, 'new'))).toBe(false);
  });
  it('fails clearly in repositories without HEAD', async () => {
    await expect(createWorktree(repo, 'feature/new', path.join(dir, 'new'))).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'new'))).toBe(false);
  });
});
