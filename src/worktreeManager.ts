import { promises as fs } from 'fs';
import * as path from 'path';
import { runExecutable } from './agentCapabilities';
export async function createWorktree(repo: string, branch: string, destination: string): Promise<string> {
  if (!path.isAbsolute(repo) || !path.isAbsolute(destination) || /[\x00-\x1f]/.test(repo + destination)
    || !branch || branch.startsWith('-') || /[\x00-\x1f]/.test(branch)) throw new Error('Repositorio, destino o rama no válidos.');
  await runExecutable('git', ['check-ref-format', '--branch', branch], repo);
  await runExecutable('git', ['rev-parse', '--verify', 'HEAD'], repo);
  const existing = await runExecutable('git', ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`], repo);
  if (existing.trim()) throw new Error('La rama ya existe; elige una rama nueva.');
  try {
    const stat = await fs.stat(destination);
    if (!stat.isDirectory() || (await fs.readdir(destination)).length) throw new Error('El destino ya existe y no está vacío.');
  } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  await runExecutable('git', ['worktree', 'add', '-b', branch, '--', destination, 'HEAD'], repo);
  return destination;
}
