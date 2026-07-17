import { SessionState } from './types';

// Control chars: they cannot appear in a title, cwd or state, so no value can
// straddle a boundary and forge a match against a different row.
const FIELD_SEP = '\u0001';
const ROW_SEP = '\u0002';

/**
 * Everything a row actually paints, flattened to a string.
 *
 * The tree is rebuilt on every poll, and rebuilding a row dismisses any tooltip
 * the user is reading. Comparing signatures lets us skip the repaint when the
 * panel would look identical anyway.
 *
 * Only render inputs belong here: adding a field the row never shows would
 * bring the needless repaints back.
 */
export function renderSignature(
  sessions: SessionState[],
  terminalPids: Set<number>,
  theme: string,
): string {
  const rows = sessions.map((s) =>
    [
      s.pid,
      s.title,
      s.cwd,
      s.state,
      s.waitingFor ?? '',
      s.duplicateTitle ? 1 : 0,
      terminalPids.has(s.pid) ? 1 : 0,
    ].join(FIELD_SEP),
  );
  return [theme, ...rows].join(ROW_SEP);
}
