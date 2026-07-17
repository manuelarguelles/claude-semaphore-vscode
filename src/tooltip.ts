import { SessionState } from './types';

/**
 * Tooltip text for a session row. Kept free of vscode imports so it stays testable.
 * The reason is only meaningful while a session waits, so a stale one is dropped.
 */
export function formatTooltip(s: SessionState, label: string, hasTerminal: boolean): string {
  const reason = s.state === 'needsInput' && s.waitingFor ? ` — ${s.waitingFor}` : '';
  const lines = [s.title, s.cwd, `${label}${reason}`];
  if (!hasTerminal) {
    lines.push('(sin terminal en esta ventana)');
  }
  return lines.join('\n');
}
