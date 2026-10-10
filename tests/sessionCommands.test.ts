import { describe, it, expect, vi, beforeEach } from 'vitest';
const ui = vi.hoisted(() => ({ handlers: new Map<string, Function>(), input: vi.fn(), pick: vi.fn(), open: vi.fn(), warn: vi.fn(), error: vi.fn(), trusted: true }));
vi.mock('vscode', () => ({
  commands: { registerCommand: (id: string, fn: Function) => { ui.handlers.set(id, fn); return { dispose() {} }; } },
  window: { showInputBox: ui.input, showQuickPick: ui.pick, showOpenDialog: ui.open, showWarningMessage: ui.warn, showErrorMessage: ui.error },
  workspace: { get isTrusted() { return ui.trusted; } },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));
import { registerSessionCommands, SessionServices } from '../src/sessionCommands';
import { defaultViewOptions } from '../src/sessionPresentation';
import { SessionJournal } from '../src/sessionJournal';
let services: SessionServices; let view = defaultViewOptions(); let launches: any[];
beforeEach(() => {
  vi.clearAllMocks(); ui.handlers.clear(); ui.trusted = true; view = defaultViewOptions(); launches = [];
  services = {
    getSessions: () => [], getJournal: () => new SessionJournal(null), getView: () => view,
    updateView: next => { view = next; }, toggleFavorite: async () => {},
    getCapabilities: async provider => ({ provider, executable: '/fake', start: true, resume: true, fork: true, worktree: true, hooks: true }),
    launch: async request => { launches.push(request); }, configureHooks: async () => {}, refresh: async () => {},
    showDetails: async () => {}, showHistory: async () => {}, clearHistory: async () => {},
    getDefaultCwd: () => '/project', createWorktree: async (_repo, _branch, dest) => dest,
    reveal: () => false,
  };
  registerSessionCommands({ subscriptions: [] } as any, services);
});
describe('session command flows', () => {
  it('search applies a query and clear resets all filters', async () => {
    ui.input.mockResolvedValueOnce('Databricks'); await ui.handlers.get('claudeSemaphore.search')!();
    expect(view.query).toBe('Databricks');
    await ui.handlers.get('claudeSemaphore.clearFilters')!(); expect(view).toEqual(defaultViewOptions());
  });
  it('cancelled start never launches and untrusted workspace blocks execution', async () => {
    ui.pick.mockResolvedValueOnce(undefined); await ui.handlers.get('claudeSemaphore.start')!(); expect(launches).toEqual([]);
    ui.trusted = false; await ui.handlers.get('claudeSemaphore.start')!(); expect(launches).toEqual([]); expect(ui.warn).toHaveBeenCalled();
  });
  it('start launches the selected provider in an explicit selected directory', async () => {
    ui.pick.mockResolvedValueOnce({ provider: 'codex' }); ui.open.mockResolvedValueOnce([{ fsPath: '/project with spaces' }]);
    await ui.handlers.get('claudeSemaphore.start')!(); expect(launches).toEqual([{ provider: 'codex', action: 'start', cwd: '/project with spaces' }]);
  });
  it('fork does not silently resume or ignore errors', async () => {
    const row = { provider: 'claude', sessionId: 'abc', pid: 1, cwd: '/work', title: 'Title', state: 'stopped' };
    await ui.handlers.get('claudeSemaphore.fork')!(row); expect(launches[0]).toEqual({ provider: 'claude', action: 'fork', sessionId: 'abc', cwd: '/work' });
    services.launch = async () => { throw new Error('Launch failed'); };
    await ui.handlers.get('claudeSemaphore.fork')!(row); expect(ui.error.mock.calls[0][0]).toContain('Launch failed');
  });
  it('failed launch retains and identifies the already-created worktree', async () => {
    ui.pick.mockResolvedValueOnce({ provider: 'codex' }); ui.open.mockResolvedValueOnce([{ fsPath: '/repo' }]);
    ui.input.mockResolvedValueOnce('feature/test').mockResolvedValueOnce('/new worktree');
    services.launch = async () => { throw new Error('agent missing'); };
    await ui.handlers.get('claudeSemaphore.worktree')!();
    expect(ui.error.mock.calls[0][0]).toContain('/new worktree');
  });
});
