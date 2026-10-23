import * as vscode from 'vscode';
import * as path from 'path';
import { SessionState, ThemeName } from './types';
import { ViewOptions, ProjectGroup, defaultViewOptions, presentSessions, stateLabels } from './sessionPresentation';
import { persistentSessionKey, sessionKey } from './sessionIdentity';
import { styleFor } from './theme';
import { formatTooltip } from './tooltip';
export type TreeNode = ProjectGroup | SessionState;
export class SessionTree implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.emitter.event;
  private sessions: SessionState[] = []; private groups: ProjectGroup[] = [];
  private options = defaultViewOptions(); private favorites = new Set<string>(); private signature = '';
  private terminals = new Map<string | number, vscode.Terminal>();
  constructor(private readonly theme: () => ThemeName, private readonly changed?: () => void) {}
  setSessions(sessions: SessionState[], signature: string): void {
    this.sessions = sessions; this.groups = presentSessions(sessions, this.options, this.favorites);
    if (signature === this.signature) return; this.signature = signature; this.notify();
  }
  setTerminals(terminals: Map<string | number, vscode.Terminal>): void { this.terminals = terminals; }
  setView(options: ViewOptions, favorites: ReadonlySet<string>): void {
    this.options = options; this.favorites = new Set(favorites); this.signature = '';
    this.groups = presentSessions(this.sessions, options, favorites); this.notify();
  }
  private notify(): void { this.emitter.fire(); this.changed?.(); }
  get visibleCount(): number { return this.groups.reduce((n, g) => n + g.sessions.length, 0); }
  get totalCount(): number { return this.sessions.length; }
  get message(): string {
    const filters = [this.options.query && `«${this.options.query}»`, this.options.provider, this.options.state && stateLabels[this.options.state], this.options.favoritesOnly && 'favoritas'].filter(Boolean);
    if (!this.totalCount) return 'Sin sesiones activas. Inicia o recupera una sesión desde la barra.';
    return `${this.visibleCount}/${this.totalCount} sesiones${filters.length ? ` · filtro: ${filters.join(' · ')}` : ''}${!this.visibleCount ? ' · limpia los filtros para verlas.' : ''}`;
  }
  getChildren(element?: TreeNode): TreeNode[] {
    if (element) return 'kind' in element ? element.sessions : [];
    return this.options.grouped ? this.groups : this.groups.flatMap(g => g.sessions);
  }
  getTreeItem(node: TreeNode): vscode.TreeItem {
    if ('kind' in node) {
      const item = new vscode.TreeItem(path.basename(node.cwd) || node.cwd || 'Proyecto', vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.id; item.description = `${node.sessions.length} sesiones`;
      item.tooltip = node.cwd; item.iconPath = new vscode.ThemeIcon('folder'); item.contextValue = 'project'; return item;
    }
    const s = node; const favorite = this.favorites.has(persistentSessionKey(s));
    const item = new vscode.TreeItem(`${favorite ? '★ ' : ''}${s.title}`, vscode.TreeItemCollapsibleState.None);
    const label = `${stateLabels[s.state]}${s.duplicateTitle ? ` · pid ${s.pid}` : ''}`;
    const terminal = this.terminals.has(sessionKey(s)) || this.terminals.has(s.pid);
    const style = styleFor(this.theme(), s.state);
    item.id = sessionKey(s); item.description = `${s.provider === 'codex' ? 'Codex' : s.provider === 'opencode' ? 'OpenCode' : 'Claude'} · ${label}`;
    item.tooltip = formatTooltip(s, label, terminal);
    item.iconPath = new vscode.ThemeIcon(style.icon, style.colorId ? new vscode.ThemeColor(style.colorId) : undefined);
    item.contextValue = terminal ? 'sessionWithTerminal' : 'session';
    item.command = { command: terminal ? 'claudeSemaphore.revealTerminal' : 'claudeSemaphore.details', title: terminal ? 'Revelar terminal' : 'Ver información', arguments: [s] };
    return item;
  }
  dispose(): void { this.emitter.dispose(); }
}
