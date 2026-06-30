# Claude Semaphore — VS Code Extension (Design Spec)

**Date:** 2026-06-30
**Status:** Approved design → ready for implementation plan

## Purpose

A VS Code extension that shows a traffic-light ("semáforo") status for every live
Claude Code session, so the user can tell at a glance which sessions are working,
which need human attention, and which are idle — across all open sessions.

Three states (user's definition):

- 🟢 **VERDE** — a process is running / Claude is working.
- 🟡 **AMARILLO** — the session needs human interaction (permission prompt, a
  question awaiting an answer).
- 🔴 **ROJO** — the session is stopped/idle, doing nothing.

The extension mirrors the sessions shown in Claude Code's native panel; it does
**not** (and cannot) recolor that native panel. It renders its own views.

## Data Source (no hooks)

Claude Code already maintains a live state file per interactive session:

```
~/.claude/sessions/<pid>.json
```

Example (verified 2026-06-30, Claude Code 2.1.196):

```json
{
  "pid": 21843,
  "sessionId": "025be0eb-7584-460b-b701-4fcf4cc153a2",
  "cwd": "/Users/macdenix/Library/CloudStorage/.../REPOSITORIOS",
  "name": "repositorios-75",
  "nameSource": "derived",
  "kind": "interactive",
  "status": "busy",
  "updatedAt": 1782839827684,
  "statusUpdatedAt": 1782839827684,
  "version": "2.1.196"
}
```

The `status` field is the live signal. Observed values: `busy`, `idle`. The
compiled CLI binary additionally contains the literals `needs_input`, `waiting`,
`blocked`, `paused` as session-status values (extracted from
`@anthropic-ai/claude-code/bin/claude.exe`), which map to the AMARILLO state.

**No hooks are installed.** The extension is a pure reader of files Claude Code
already writes. This keeps the `.vsix` self-contained and trivially shareable
(install → works; no mutation of `settings.json`).

### State mapping

| `status` value                      | Semaphore state | Notes |
|-------------------------------------|-----------------|-------|
| `busy`                              | 🟢 running      | confirmed live |
| `needs_input` / `waiting` / `blocked` | 🟡 needs-input | from binary enum; confirm live during testing |
| `idle` / `paused`                   | 🔴 stopped      | confirmed live (`idle`) |
| unknown / unmapped value            | 🔴 stopped (safe default) | log once for diagnosis |
| `pid` no longer alive               | dropped (session closed/crashed) | see liveness |

### Session title (row label)

The label shown per row should match Claude Code's native panel title, which is
the **last `aiTitle`** entry in the session transcript:

```
~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl
```

- `<cwd-encoded>` = the cwd with `/` and `.` and spaces replaced per Claude Code's
  scheme (the existing project directory names follow this; the extension derives
  the directory by matching `sessionId` rather than re-encoding the path, to avoid
  encoding-scheme drift).
- Read the **last** `aiTitle` by tailing the file (read the last ~64 KB, scan
  backwards for `"aiTitle"`), never reading the whole JSONL (can be 20+ MB).
- Cache per `sessionId`, keyed on transcript `mtime`; only re-read when `mtime`
  changes.
- Fallbacks, in order: `aiTitle` → `name` from the session json → `basename(cwd)`.

## Architecture

Single component: the VS Code extension. Internal units:

1. **`SessionStore`** — watches `~/.claude/sessions/` via `FileSystemWatcher`
   (+ a ~2 s poll as a cross-platform safety net). Parses each `<pid>.json`,
   verifies liveness (`process.kill(pid, 0)`), and maintains an in-memory
   `Map<sessionId, SessionState>`. Emits a change event (debounced ~150 ms) when
   the aggregate changes. Pure data; no UI dependency.

2. **`TitleResolver`** — given a `SessionState`, resolves the display title by
   tailing the transcript with mtime-keyed caching. Isolated and independently
   testable.

3. **`StateMapper`** — pure function `status → SemaphoreState`. The single source
   of truth for the mapping table above. Unit-tested in isolation.

4. **`ThemeProvider`** — maps `SemaphoreState → { color: ThemeColor, icon: codicon,
   glyph: emoji }` based on the selected theme. Each state has a distinct **shape**
   (not just color) so it is readable for colorblind users.

5. **`SemaphoreTreeProvider`** (`TreeDataProvider`) — the sidebar view. One row per
   session: colored/shaped icon + title + state text. Subscribes to `SessionStore`.

6. **`SummaryStatusBar`** (`StatusBarItem`) — bottom-bar summary, e.g.
   `🟢2 🟡1 🔴1`. Click → focuses/reveals the sidebar view. Subscribes to
   `SessionStore`.

7. **`Notifier`** — edge-detects transitions **into** AMARILLO (prev ≠ yellow,
   new = yellow) and plays a sound. See Sound below.

### Data flow

```
~/.claude/sessions/*.json  ──watch──▶ SessionStore ──┬──▶ StateMapper ──▶ ThemeProvider ──┬─▶ SemaphoreTreeProvider
                                          │           │                                   └─▶ SummaryStatusBar
                                          │           └──▶ Notifier (yellow-edge → sound)
                            TitleResolver ◀┘ (tail transcript, mtime cache)
```

## Theming (colorblind-aware)

Setting: `claudeSemaphore.theme` — enum, default `classic`.

| Theme        | running        | needs-input     | stopped        |
|--------------|----------------|-----------------|----------------|
| `classic`    | green `charts.green` | yellow `charts.yellow` | red `charts.red` |
| `colorblind` | blue `#0072B2` | orange `#E69F00` | vermillion `#D55E00` (Okabe-Ito) |
| `highContrast` | uses theme fg + bold glyph | — | — |

Every theme also assigns a **distinct codicon shape** per state, so state is never
conveyed by color alone:

- running → `sync~spin` (or `play`)
- needs-input → `warning`
- stopped → `primitive-square` (or `debug-stop`)

The theme abstraction is a lookup table, leaving room for user-defined custom
themes later (out of scope for v1).

## Sound (honk on yellow)

- Trigger: a session transitions **into** AMARILLO, detected by `Notifier`
  comparing previous vs new state in `SessionStore`.
- **Only fires when the VS Code window is not focused** (`vscode.window.state.focused === false`)
  — avoids honking when the user is already looking at the editor.
- **Never fires on initial load**: on first scan, `SessionStore` establishes a
  baseline; sounds only fire for transitions observed after the baseline.
- Dedupe: a given session won't honk again until it leaves the yellow state and
  re-enters it.
- Playback: spawn the OS audio player. macOS: `afplay <file>`. The player is
  pluggable so Linux (`paplay`/`aplay`) / Windows (PowerShell) can be added later;
  v1 targets macOS.
- Bundled asset: a `honk` sound shipped inside the `.vsix` (`media/honk.aiff`).
- Settings:
  - `claudeSemaphore.sound.enabled` (boolean, default `true`)
  - `claudeSemaphore.sound.file` (string path, default = bundled honk)
- Independent of peon-ping (which runs via Claude Code hooks); this honk is scoped
  only to the yellow transition.

## Settings summary

| Setting                          | Type    | Default        |
|----------------------------------|---------|----------------|
| `claudeSemaphore.theme`          | enum    | `classic`      |
| `claudeSemaphore.sound.enabled`  | boolean | `true`         |
| `claudeSemaphore.sound.file`     | string  | bundled honk   |
| `claudeSemaphore.pollIntervalMs` | number  | `2000`         |

## Liveness & robustness

- A `<pid>.json` whose `pid` is no longer alive (`process.kill(pid,0)` throws
  `ESRCH`) is treated as a closed/crashed session and dropped from the views.
- Idle/finished sessions keep their file (observed) and correctly show as 🔴.
- Schema-drift guard: on activation, `SessionStore` validates that parsed files
  contain the expected keys (`sessionId`, `status`, `cwd`, `pid`). If the shape is
  unrecognizable (Claude Code changed the format), show a single non-blocking
  warning ("Claude Semaphore: formato de sesión no reconocido — actualizá la
  extensión") instead of failing silently. This is the documented fallback point
  where a future hooks-based reader could be swapped in.

## Distribution

- Phase 1 (now): packaged as a local `.vsix` (`vsce package`), installed via
  "Install from VSIX…". Lives in its own git repo for sharing.
- Phase 2 (later, if it works well): the macOS menu-bar version (SwiftBar/xbar) —
  separate effort; the same `SessionStore` reading logic ports over.
- Publishing to the VS Code Marketplace / Open VSX is a later option; the
  extension code is unchanged, only the publish step is added.

## Testing

- **Unit:** `StateMapper` (every status value → expected state, incl. unknown);
  summary aggregation (`🟢n 🟡n 🔴n`); `Notifier` edge detection (no-fire on
  baseline, fire on transition, no re-fire while staying yellow, no-fire when
  focused); `TitleResolver` tail parsing on a fixture JSONL.
- **Manual:** open multiple real sessions; confirm 🟢/🔴 reflect busy/idle; force a
  permission prompt in one session and confirm it turns 🟡 **and** that the live
  `status` value is in the `needs_input`/`waiting`/`blocked` set (empirically
  confirms the binary-derived mapping); confirm honk fires only when VS Code is
  unfocused; toggle themes and verify colorblind shapes/palette.

## Out of scope (v1, YAGNI)

- Recoloring the native Claude Code panel (impossible).
- Programmatically focusing a specific session on click (no reliable API).
- Custom user-defined themes (the theme table leaves room for it).
- Non-macOS sound playback (player is pluggable; macOS first).
- Installing any Claude Code hooks (pure file reader).

## Key risk (accepted)

The extension reads **undocumented internal files** (`sessions/*.json` schema,
`aiTitle` in transcripts) that may change between Claude Code versions. Mitigated
by the schema-drift guard and the documented hooks-based fallback. Accepted because
this is a personal tool that mirrors the native panel, and these files give all
three states plus the real title with zero installation friction.
