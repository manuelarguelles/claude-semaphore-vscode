# 1.0.0

- Add local Codex session monitoring alongside Claude: provider labels, separate session rows, explicit unknown status, and bounded incremental reads.
- Fix detection of TUI user sessions now recorded with `source: "vscode"` and `originator: "codex-tui"`; exclude other origins and subagent threads.
- Reveal matching terminals through process ancestry and reject ambiguous folder matches.
- Document limitations for unrecorded permission prompts and asynchronous/nested questions.

# 1.0.0-rc.2

- Recognize live Codex TUI user sessions recorded as `source: "vscode"`, while excluding other origins and subagent threads.
- Add regression coverage for metadata compatibility and appended lifecycle events.

# 1.0.0-rc.1

- Add local Codex CLI rollout discovery and bounded incremental state reads alongside Claude.
- Add provider labels, unique session row identities, and explicit unknown status.
- Link terminals through process ancestors and reject ambiguous folder matches.
- Keep Claude available when Codex discovery fails; add `claudeSemaphore.codex.enabled`.
- Prevent overlapping refreshes and avoid updates after disposal.
- Document best-effort status, unsupported unrecorded approvals/async questions, and release acceptance gates.

# Changelog

## 0.3.0

### Added

- **Amber rows now say why.** Claude Code records the reason a session is waiting
  (`permission prompt`, `dialog open`, `input needed`); the row tooltip shows it.
  No more guessing which of your amber sessions is the one blocking on a permission.

### Fixed

- **Tooltips are readable.** The panel repainted every 2 seconds even when nothing
  had changed, and each repaint dismissed the tooltip you were reading — hovering a
  row felt like it needed pixel-perfect aim. It now repaints only when a row would
  actually look different.
- **`claudeSemaphore.pollIntervalMs` takes effect immediately.** The interval was
  read once at startup, so changing the setting did nothing until you reloaded the
  window.

## 0.2.0

- Forked sessions (`kind: "bg"`, claimed from a daemon spare) are listed instead of
  hidden; rows sharing a title show their pid to disambiguate.
- Click a row to reveal its terminal (matched by process tree, with a cwd fallback).
  Rows without a terminal in the current window say so.

## 0.1.0

- Initial release: traffic-light status per live Claude Code session, in a tree view
  and a status-bar summary, with a honk when a session turns amber while VS Code is
  unfocused. Colorblind and high-contrast themes.
