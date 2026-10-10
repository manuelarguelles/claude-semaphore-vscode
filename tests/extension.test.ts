import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SessionState } from '../src/types';

const ui = vi.hoisted(() => ({
  root: `/tmp/semaphore-activate-${process.pid}`,
  provider: undefined as any,
  status: { text: '', tooltip: '', show: vi.fn(), dispose: vi.fn() },
  warnings: vi.fn(), discover: vi.fn(), watcherDispose: vi.fn(), registrationDispose: vi.fn(),
  errors: vi.fn(), handlers: new Map<string, Function>(), input: vi.fn(), document: '', saved: new Map<string, unknown>(),
  view: { message: '', dispose: vi.fn() },
  pick: vi.fn(), information: vi.fn(), config: new Map<string, unknown>(),
}));
vi.mock('os', async importOriginal => ({ ...await importOriginal<typeof import('os')>(), homedir: () => ui.root }));
vi.mock('../src/codexSessions', async importOriginal => ({
  ...await importOriginal<typeof import('../src/codexSessions')>(), discoverCodexRollouts: ui.discover,
}));
vi.mock('../src/terminalLinker', async importOriginal => ({
  ...await importOriginal<typeof import('../src/terminalLinker')>(), psParentPid: async () => undefined,
}));
vi.mock('vscode', () => {
  const disposable = () => ({ dispose: ui.registrationDispose });
  return {
    EventEmitter: class { event = () => disposable(); fire() {} dispose() {} },
    TreeItem: class { constructor(public label: string) {} },
    ThemeIcon: class { constructor(public id: string, public color?: unknown) {} },
    ThemeColor: class { constructor(public id: string) {} },
    RelativePattern: class {}, Uri: { file: (p: string) => p },
    TreeItemCollapsibleState: { None: 0 }, StatusBarAlignment: { Left: 1 },
    window: {
      terminals: [], state: { focused: true },
      registerTreeDataProvider: (_id: string, p: unknown) => { ui.provider = p; return disposable(); },
      createStatusBarItem: () => ui.status, showWarningMessage: ui.warnings,
      onDidCloseTerminal: disposable,
      createTreeView: (_id: string, options: any) => { ui.provider = options.treeDataProvider; return ui.view; },
      showInputBox: ui.input, showErrorMessage: ui.errors, showTextDocument: async (doc: any) => { ui.document = doc.content; },
      showQuickPick: ui.pick, showInformationMessage: ui.information,
    },
    workspace: {
      isTrusted: true, workspaceFolders: [],
      openTextDocument: async (options: any) => options,
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => ui.config.get(key) ?? fallback }),
      onDidChangeConfiguration: disposable,
      createFileSystemWatcher: () => ({
        onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable, dispose: ui.watcherDispose,
      }),
    },
    commands: { registerCommand: (id: string, fn: Function) => { ui.handlers.set(id, fn); return disposable(); } },
  };
});
import { activate } from '../src/extension';

let context: { subscriptions: { dispose(): unknown }[]; extensionPath: string };
function dispose() { for (const subscription of context.subscriptions.splice(0)) subscription.dispose(); }
function rollout(id: string, event: string) {
  const file = path.join(ui.root, `rollout-${id}.jsonl`);
  fs.writeFileSync(file, [
    { type: 'session_meta', payload: { id, cwd: '/work/codex', source: 'cli' } },
    { type: 'event_msg', payload: { type: event } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  return { pid: process.pid, file };
}
const rows = (): SessionState[] => ui.provider.getChildren().flatMap((node: any) => node.kind === 'project' ? ui.provider.getChildren(node) : [node]);

beforeEach(() => {
  vi.clearAllMocks();
  ui.config.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  fs.mkdirSync(path.join(ui.root, '.claude/sessions'), { recursive: true });
  fs.writeFileSync(path.join(ui.root, '.claude/sessions/claude.json'), JSON.stringify({
    sessionId: 'claude-1', pid: process.pid, cwd: '/work/claude', name: 'Claude project', status: 'busy', kind: 'interactive',
  }));
  ui.discover.mockResolvedValue([]); ui.provider = undefined; ui.status.text = '';
  context = { subscriptions: [], extensionPath: ui.root, globalState: { get: (key: string, fallback: unknown) => ui.saved.get(key) ?? fallback, update: async (key: string, value: unknown) => { ui.saved.set(key, value); } }, workspaceState: { get: (_key: string, fallback: unknown) => fallback, update: async () => {} }, globalStorageUri: { fsPath: path.join(ui.root, 'storage') } } as any;
});
afterEach(() => { dispose(); vi.useRealTimers(); fs.rmSync(ui.root, { recursive: true, force: true }); });

describe('extension activation integration', () => {
  it('does not install unremovable hooks when ownership storage rejects', async () => {
    const executable = path.join(ui.root, 'reject-fixture-claude');
    fs.writeFileSync(executable, `#!${process.execPath}\nconsole.log(process.argv[2]==='--version'?'2.1.295':'--settings --resume --fork-session');\n`); fs.chmodSync(executable, 0o755);
    ui.config.set('claude.path', executable); ui.config.set('hooks.nodePath', process.execPath);
    fs.mkdirSync(path.join(ui.root, 'out'), { recursive: true }); fs.copyFileSync('scripts/session-hook.cjs', path.join(ui.root, 'out/session-hook.cjs'));
    const file = path.join(ui.root, '.claude/settings.json'); const original = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'foreign' }] }] } }); fs.writeFileSync(file, original);
    ui.saved.delete('hookCommands');
    (context as any).globalState.update = async (key: string, value: unknown) => { if (key === 'hookCommands') throw new Error('storage rejected'); ui.saved.set(key, value); };
    activate(context as any); await vi.waitFor(() => expect(rows()).toHaveLength(1));
    ui.pick.mockResolvedValueOnce({ provider: 'claude' }).mockResolvedValueOnce('Instalar señales de Semáforo'); ui.warnings.mockResolvedValueOnce('Aplicar');
    await ui.handlers.get('claudeSemaphore.configureHooks')!();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(ui.information).not.toHaveBeenCalled(); expect(ui.errors).toHaveBeenCalled();
    ui.pick.mockResolvedValueOnce({ provider: 'claude' }).mockResolvedValueOnce('Retirar señales de Semáforo');
    await ui.handlers.get('claudeSemaphore.configureHooks')!();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('installs a stable private receiver and removes only owned hooks without requiring the CLI', async () => {
    const executable = path.join(ui.root, 'fixture-claude');
    fs.writeFileSync(executable, `#!${process.execPath}\nconsole.log(process.argv[2]==='--version'?'2.1.295':'--settings --resume --fork-session');\n`); fs.chmodSync(executable, 0o755);
    ui.config.set('claude.path', executable); ui.config.set('hooks.nodePath', process.execPath);
    fs.mkdirSync(path.join(ui.root, 'out'), { recursive: true });
    fs.copyFileSync('scripts/session-hook.cjs', path.join(ui.root, 'out/session-hook.cjs'));
    const original = { env: { EXISTING_TOKEN: 'SECRET_CONFIG' }, permissions: { allow: ['Read'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo foreign' }] }] } };
    const file = path.join(ui.root, '.claude/settings.json'); fs.writeFileSync(file, JSON.stringify(original));
    activate(context as any); await vi.waitFor(() => expect(rows()).toHaveLength(1));
    ui.pick.mockResolvedValueOnce({ provider: 'claude' }).mockResolvedValueOnce('Instalar señales de Semáforo');
    ui.warnings.mockResolvedValueOnce('Aplicar'); await ui.handlers.get('claudeSemaphore.configureHooks')!();
    const installed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(installed.permissions).toEqual(original.permissions);
    expect(ui.document).not.toContain('SECRET_CONFIG');
    const command = installed.hooks.PermissionRequest[0].hooks[0].command;
    expect(command).toContain(path.join(ui.root, 'storage/hooks/session-hook.cjs'));
    expect(fs.existsSync(path.join(ui.root, 'storage/hooks/session-hook.cjs'))).toBe(true);
    expect(fs.readdirSync(path.dirname(file)).some(n => n.startsWith('settings.json.semaphore-backup-'))).toBe(true);
    ui.config.set('hooks.nodePath', '/missing/node'); ui.config.set('claude.path', '/missing/claude');
    ui.pick.mockResolvedValueOnce({ provider: 'claude' }).mockResolvedValueOnce('Retirar señales de Semáforo');
    ui.warnings.mockResolvedValueOnce('Aplicar'); await ui.handlers.get('claudeSemaphore.configureHooks')!();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(original);
  });
  it('restores favorites after activation and tolerates corrupt preferences', async () => {
    ui.saved.set('favorites', ['["claude","claude-1"]']);
    activate(context as any); await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(ui.provider.getTreeItem(rows()[0]).label).toContain('★');
    dispose(); ui.saved.set('favorites', 'corrupt');
    expect(() => activate(context as any)).not.toThrow();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(ui.provider.getTreeItem(rows()[0]).label).not.toContain('★');
    ui.saved.delete('favorites');
  });
  it('wires filters, detail and persistent favorites into the real provider', async () => {
    activate(context as any); await vi.waitFor(() => expect(rows()).toHaveLength(1));
    ui.input.mockResolvedValueOnce('absent'); await ui.handlers.get('claudeSemaphore.search')!();
    expect(rows()).toEqual([]); expect(ui.view.message).toContain('0/1');
    await ui.handlers.get('claudeSemaphore.clearFilters')!();
    const row = rows()[0]; await ui.handlers.get('claudeSemaphore.favorite')!(row);
    expect(ui.provider.getTreeItem(row).label).toContain('★');
    await ui.handlers.get('claudeSemaphore.details')!(row); expect(ui.document).toContain('Tiempo observado');
    expect(ui.saved.get('favorites')).toEqual(['["claude","claude-1"]']);
  });
  it('merges providers with labels, summary counts and distinct thread identities sharing a PID', async () => {
    ui.discover.mockResolvedValue([rollout('codex-a', 'task_started'), rollout('codex-b', 'task_complete')]);
    activate(context as any);
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    const items = rows().map(s => ui.provider.getTreeItem(s));
    expect(items.map(i => i.description)).toEqual(['Claude · trabajando', 'Codex · trabajando', 'Codex · inactivo / finalizado']);
    expect(new Set(items.map(i => i.id)).size).toBe(3);
    expect(ui.status.text).toBe('🟢2 🟡0 ⚪1');
  });

  it('keeps Claude rows and warns once when Codex discovery fails', async () => {
    ui.discover.mockRejectedValue(new Error('lsof unavailable'));
    activate(context as any);
    await vi.waitFor(() => expect(ui.status.text).toContain('$(warning)'));
    expect(rows().map(s => s.sessionId)).toEqual(['claude-1']);
    expect(ui.warnings).toHaveBeenCalledTimes(1);
    expect(ui.warnings.mock.calls[0][0]).toContain('Claude sigue disponible');
    await vi.advanceTimersByTimeAsync(10000);
    // A native filesystem tick may still be in flight when fake time jumps.
    await vi.waitFor(() => expect(ui.discover).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(ui.warnings).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
  });

  it('disposes resources and prevents subsequent poll-driven discovery', async () => {
    activate(context as any);
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(ui.status.dispose).toHaveBeenCalledOnce();
    expect(ui.watcherDispose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20000);
    expect(ui.discover).toHaveBeenCalledOnce();
  });
});
