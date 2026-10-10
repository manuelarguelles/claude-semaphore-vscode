import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SessionState } from '../src/types';

const ui = vi.hoisted(() => ({
  root: `/tmp/semaphore-activate-${process.pid}`,
  provider: undefined as any,
  status: { text: '', tooltip: '', show: vi.fn(), dispose: vi.fn() },
  warnings: vi.fn(), discover: vi.fn(), watcherDispose: vi.fn(), registrationDispose: vi.fn(),
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
    },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidChangeConfiguration: disposable,
      createFileSystemWatcher: () => ({
        onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable, dispose: ui.watcherDispose,
      }),
    },
    commands: { registerCommand: disposable },
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
const rows = (): SessionState[] => ui.provider.getChildren();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  fs.mkdirSync(path.join(ui.root, '.claude/sessions'), { recursive: true });
  fs.writeFileSync(path.join(ui.root, '.claude/sessions/claude.json'), JSON.stringify({
    sessionId: 'claude-1', pid: process.pid, cwd: '/work/claude', name: 'Claude project', status: 'busy', kind: 'interactive',
  }));
  ui.discover.mockResolvedValue([]); ui.provider = undefined; ui.status.text = '';
  context = { subscriptions: [], extensionPath: ui.root };
});
afterEach(() => { dispose(); vi.useRealTimers(); fs.rmSync(ui.root, { recursive: true, force: true }); });

describe('extension activation integration', () => {
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
    expect(ui.discover).toHaveBeenCalledTimes(2);
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
