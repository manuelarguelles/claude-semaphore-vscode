import { execFile } from 'child_process';
import { promises as fs, constants } from 'fs';
import * as os from 'os'; import * as path from 'path';
import { Provider } from './types';
export interface AgentCapabilities { provider: Provider; executable: string; start: boolean; resume: boolean; fork: boolean; worktree: boolean; hooks: boolean; version?: string }
const cache = new Map<string, { at: number; value: AgentCapabilities }>();
export function runExecutable(executable: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => execFile(executable, args, { cwd, timeout: 5000, maxBuffer: 512 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
export async function resolveExecutable(name: string): Promise<string> {
  if (!name || /[\x00-\x1f]/.test(name)) throw new Error('Ejecutable no válido.');
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (process.platform !== 'win32') dirs.push(path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.cargo/bin'), '/opt/homebrew/bin', '/usr/local/bin');
  const candidates = path.isAbsolute(name) ? [name] : name.includes(path.sep) ? [path.resolve(name)]
    : dirs.flatMap(dir => process.platform === 'win32' ? ['', '.exe', '.cmd'].map(ext => path.join(dir, name + ext)) : [path.join(dir, name)]);
  for (const file of candidates) {
    try { const stat = await fs.stat(file); if (stat.isFile()) { await fs.access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return file; } } catch {}
  }
  throw new Error(`No se encontró ${name}. Configura su ruta en los ajustes de Semáforo.`);
}
export async function inspectAgent(provider: Provider, executable: string): Promise<AgentCapabilities> {
  const key = JSON.stringify([provider, executable]); const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 60000) return saved.value;
  let result: AgentCapabilities = { provider, executable, start: false, resume: false, fork: false, worktree: false, hooks: false };
  try {
    const binary = await resolveExecutable(executable);
    const [help, version] = await Promise.all([runExecutable(binary, ['--help']), runExecutable(binary, ['--version'])]);
    const resume = provider === 'claude' ? /--resume\b/.test(help) : provider === 'opencode' ? /--session\b/.test(help) : /\bresume\b/.test(help);
    const fork = provider === 'claude' ? resume && /--fork-session\b/.test(help) : provider === 'opencode' ? resume && /--fork\b/.test(help) : /\bfork\b/.test(help);
    let hooks = false;
    if (provider === 'codex') {
      try { hooks = /^hooks\s+stable\s+true\s*$/m.test(await runExecutable(binary, ['features', 'list'])); } catch {}
    } else if (provider === 'opencode') {
      hooks = false; // OpenCode no expone hooks locales configurables (observación vía su base de datos).
    } else {
      const numbers = version.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
      hooks = /--settings\b/.test(help) && !!numbers && (numbers[0] > 2 || (numbers[0] === 2 && (numbers[1] > 1 || (numbers[1] === 1 && numbers[2] >= 295))));
    }
    result = { provider, executable: binary, start: true, resume, fork, worktree: /--worktree\b/.test(help), hooks, version: version.trim().slice(0, 120) };
  } catch { /* absent/incompatible CLI is a capability result, never launch success */ }
  cache.set(key, { at: Date.now(), value: result }); return result;
}
