# Claude Semáforo

A VS Code extension that shows a traffic-light status for every live Claude Code session.

- 🟢 **running** — Claude is working
- 🟡 **needs input** — waiting for a permission/answer (plays a honk when VS Code is unfocused)
- 🔴 **stopped** — idle, doing nothing

Shows a list in the activity bar and a `🟢n 🟡n 🔴n` summary in the status bar.

## How it works

Reads the session-state files Claude Code already maintains under `~/.claude/sessions/`
and the per-session `aiTitle` from transcripts. **No hooks are installed**; it does not
modify your Claude Code config.

## Install (local .vsix)

1. `npm install && npm run build && npm run package`
2. In VS Code: Extensions → ⋯ → *Install from VSIX…* → pick `claude-semaphore-0.1.0.vsix`.

## Settings

| Setting | Default | Notes |
|---|---|---|
| `claudeSemaphore.theme` | `classic` | `classic` / `colorblind` / `highContrast` |
| `claudeSemaphore.sound.enabled` | `true` | honk on yellow transition |
| `claudeSemaphore.sound.file` | (bundled honk) | custom sound path |
| `claudeSemaphore.pollIntervalMs` | `2000` | fallback poll interval |

## Caveat

Reads undocumented internal Claude Code files; a future Claude Code release could change
their format. If that happens the extension shows a warning and the reader needs an update.
