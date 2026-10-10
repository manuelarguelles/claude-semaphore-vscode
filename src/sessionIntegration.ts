import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path'; import * as os from 'os';
import { randomUUID } from 'crypto';
import { SessionState, Provider } from './types';
import { SessionTree } from './sessionTree';
import { ViewOptions, defaultViewOptions } from './sessionPresentation';
import { persistentSessionKey, sessionKey } from './sessionIdentity';
import { SessionJournal } from './sessionJournal';
import { registerSessionCommands } from './sessionCommands';
import { formatSessionDetails } from './sessionDetails';
import { inspectAgent, resolveExecutable, runExecutable } from './agentCapabilities';
import { buildLaunch } from './sessionLauncher';
import { createWorktree } from './worktreeManager';
import { hookCommand, mergeHooks, removeOwnHooks } from './hookConfiguration';

export function integrateSessions(context: vscode.ExtensionContext, tree: SessionTree, getSessions: () => SessionState[],
  terminals: Map<string | number, vscode.Terminal>, refresh: () => Promise<void>): { journal: SessionJournal; eventsDirectory: string; observe(): void } {
  const store = context.globalState;
  const journal = new SessionJournal(store.get('journal'));
  const saved = context.workspaceState.get<Partial<ViewOptions>>('view', {});
  let view = { ...defaultViewOptions(), ...saved };
  if (typeof view.query !== 'string') view.query = '';
  if (!['claude', 'codex'].includes(view.provider ?? '')) view.provider = undefined;
  if (!['running', 'needsInput', 'stopped', 'error', 'unknown'].includes(view.state ?? '')) view.state = undefined;
  view.grouped = typeof view.grouped === 'boolean' ? view.grouped : true;
  view.favoritesOnly = view.favoritesOnly === true;
  const savedFavorites = store.get<unknown>('favorites', []);
  const favorites = new Set<string>((Array.isArray(savedFavorites) ? savedFavorites : []).filter(value => typeof value === 'string' && value.length <= 500).slice(-1000));
  const eventsDirectory = path.join(context.globalStorageUri.fsPath, 'events');
  let queue: Promise<unknown> = Promise.resolve(); let lastSave = 0; let warnedPersistence = false;
  const update = (key: string, value: unknown, target: vscode.Memento = store): Promise<unknown> => {
    queue = queue.then(() => target.update(key, value)).catch(error => {
      if (!warnedPersistence) { warnedPersistence = true; void vscode.window.showWarningMessage(`Semáforo: no se pudieron guardar preferencias/historial: ${String(error)}`); }
    }); return queue;
  };
  const document = async (content: string) => { const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' }); await vscode.window.showTextDocument(doc, { preview: true }); };
  const getCapabilities = (provider: Provider) => inspectAgent(provider, vscode.workspace.getConfiguration('claudeSemaphore').get<string>(`${provider}.path`, provider));
  const reveal = (s: SessionState): boolean => {
    const terminal = terminals.get(sessionKey(s)); if (!terminal || terminal.exitStatus !== undefined) return false;
    terminal.show(false); return true;
  };
  const configureHooks = async () => {
    const picked = await vscode.window.showQuickPick([{ label: 'Claude Code', provider: 'claude' as const }, { label: 'Codex', provider: 'codex' as const }], { placeHolder: 'Configurar señales opcionales' });
    if (!picked) return;
    const provider = picked.provider;
    const action = await vscode.window.showQuickPick(['Instalar señales de Semáforo', 'Retirar señales de Semáforo'], { placeHolder: 'Se conservarán los hooks existentes' });
    if (!action) return;
    const installing = action.startsWith('Instalar');
    const registry = store.get<Partial<Record<Provider, string[]>>>('hookCommands', {});
    const owned = Array.isArray(registry?.[provider]) ? registry[provider]!.filter(c => typeof c === 'string').slice(-10) : [];
    const sourceReceiver = path.join(context.extensionPath, 'out/session-hook.cjs');
    const receiver = path.join(context.globalStorageUri.fsPath, 'hooks/session-hook.cjs');
    let command: string | undefined;
    if (installing) {
      const capabilities = await getCapabilities(provider);
      if (!capabilities.hooks) throw new Error('La versión instalada no ofrece los hooks verificados. Actualiza el CLI; la observación actual sigue disponible.');
      const node = await resolveExecutable(vscode.workspace.getConfiguration('claudeSemaphore').get<string>('hooks.nodePath', 'node'));
      const version = await runExecutable(node, ['--version']); if (Number(version.match(/^v(\d+)\./)?.[1] ?? 0) < 18) throw new Error('Los hooks requieren Node.js 18 o posterior.');
      await fs.access(sourceReceiver);
      command = hookCommand(node, receiver, eventsDirectory, provider);
    } else if (!owned.length) {
      throw new Error('No hay una instalación de señales de Semáforo registrada para este agente. Se preservó su configuración.');
    }
    const file = path.join(os.homedir(), provider === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
    let text: string | undefined; let original: unknown = {};
    try {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) throw new Error('Configuración enlazada o demasiado grande: configura el hook manualmente para preservar tu archivo.');
      text = await fs.readFile(file, 'utf8'); original = JSON.parse(text);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    let next = original;
    for (const previous of owned) next = removeOwnHooks(provider, next, previous);
    if (installing) next = mergeHooks(provider, next, command!);
    const preview = JSON.stringify(next, null, 2) + '\n';
    const changePreview = installing ? JSON.stringify(mergeHooks(provider, {}, command!), null, 2) : `Retirar exclusivamente estos comandos:\n${owned.join('\n')}`;
    await document(`Archivo: ${file}\n\nCambios de Semáforo:\n${changePreview}\nReceptor local: ${command ?? owned.join('\n')}\n\nSe conservan las demás opciones. No cambia decisiones ni permisos. Codex requiere revisar y confiar en /hooks.\n`);
    const accepted = await vscode.window.showWarningMessage(`Aplicar ${action.toLowerCase()} en ${file}? Se guardará una copia del archivo anterior.`, { modal: true }, 'Aplicar');
    if (accepted !== 'Aplicar') return;
    // Detect edits since preview rather than clobbering another program's configuration.
    let current: string | undefined; try { current = await fs.readFile(file, 'utf8'); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    if (current !== text) throw new Error('La configuración cambió durante la revisión. Vuelve a abrir el comando.');
    if (installing) {
      await fs.mkdir(path.dirname(receiver), { recursive: true, mode: 0o700 });
      const receiverTemp = `${receiver}.${process.pid}.tmp`;
      await fs.copyFile(sourceReceiver, receiverTemp); await fs.chmod(receiverTemp, 0o600); await fs.rename(receiverTemp, receiver);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (text !== undefined) await fs.writeFile(`${file}.semaphore-backup-${Date.now()}-${randomUUID()}`, text, { flag: 'wx', mode: 0o600 });
    const temporary = `${file}.semaphore-${process.pid}-${Date.now()}.tmp`;
    try { await fs.writeFile(temporary, preview, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(() => {}); }
    await update('hookCommands', { ...registry, [provider]: installing ? [command] : [] });
    await vscode.window.showInformationMessage(`Semáforo: configuración aplicada. ${provider === 'codex' ? 'Revisa y confía en /hooks en Codex; configurar no implica que las señales estén activas.' : 'Comprueba los hooks en Claude antes de iniciar una nueva sesión.'}`);
  };
  tree.setView(view, favorites);
  registerSessionCommands(context, {
    getSessions, getJournal: () => journal, getView: () => view,
    updateView: options => { view = options; tree.setView(view, favorites); void update('view', view, context.workspaceState); },
    toggleFavorite: async s => { const key = persistentSessionKey(s); favorites.has(key) ? favorites.delete(key) : favorites.add(key); tree.setView(view, favorites); await update('favorites', [...favorites]); },
    getCapabilities,
    launch: async request => {
      const spec = buildLaunch(request, await getCapabilities(request.provider));
      const stat = await fs.stat(spec.cwd); if (!stat.isDirectory()) throw new Error('La carpeta de la sesión no existe.');
      const terminal = vscode.window.createTerminal({ name: `${request.provider === 'codex' ? 'Codex' : 'Claude'} · ${request.action}`, shellPath: spec.executable, shellArgs: spec.args, cwd: spec.cwd });
      terminal.show(false);
      // Opening a terminal is not evidence that the requested session started successfully.
      const registration = vscode.window.onDidCloseTerminal(t => { if (t === terminal && t.exitStatus?.code) void vscode.window.showWarningMessage(`Semáforo: el agente terminó con código ${t.exitStatus.code}. Revisa el CLI/configuración.`); });
      context.subscriptions.push(registration);
    },
    configureHooks, refresh, reveal,
    showDetails: async s => { const entry = journal.recent().find(r => r.key === persistentSessionKey(s)); if (entry) await document(formatSessionDetails(entry)); },
    showHistory: async () => {
      const picked = await vscode.window.showQuickPick(journal.recent().map(s => ({ label: s.title, description: `${s.provider} · ${s.active ? 'activa' : 'anterior'}`, detail: s.cwd, session: s })), { placeHolder: 'Historial local de sesiones observadas' });
      if (picked) await document(formatSessionDetails(picked.session));
    },
    clearHistory: async () => { if (await vscode.window.showWarningMessage('Borrar el historial local de Semáforo? Las conversaciones del agente se conservan.', { modal: true }, 'Borrar historial') === 'Borrar historial') { journal.clear(); await update('journal', journal.snapshot()); } },
    getDefaultCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? getSessions()[0]?.cwd,
    createWorktree,
  });
  context.subscriptions.push({ dispose: () => { void update('journal', journal.snapshot()); } });
  return { journal, eventsDirectory, observe: () => { const changed = journal.observe(getSessions()); if (changed || Date.now() - lastSave > 30000) { lastSave = Date.now(); void update('journal', journal.snapshot()); } } };
}
