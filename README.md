# Claude + Codex Semáforo

A VS Code extension that shows a traffic-light status for live Claude Code and local Codex CLI sessions.

- 🟢 **running** — the last observed event indicates work is in progress
- 🟡 **needs input** — waiting for a permission/answer (plays a honk when VS Code is unfocused)
- 🔴 **stopped** — idle, doing nothing

- ⚪ **unknown** — Codex state cannot be determined from available events

Shows a list in the activity bar and a `🟢n 🟡n 🔴n` summary in the status bar.
Each row identifies its provider, **Claude** or **Codex**.
Hover an amber row to see *why* it is waiting — a permission prompt, an open dialog.

Prefer it next to your files? Drag the **Sesiones** view onto the Explorer panel;
VS Code remembers where you put it.

## Release status

**1.0.0** adds local Codex monitoring alongside Claude, including TUI user sessions
now recorded with `source: "vscode"`. Automated verification and local in-editor
session visibility have passed. Existing extension ID and settings are preserved.
Codex colors reflect recorded events; see the limitations below for permissions
and questions that are not recorded.

## How it works

Reads the session-state files Claude Code already maintains under `~/.claude/sessions/`
and the per-session `aiTitle` from transcripts. **No hooks are installed**; it does not
modify your Claude Code config.

For Codex, a single asynchronous `lsof` discovery runs at most every 10 seconds.
Only writable `rollout-*.jsonl` descriptors belonging to Codex-named processes are
considered. Metadata must identify a main user session: legacy `source: "cli"`,
or `source: "vscode"` with `originator: "codex-tui"`. When present, `thread_source`
must be `"user"`. Other IDE/gateway origins and subagent histories are excluded. This metadata
identifies the session's origin, not necessarily the UI currently displaying it.

Events are read asynchronously with a 1 MiB per-file budget. After the initial
bounded tail, only appended bytes are read. Partial lines are retained, closed
sessions are pruned, and no transcript text is printed or transmitted.
Codex rows use the project folder and a short session ID; sessions sharing a PID
remain separate rows. Terminal reveal follows up to 12 parent processes, including
Node wrappers. Folder fallback is allowed only when it identifies one terminal.

Codex support requires **macOS or Linux with `lsof` on PATH** (tested on macOS with
Codex CLI 0.154.0 and TUI/app-server sessions from 0.160.0–0.160.1). Windows shows a warning and continues displaying Claude.

## Install (local .vsix)

1. `npm install && npm run build && npm run package`
2. In VS Code: Extensions → ⋯ → *Install from VSIX…* → pick the generated `claude-semaphore-<version>.vsix`.

## Settings

| Setting | Default | Notes |
|---|---|---|
| `claudeSemaphore.codex.enabled` | `true` | show local Codex CLI sessions; no restart needed |
| `claudeSemaphore.theme` | `classic` | `classic` / `colorblind` / `highContrast` |
| `claudeSemaphore.sound.enabled` | `true` | honk on yellow transition |
| `claudeSemaphore.sound.file` | (bundled honk) | custom sound path |
| `claudeSemaphore.pollIntervalMs` | `2000` | fallback poll interval |
| `claudeSemaphore.debug` | `false` | emit `[ClaudeSemaforo]` diagnostic logs to the extension host console |

## Limitations

For **Claude**, only sessions that write a state file under `~/.claude/sessions/<pid>.json` are listed.
Interactive Claude Code sessions do this; sessions launched through a gateway/bridge
(e.g. OpenClaw / codex-companion) run in a mode that does **not** persist that file, so
they expose no live status and will not appear in the panel. This is expected — the
extension is a pure reader and has nothing to read for those sessions.

Daemon-backed sessions (`kind: "bg"`, e.g. a forked session claimed from a background
spare) are listed too, but they run detached from a TTY, so terminal reveal may not be
available for them. When two live sessions resolve to the same title (typical after a
fork), each row shows its pid to tell them apart.

### Codex state semantics and limits

- `task_started` → green; `task_complete` or `turn_aborted` → red.
- A directly recorded synchronous `request_user_input` tool call → yellow until its matching output arrives. Turn completion or interruption clears it.
- Other tool calls indicate activity; reasoning can establish activity when the initial tail lacks the start event. Green means **observed activity**, not proof that the CLI is currently computing.
- Permission prompts are not reliably persisted in rollout files. An unrecorded approval dialog can remain green. Questions expressed in assistant text, calls nested inside code-mode scripts, and `request_user_input_async` are **not detected**. Async requests return before the user answers, so treating their tool output as an answer would be misleading.
- There is no timeout heuristic that turns an idle file yellow. Long-running tools may legitimately write nothing.
- A first read or a gap larger than 1 MiB resets state to unknown until a recognized event is found. Closed files disappear on the next discovery, within approximately 10 seconds plus the poll interval.
- A missing `lsof` or discovery failure leaves Claude available and displays a warning. Codex can be disabled independently in Settings.
- Rollout parsing is best-effort against internal formats, not an official live-status API. **Do not use colors to decide whether it is safe to terminate a session.**

## Update without interrupting work

Build/package now and install the VSIX when ready. If VS Code requests a window
reload, defer it until active terminal jobs are finished. No installer, hooks,
terminal commands, session termination, or automatic reload is performed by the extension.

## Development verification

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
npm run smoke:codex  # optional: read-only check of live local Codex sessions
npm run package
```

Use a separate VS Code Extension Development Host (`--extensionDevelopmentPath`)
to inspect the panel without reloading a working window. For further live acceptance,
verify mixed-provider labels, terminal reveal with multiple same-folder sessions,
unknown state, and a live synchronous input request transitioning yellow and back.

## Caveat

Reads undocumented internal Claude Code files; a future Claude Code release could change
their format. If that happens the extension shows a warning and the reader needs an update.
