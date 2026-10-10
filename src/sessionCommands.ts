import * as vscode from 'vscode';
import { Provider, SessionState, SemaphoreState } from './types';
import { SessionJournal, RecordedSession } from './sessionJournal';
import { ViewOptions, defaultViewOptions, stateLabels } from './sessionPresentation';
import { AgentCapabilities } from './agentCapabilities';
import { LaunchRequest } from './sessionLauncher';
export interface SessionServices {
  getSessions(): SessionState[]; getJournal(): SessionJournal; getView(): ViewOptions; updateView(options: ViewOptions): void;
  toggleFavorite(s: SessionState): Promise<void>; getCapabilities(provider: Provider): Promise<AgentCapabilities>;
  launch(request: LaunchRequest): Promise<void>; configureHooks(): Promise<void>; refresh(): Promise<void>;
  showDetails(s: SessionState | RecordedSession): Promise<void>; showHistory(): Promise<void>; clearHistory(): Promise<void>;
  getDefaultCwd(): string | undefined; createWorktree(repo: string, branch: string, destination: string): Promise<string>;
  reveal(s: SessionState): boolean;
}
export function registerSessionCommands(context: vscode.ExtensionContext, services: SessionServices): void {
  const register = (name: string, fn: (row?: SessionState) => unknown, mutation = false) => context.subscriptions.push(vscode.commands.registerCommand(`claudeSemaphore.${name}`, async (row?: SessionState) => {
    if (mutation && !vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Semáforo: confía en el workspace antes de ejecutar agentes, hooks o Git.'); return; }
    try { await fn(row); } catch (error) { await vscode.window.showErrorMessage(`Semáforo: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  const chooseProvider = async (): Promise<Provider | undefined> => {
    const choice = await vscode.window.showQuickPick([{ label: 'Claude Code', provider: 'claude' as const }, { label: 'Codex', provider: 'codex' as const }], { placeHolder: 'Elige el agente' });
    return choice?.provider;
  };
  const chooseFolder = async (): Promise<string | undefined> => {
    const cwd = services.getDefaultCwd();
    const selected = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Usar proyecto', ...(cwd ? { defaultUri: vscode.Uri.file(cwd) } : {}) });
    return selected?.[0]?.fsPath;
  };
  register('search', async () => {
    const query = await vscode.window.showInputBox({ prompt: 'Buscar por nombre, proyecto o proveedor', value: services.getView().query });
    if (query !== undefined) services.updateView({ ...services.getView(), query });
  });
  register('filters', async () => {
    const options: { label: string; value: string; picked: boolean }[] = [
      ...(['claude', 'codex'] as const).map(p => ({ label: `Proveedor: ${p}`, value: `provider:${p}`, picked: services.getView().provider === p })),
      ...(Object.keys(stateLabels) as SemaphoreState[]).map(s => ({ label: `Estado: ${stateLabels[s]}`, value: `state:${s}`, picked: services.getView().state === s })),
      { label: 'Solo favoritas', value: 'favorites', picked: services.getView().favoritesOnly },
    ];
    const picked = await vscode.window.showQuickPick(options, { canPickMany: true, placeHolder: 'Un proveedor y un estado como máximo; vacíos = todos' });
    if (!picked) return;
    const providers = picked.filter(p => p.value.startsWith('provider:')); const states = picked.filter(p => p.value.startsWith('state:'));
    if (providers.length > 1 || states.length > 1) throw new Error('Elige como máximo un proveedor y un estado.');
    services.updateView({ ...services.getView(), provider: providers[0]?.value.slice(9) as Provider | undefined,
      state: states[0]?.value.slice(6) as SemaphoreState | undefined, favoritesOnly: picked.some(p => p.value === 'favorites') });
  });
  register('clearFilters', () => services.updateView({ ...defaultViewOptions(), grouped: services.getView().grouped }));
  register('toggleGrouping', () => services.updateView({ ...services.getView(), grouped: !services.getView().grouped }));
  register('favorite', async row => { if (row?.sessionId) await services.toggleFavorite(row); });
  register('refresh', () => services.refresh());
  register('details', async row => { if (row?.sessionId) await services.showDetails(row); });
  register('history', () => services.showHistory());
  register('clearHistory', () => services.clearHistory());
  register('configureHooks', () => services.configureHooks(), true);
  register('start', async () => {
    const provider = await chooseProvider(); if (!provider) return; const cwd = await chooseFolder(); if (!cwd) return;
    await services.launch({ provider, action: 'start', cwd });
  }, true);
  register('resume', async row => {
    let session: SessionState | RecordedSession | undefined = row;
    if (!session?.sessionId) {
      const entries = services.getJournal().recent().map(s => ({ label: s.title, description: `${s.provider} · ${s.active ? 'activa' : 'anterior'}`, detail: s.cwd, session: s }));
      const picked = await vscode.window.showQuickPick([...entries, { label: 'Abrir selector nativo del agente', description: '', detail: '', session: undefined }], { placeHolder: 'Recuperar una sesión conocida o buscar en el CLI' });
      if (!picked) return; session = picked.session;
      if (!session) {
        const provider = await chooseProvider(); if (!provider) return; const cwd = await chooseFolder(); if (!cwd) return;
        // Native selector is an explicit separate flow; no implicit --last or arbitrary session.
        await services.launch({ provider, action: 'resume', cwd, nativePicker: true }); return;
      }
    }
    const active = services.getSessions().find(s => s.sessionId === session!.sessionId && (s.provider ?? 'claude') === (session!.provider ?? 'claude'));
    if (active) {
      if (services.reveal(active)) return;
      const choice = await vscode.window.showWarningMessage('La sesión sigue activa en otra terminal. Recuperarla puede abrir otra instancia.', { modal: true }, 'Recuperar de todos modos');
      if (choice !== 'Recuperar de todos modos') return;
    }
    await services.launch({ provider: session.provider ?? 'claude', action: 'resume', sessionId: session.sessionId, cwd: session.cwd });
  }, true);
  register('fork', async row => {
    if (!row?.sessionId) return;
    await services.launch({ provider: row.provider ?? 'claude', action: 'fork', sessionId: row.sessionId, cwd: row.cwd });
  }, true);
  register('worktree', async () => {
    const provider = await chooseProvider(); if (!provider) return;
    const capability = await services.getCapabilities(provider); if (!capability.start) throw new Error('Instala el CLI o configura su ruta antes de crear el worktree.');
    const repo = await chooseFolder(); if (!repo) return;
    const branch = await vscode.window.showInputBox({ prompt: 'Nombre de rama nueva para el worktree' }); if (!branch) return;
    const destination = await vscode.window.showInputBox({ prompt: 'Ruta absoluta del nuevo worktree (directorio vacío o nuevo)' }); if (!destination) return;
    const cwd = await services.createWorktree(repo, branch, destination);
    try { await services.launch({ provider, action: 'start', cwd }); }
    catch (error) { throw new Error(`Worktree conservado en ${cwd}. No se pudo iniciar el agente: ${error instanceof Error ? error.message : String(error)}`); }
  }, true);
}
