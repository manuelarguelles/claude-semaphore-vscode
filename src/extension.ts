import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexReader, discoverCodexRollouts, OpenRollout } from './codexSessions';
import { sessionKey, persistentSessionKey } from './sessionIdentity';
import { SessionTree } from './sessionTree';
import { integrateSessions } from './sessionIntegration';
import { readSessionEvents, resolveEventState } from './sessionEvents';
import { stateLabels } from './sessionPresentation';
import { SessionState, ThemeName, RawSessionFile } from './types';
import { buildSessions } from './sessionStore';
import { summarize } from './stateMapper';
import { styleFor } from './theme';
import { formatTooltip } from './tooltip';
import { renderSignature } from './renderSignature';
import { Poller } from './poller';
import { TitleResolver } from './titleResolver';
import { Notifier } from './notifier';
import { AfplaySoundPlayer } from './soundPlayer';
import { TerminalLinker, psParentPid } from './terminalLinker';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

function listSessionFiles(): { path: string; raw: unknown }[] {
  let names: string[];
  try {
    names = fs.readdirSync(SESSIONS_DIR).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: { path: string; raw: unknown }[] = [];
  for (const name of names) {
    const p = path.join(SESSIONS_DIR, name);
    try {
      out.push({ path: p, raw: JSON.parse(fs.readFileSync(p, 'utf8')) });
    } catch {
      // mid-write or malformed; skip this tick
    }
  }
  return out;
}

/** Cache: sessionId → absolute transcript path (populated on first hit; never caches misses). */
const transcriptCache = new Map<string, string>();

/** Locate the transcript JSONL for a session by scanning project dirs for <sessionId>.jsonl. */
function findTranscript(sessionId: string): string | undefined {
  const cached = transcriptCache.get(sessionId);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return undefined;
  }
  for (const dir of projectDirs) {
    const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      transcriptCache.set(sessionId, candidate);
      return candidate;
    }
  }
  return undefined;
}

function currentTheme(): ThemeName {
  return vscode.workspace.getConfiguration('claudeSemaphore').get<ThemeName>('theme', 'classic');
}

const debugEnabled = (): boolean =>
  vscode.workspace.getConfiguration('claudeSemaphore').get<boolean>('debug', false);
const dbg = (msg: string): void => { if (debugEnabled()) { console.log(`[ClaudeSemaforo] ${msg}`); } };

export function activate(context: vscode.ExtensionContext): void {
  let treeView: vscode.TreeView<import('./sessionTree').TreeNode>;
  const tree = new SessionTree(currentTheme, () => { if (treeView) treeView.message = tree.message; });
  treeView = vscode.window.createTreeView('claudeSemaphore.sessions', { treeDataProvider: tree });
  context.subscriptions.push(treeView, tree);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'workbench.view.extension.claudeSemaphore';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const titleResolver = new TitleResolver();
  const player = new AfplaySoundPlayer();
  const bundledHonk = path.join(context.extensionPath, 'media', 'honk.aiff');

  const notifier = new Notifier({
    player,
    isWindowFocused: () => vscode.window.state.focused,
    isEnabled: () => vscode.workspace.getConfiguration('claudeSemaphore').get<boolean>('sound.enabled', true),
    soundFile: () => {
      const custom = vscode.workspace.getConfiguration('claudeSemaphore').get<string>('sound.file', '');
      return custom && custom.length > 0 ? custom : bundledHonk;
    },
  });

  const linker = new TerminalLinker({ getParentPid: psParentPid });
  const terminalBySession = new Map<string | number, vscode.Terminal>();
  let observedSessions: SessionState[] = [];

  const codexReader = new CodexReader();
  let codexFiles: OpenRollout[] = [];
  let nextDiscovery = 0;
  let codexError = false;
  let warnedCodex = false;
  let refreshing = false;
  let disposed = false;
  context.subscriptions.push({ dispose: () => { disposed = true; } });
  let warnedSchema = false;
  let tickCount = 0;

  const refresh = async (source: string): Promise<void> => {
    if (refreshing || disposed) return;
    refreshing = true;
    const seq = ++tickCount;
    dbg(`refresh #${seq} (${source}) @ ${new Date().toISOString()}`);
    try {
      const { sessions, sawUnknownSchema } = buildSessions({
        listSessionFiles,
        isAlive,
        resolveTitle: (raw: RawSessionFile) => {
          const transcript = findTranscript(raw.sessionId);
          const fallback = raw.name ?? path.basename(raw.cwd);
          return transcript ? titleResolver.resolve(transcript, fallback) : fallback;
        },
      });

      const codexEnabled = vscode.workspace.getConfiguration('claudeSemaphore').get<boolean>('codex.enabled', true);
      if (codexEnabled && process.platform !== 'win32') {
        if (Date.now() >= nextDiscovery) {
          nextDiscovery = Date.now() + 10000;
          try {
            codexFiles = await discoverCodexRollouts();
            codexReader.prune(codexFiles);
            codexError = false;
          } catch {
            codexFiles = []; codexReader.prune([]); codexError = true;
            if (!warnedCodex) {
              warnedCodex = true;
              vscode.window.showWarningMessage('Semáforo: no se pudo consultar Codex con lsof. Claude sigue disponible.');
            }
          }
        }
        const liveFiles = codexFiles.filter(f => isAlive(f.pid));
        const codexSessions = await Promise.all(liveFiles.map(f => codexReader.read(f)));
        sessions.push(...codexSessions.filter((s): s is SessionState => !!s));
      } else {
        codexFiles = []; codexReader.prune([]); nextDiscovery = 0;
        codexError = codexEnabled && process.platform === 'win32';
      }
      sessions.sort((a, b) => a.title.localeCompare(b.title) || sessionKey(a).localeCompare(sessionKey(b)));
      if (disposed) return;
      const events = await readSessionEvents(integration.eventsDirectory);
      for (let i = 0; i < sessions.length; i++) sessions[i] = resolveEventState(sessions[i], events.get(persistentSessionKey(sessions[i])));
      observedSessions = sessions;
      integration.observe();
      const next = new Map<string | number, vscode.Terminal>();
      await Promise.all(sessions.map(async (s) => {
        const t = await linker.resolve({ pid: s.pid, cwd: s.cwd }, vscode.window.terminals);
        if (t) { next.set(sessionKey(s), t as vscode.Terminal); }
      }));
      if (disposed) return;
      terminalBySession.clear();
      for (const [pid, term] of next) { terminalBySession.set(pid, term); }
      linker.prune(new Set(sessions.map((s) => s.pid)));

      const theme = currentTheme();
      tree.setTerminals(terminalBySession);
      tree.setSessions(sessions, renderSignature(sessions, new Set(terminalBySession.keys()), theme));
      notifier.update(sessions);

      const sum = summarize(sessions);
      const g = (state: 'running' | 'needsInput' | 'stopped') => styleFor(theme, state).summaryGlyph;
      statusBar.text = `${g('running')}${sum.running} ${g('needsInput')}${sum.needsInput} ${g('stopped')}${sum.stopped}`;
      if (sum.unknown) statusBar.text += ` $(question)${sum.unknown}`;
      if (sum.error) statusBar.text += ` ${styleFor(theme, 'error').summaryGlyph}${sum.error}`;
      if (codexError) statusBar.text += ' $(warning)';
      statusBar.tooltip = `Claude + Codex Semáforo — clic para ver las sesiones${codexError ? '\nCodex no disponible (requiere lsof en macOS/Linux).' : ''}`;
      dbg(`refresh #${seq} ok: files=${sessions.length} summary=${JSON.stringify(sum)}`);

      if (sawUnknownSchema && !warnedSchema) {
        warnedSchema = true;
        vscode.window.showWarningMessage(
          'Claude Semáforo: formato de sesión no reconocido — puede que Claude Code haya cambiado. Actualizá la extensión.',
        );
      }
    } catch (err) {
      console.error(`[ClaudeSemaforo] refresh #${seq} FAILED:`, err);
    } finally { refreshing = false; }
  };

  const integration = integrateSessions(context, tree, () => observedSessions, terminalBySession, () => refresh('command'));

  // Event-driven updates via watcher.
  dbg(`watching dir: ${SESSIONS_DIR}`);
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(SESSIONS_DIR), '*.json'),
  );
  let debounce: NodeJS.Timeout | undefined;
  const onChange = (evt: string): void => {
    dbg(`watcher event: ${evt}`);
    if (debounce) { clearTimeout(debounce); }
    debounce = setTimeout(() => refresh('watcher'), 150);
  };
  watcher.onDidChange(() => onChange('change'));
  watcher.onDidCreate(() => onChange('create'));
  watcher.onDidDelete(() => onChange('delete'));
  context.subscriptions.push(watcher);
  context.subscriptions.push({ dispose: () => { if (debounce) { clearTimeout(debounce); } } });

  // Poll fallback (catches missed fs events + dead-pid cleanup).
  const poller = new Poller({
    getIntervalMs: () =>
      vscode.workspace.getConfiguration('claudeSemaphore').get<number>('pollIntervalMs', 2000),
    setInterval: (fn, ms) => { dbg(`poll armed every ${ms}ms`); return setInterval(fn, ms); },
    clearInterval: (h) => clearInterval(h),
    tick: () => { void refresh('poll'); },
  });
  poller.start();
  context.subscriptions.push({ dispose: () => poller.dispose() });

  // Repaint when the theme changes; rearm the poll when its interval changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('claudeSemaphore')) { return; }
      poller.reconfigure();
      refresh('config');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeSemaphore.revealTerminal', (row: number | SessionState) => {
      const candidates = typeof row === 'number' ? observedSessions.filter(s => s.pid === row) : [row];
      if (candidates.length !== 1) return;
      const t = terminalBySession.get(sessionKey(candidates[0]));
      if (!t || t.exitStatus !== undefined) { return; }
      try { t.show(false); } catch { /* terminal vanished between lookup and show */ }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => refresh('terminalClosed')),
  );

  dbg('activated');
  refresh('activate');
}

export function deactivate(): void {
  /* subscriptions disposed by VS Code */
}
