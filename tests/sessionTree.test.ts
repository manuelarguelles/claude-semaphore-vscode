import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire = vi.fn(); dispose() {} },
  TreeItem: class { constructor(public label: string, public collapsibleState: number) {} },
  ThemeIcon: class { constructor(public id: string, public color?: unknown) {} }, ThemeColor: class { constructor(public id: string) {} },
  TreeItemCollapsibleState: { None: 0, Expanded: 2 },
}));
import { SessionTree } from '../src/sessionTree';
import { defaultViewOptions } from '../src/sessionPresentation';
import { persistentSessionKey } from '../src/sessionIdentity';
import { SessionState } from '../src/types';
const a: SessionState = { provider: 'claude', sessionId: 'a', pid: 1, cwd: '/one/app', title: 'Databricks', state: 'needsInput' };
const b: SessionState = { ...a, sessionId: 'b', cwd: '/two/app', state: 'stopped' };
describe('native session tree', () => {
  it('groups filtered sessions and reports visible/total independently', () => {
    const tree = new SessionTree(() => 'classic'); tree.setSessions([a, b], 'initial');
    expect(tree.getChildren()).toHaveLength(2);
    const group = tree.getChildren()[0]; expect(tree.getChildren(group)).toEqual([a]);
    tree.setView({ ...defaultViewOptions(), state: 'needsInput' }, new Set());
    expect(tree.visibleCount).toBe(1); expect(tree.totalCount).toBe(2);
    expect(tree.getChildren()).toHaveLength(1);
    tree.setView({ ...defaultViewOptions(), query: 'absent' }, new Set());
    expect(tree.getChildren()).toEqual([]); expect(tree.message).toMatch(/filtro/i);
  });
  it('retains click details without a terminal and displays persistent favorites', () => {
    const tree = new SessionTree(() => 'classic'); tree.setSessions([a], 'initial');
    tree.setView({ ...defaultViewOptions(), grouped: false }, new Set([persistentSessionKey(a)]));
    expect(tree.getChildren()).toEqual([a]);
    expect(tree.getTreeItem(a).command?.command).toBe('claudeSemaphore.details');
    expect(tree.getTreeItem(a).label).toContain('★');
    tree.setTerminals(new Map([[1, {} as any]]));
    expect(tree.getTreeItem(a).command?.command).toBe('claudeSemaphore.revealTerminal');
  });
});
