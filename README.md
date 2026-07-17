# Claude Semáforo

A VS Code extension that shows a traffic-light status for every live Claude Code session.

- 🟢 **running** — Claude is working
- 🟡 **needs input** — waiting for a permission/answer (plays a honk when VS Code is unfocused)
- 🔴 **stopped** — idle, doing nothing

Shows a list in the activity bar and a `🟢n 🟡n 🔴n` summary in the status bar.
Hover an amber row to see *why* it is waiting — a permission prompt, an open dialog.

Prefer it next to your files? Drag the **Sesiones** view onto the Explorer panel;
VS Code remembers where you put it.

## How it works

Reads the session-state files Claude Code already maintains under `~/.claude/sessions/`
and the per-session `aiTitle` from transcripts. **No hooks are installed**; it does not
modify your Claude Code config.

## Install (local .vsix)

1. `npm install && npm run build && npm run package`
2. In VS Code: Extensions → ⋯ → *Install from VSIX…* → pick the generated `claude-semaphore-<version>.vsix`.

## Settings

| Setting | Default | Notes |
|---|---|---|
| `claudeSemaphore.theme` | `classic` | `classic` / `colorblind` / `highContrast` |
| `claudeSemaphore.sound.enabled` | `true` | honk on yellow transition |
| `claudeSemaphore.sound.file` | (bundled honk) | custom sound path |
| `claudeSemaphore.pollIntervalMs` | `2000` | fallback poll interval |
| `claudeSemaphore.debug` | `false` | emit `[ClaudeSemaforo]` diagnostic logs to the extension host console |

## Limitations

Only sessions that write a state file under `~/.claude/sessions/<pid>.json` are listed.
Interactive Claude Code sessions do this; sessions launched through a gateway/bridge
(e.g. OpenClaw / codex-companion) run in a mode that does **not** persist that file, so
they expose no live status and will not appear in the panel. This is expected — the
extension is a pure reader and has nothing to read for those sessions.

Daemon-backed sessions (`kind: "bg"`, e.g. a forked session claimed from a background
spare) are listed too, but they run detached from a TTY, so terminal reveal may not be
available for them. When two live sessions resolve to the same title (typical after a
fork), each row shows its pid to tell them apart.

## Caveat

Reads undocumented internal Claude Code files; a future Claude Code release could change
their format. If that happens the extension shows a warning and the reader needs an update.
