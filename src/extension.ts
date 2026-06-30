import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionState, ThemeName, RawSessionFile } from './types';
import { buildSessions } from './sessionStore';
import { summarize } from './stateMapper';
import { styleFor } from './theme';
import { TitleResolver } from './titleResolver';
import { Notifier } from './notifier';
import { AfplaySoundPlayer } from './soundPlayer';

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

class SemaphoreTreeProvider implements vscode.TreeDataProvider<SessionState> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private sessions: SessionState[] = [];

  setSessions(sessions: SessionState[]): void {
    this.sessions = sessions;
    this.emitter.fire();
  }

  getChildren(): SessionState[] {
    return this.sessions;
  }

  getTreeItem(s: SessionState): vscode.TreeItem {
    const theme = currentTheme();
    const style = styleFor(theme, s.state);
    const label = { running: 'corriendo', needsInput: 'necesita atención', stopped: 'detenido' }[s.state];
    const item = new vscode.TreeItem(s.title, vscode.TreeItemCollapsibleState.None);
    item.description = label;
    item.tooltip = `${s.title}\n${s.cwd}\n${label}`;
    item.iconPath = style.colorId
      ? new vscode.ThemeIcon(style.icon, new vscode.ThemeColor(style.colorId))
      : new vscode.ThemeIcon(style.icon);
    return item;
  }
}

function currentTheme(): ThemeName {
  return vscode.workspace.getConfiguration('claudeSemaphore').get<ThemeName>('theme', 'classic');
}

const debugEnabled = (): boolean =>
  vscode.workspace.getConfiguration('claudeSemaphore').get<boolean>('debug', false);
const dbg = (msg: string): void => { if (debugEnabled()) { console.log(`[ClaudeSemaforo] ${msg}`); } };

export function activate(context: vscode.ExtensionContext): void {
  const tree = new SemaphoreTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('claudeSemaphore.sessions', tree),
  );

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

  let warnedSchema = false;
  let tickCount = 0;

  const refresh = (source: string): void => {
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

      tree.setSessions(sessions);
      notifier.update(sessions);

      const theme = currentTheme();
      const sum = summarize(sessions);
      const g = (state: 'running' | 'needsInput' | 'stopped') => styleFor(theme, state).summaryGlyph;
      statusBar.text = `${g('running')}${sum.running} ${g('needsInput')}${sum.needsInput} ${g('stopped')}${sum.stopped}`;
      statusBar.tooltip = 'Claude Semáforo — clic para ver las sesiones';
      dbg(`refresh #${seq} ok: files=${sessions.length} summary=${JSON.stringify(sum)}`);

      if (sawUnknownSchema && !warnedSchema) {
        warnedSchema = true;
        vscode.window.showWarningMessage(
          'Claude Semáforo: formato de sesión no reconocido — puede que Claude Code haya cambiado. Actualizá la extensión.',
        );
      }
    } catch (err) {
      console.error(`[ClaudeSemaforo] refresh #${seq} FAILED:`, err);
    }
  };

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
  const intervalMs = vscode.workspace.getConfiguration('claudeSemaphore').get<number>('pollIntervalMs', 2000);
  const pollMs = Math.max(500, intervalMs);
  dbg(`poll armed every ${pollMs}ms`);
  const timer = setInterval(() => refresh('poll'), pollMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Repaint when the theme setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeSemaphore')) { refresh('config'); }
    }),
  );

  dbg('activated');
  refresh('activate');
}

export function deactivate(): void {
  /* subscriptions disposed by VS Code */
}
