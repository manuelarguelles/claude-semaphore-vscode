# Claude Semaphore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension that shows a traffic-light status (running / needs-input / stopped) for every live Claude Code session, in a sidebar list plus a status-bar summary, with switchable themes (incl. colorblind) and a honk when a session needs attention.

**Architecture:** Pure reader of files Claude Code already maintains (`~/.claude/sessions/*.json` for live status; transcript `aiTitle` for the title). No hooks installed. Pure logic modules (mapping, title tailing, theme, notifier edge-detection, session building) are unit-tested in Node via vitest; thin VS Code adapters (tree view, status bar, fs watcher) are wired in `extension.ts` and verified manually in the Extension Development Host.

**Tech Stack:** TypeScript, VS Code Extension API (`engines.vscode ^1.85.0`), esbuild (bundle), vitest (unit tests), `@vscode/vsce` (packaging). macOS `afplay` for sound.

## Global Constraints

- Project root: `~/clawd/projects/claude-semaphore-vscode` (its own git repo, already `git init`'d).
- No Claude/AI attribution in any commit, file, or doc. Author is Manuel Arguelles.
- Commit messages in English, concise.
- Never install Claude Code hooks and never modify `~/.claude/settings.json`.
- Never read a whole transcript `.jsonl` (can be 20+ MB) — only tail the last 64 KB.
- State enum is exactly: `'running' | 'needsInput' | 'stopped'`.
- Status mapping (verbatim): `busy`→running; `needs_input`/`waiting`/`blocked`→needsInput; `idle`/`paused`→stopped; unknown→stopped.
- Colorblind palette is Okabe-Ito: running `#0072B2`, needsInput `#E69F00`, stopped `#D55E00`.
- Sound fires only on a transition **into** needsInput, only when the VS Code window is **not** focused, never on the initial baseline scan, and not again while staying yellow.
- Target platform for sound: macOS first (`afplay`); the player is injectable for later platforms.

---

### Task 1: Scaffold + types + StateMapper

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.js`, `.vscodeignore`
- Create: `src/types.ts`
- Create: `src/stateMapper.ts`
- Test: `tests/stateMapper.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SemaphoreState`, `RawSessionFile`, `SessionState`, `Summary`, `ThemeName` (types); `mapStatus(status: string): SemaphoreState`; `summarize(sessions: SessionState[]): Summary`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-semaphore",
  "displayName": "Claude Semáforo",
  "description": "Traffic-light status for every live Claude Code session.",
  "version": "0.1.0",
  "publisher": "manuelarguelles",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "test": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^2.24.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "outDir": "out",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "tests"],
  "exclude": ["node_modules", "out"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `esbuild.js`**

```js
const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
};

if (watch) {
  esbuild.context(opts).then((ctx) => ctx.watch());
} else {
  esbuild.build(opts).catch(() => process.exit(1));
}
```

- [ ] **Step 5: Create `.vscodeignore`**

```
src/**
tests/**
docs/**
node_modules/**
.gitignore
esbuild.js
tsconfig.json
vitest.config.ts
**/*.map
```

- [ ] **Step 6: Create `src/types.ts`**

```ts
export type SemaphoreState = 'running' | 'needsInput' | 'stopped';

export type ThemeName = 'classic' | 'colorblind' | 'highContrast';

export interface RawSessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  status: string;
  name?: string;
  kind?: string;
  statusUpdatedAt?: number;
}

export interface SessionState {
  sessionId: string;
  pid: number;
  cwd: string;
  title: string;
  state: SemaphoreState;
}

export interface Summary {
  running: number;
  needsInput: number;
  stopped: number;
}
```

- [ ] **Step 7: Write the failing test `tests/stateMapper.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mapStatus, summarize } from '../src/stateMapper';
import { SessionState } from '../src/types';

describe('mapStatus', () => {
  it('maps busy to running', () => expect(mapStatus('busy')).toBe('running'));
  it('maps needs_input/waiting/blocked to needsInput', () => {
    expect(mapStatus('needs_input')).toBe('needsInput');
    expect(mapStatus('waiting')).toBe('needsInput');
    expect(mapStatus('blocked')).toBe('needsInput');
  });
  it('maps idle/paused to stopped', () => {
    expect(mapStatus('idle')).toBe('stopped');
    expect(mapStatus('paused')).toBe('stopped');
  });
  it('maps unknown values to stopped', () => expect(mapStatus('wat')).toBe('stopped'));
});

describe('summarize', () => {
  it('counts each state', () => {
    const s: SessionState[] = [
      { sessionId: 'a', pid: 1, cwd: '/x', title: 'a', state: 'running' },
      { sessionId: 'b', pid: 2, cwd: '/x', title: 'b', state: 'running' },
      { sessionId: 'c', pid: 3, cwd: '/x', title: 'c', state: 'needsInput' },
      { sessionId: 'd', pid: 4, cwd: '/x', title: 'd', state: 'stopped' },
    ];
    expect(summarize(s)).toEqual({ running: 2, needsInput: 1, stopped: 1 });
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm install && npx vitest run tests/stateMapper.test.ts`
Expected: FAIL — cannot find module `../src/stateMapper`.

- [ ] **Step 9: Create `src/stateMapper.ts`**

```ts
import { SemaphoreState, SessionState, Summary } from './types';

const STATUS_MAP: Record<string, SemaphoreState> = {
  busy: 'running',
  needs_input: 'needsInput',
  waiting: 'needsInput',
  blocked: 'needsInput',
  idle: 'stopped',
  paused: 'stopped',
};

export function mapStatus(status: string): SemaphoreState {
  return STATUS_MAP[status] ?? 'stopped';
}

export function summarize(sessions: SessionState[]): Summary {
  const out: Summary = { running: 0, needsInput: 0, stopped: 0 };
  for (const s of sessions) {
    out[s.state]++;
  }
  return out;
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run tests/stateMapper.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Scaffold extension project and add state mapper"
```

---

### Task 2: TitleResolver (tail transcript for last aiTitle)

**Files:**
- Create: `src/titleResolver.ts`
- Test: `tests/titleResolver.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `extractLastAiTitle(text: string): string | undefined`; `class TitleResolver` with `resolve(transcriptPath: string, fallback: string): string`.

- [ ] **Step 1: Write the failing test `tests/titleResolver.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { extractLastAiTitle } from '../src/titleResolver';

describe('extractLastAiTitle', () => {
  it('returns the last aiTitle across multiple lines', () => {
    const text = [
      '{"type":"user","aiTitle":"First title"}',
      '{"type":"assistant","content":"hi"}',
      '{"type":"user","aiTitle":"Latest title"}',
    ].join('\n');
    expect(extractLastAiTitle(text)).toBe('Latest title');
  });

  it('ignores a truncated first line (from tailing mid-file)', () => {
    const text = [
      'tatus":"busy"}',                          // garbage partial line
      '{"type":"user","aiTitle":"Good title"}',
    ].join('\n');
    expect(extractLastAiTitle(text)).toBe('Good title');
  });

  it('returns undefined when no aiTitle present', () => {
    expect(extractLastAiTitle('{"type":"user"}')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/titleResolver.test.ts`
Expected: FAIL — cannot find module `../src/titleResolver`.

- [ ] **Step 3: Create `src/titleResolver.ts`**

```ts
import * as fs from 'fs';

export function extractLastAiTitle(text: string): string | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"aiTitle"')) {
      continue;
    }
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.aiTitle === 'string' && obj.aiTitle.length > 0) {
        return obj.aiTitle;
      }
    } catch {
      // truncated/partial line from tailing mid-file; skip
    }
  }
  return undefined;
}

function readTail(path: string, maxBytes: number): string {
  const fd = fs.openSync(path, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

interface CacheEntry {
  mtimeMs: number;
  title: string;
}

export class TitleResolver {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readFileTail: (path: string, maxBytes: number) => string = readTail,
    private statFn: (path: string) => { mtimeMs: number } = fs.statSync,
  ) {}

  resolve(transcriptPath: string, fallback: string): string {
    let mtimeMs: number;
    try {
      mtimeMs = this.statFn(transcriptPath).mtimeMs;
    } catch {
      return fallback;
    }
    const cached = this.cache.get(transcriptPath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.title;
    }
    const title = extractLastAiTitle(this.readFileTail(transcriptPath, 64 * 1024)) ?? fallback;
    this.cache.set(transcriptPath, { mtimeMs, title });
    return title;
  }
}
```

- [ ] **Step 4: Add caching test to `tests/titleResolver.test.ts`**

```ts
import { TitleResolver } from '../src/titleResolver';

describe('TitleResolver caching', () => {
  it('re-reads only when mtime changes', () => {
    let reads = 0;
    let mtime = 100;
    const tail = () => { reads++; return '{"aiTitle":"T"}'; };
    const stat = () => ({ mtimeMs: mtime });
    const r = new TitleResolver(tail, stat);
    expect(r.resolve('/x.jsonl', 'fb')).toBe('T');
    expect(r.resolve('/x.jsonl', 'fb')).toBe('T'); // cached
    expect(reads).toBe(1);
    mtime = 200;
    expect(r.resolve('/x.jsonl', 'fb')).toBe('T'); // mtime changed → re-read
    expect(reads).toBe(2);
  });

  it('returns fallback when stat throws (missing file)', () => {
    const r = new TitleResolver(() => '', () => { throw new Error('nofile'); });
    expect(r.resolve('/missing.jsonl', 'fallback-name')).toBe('fallback-name');
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/titleResolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add title resolver that tails transcript for last aiTitle"
```

---

### Task 3: ThemeProvider (color + shape per state)

**Files:**
- Create: `src/theme.ts`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Consumes: `SemaphoreState`, `ThemeName` from `src/types.ts`.
- Produces: `interface StateStyle { colorId?: string; icon: string; summaryGlyph: string }`; `styleFor(theme: ThemeName, state: SemaphoreState): StateStyle`.

- [ ] **Step 1: Write the failing test `tests/theme.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { styleFor } from '../src/theme';

describe('styleFor', () => {
  it('classic uses emoji glyphs and classic color ids', () => {
    expect(styleFor('classic', 'running')).toEqual({
      colorId: 'claudeSemaphore.classic.running',
      icon: 'sync~spin',
      summaryGlyph: '🟢',
    });
    expect(styleFor('classic', 'needsInput').summaryGlyph).toBe('🟡');
    expect(styleFor('classic', 'stopped').summaryGlyph).toBe('🔴');
  });

  it('colorblind uses codicon glyphs and colorblind color ids', () => {
    const s = styleFor('colorblind', 'needsInput');
    expect(s.colorId).toBe('claudeSemaphore.colorblind.needsInput');
    expect(s.icon).toBe('warning');
    expect(s.summaryGlyph).toBe('$(warning)');
  });

  it('every state has a distinct icon shape', () => {
    const icons = (['running', 'needsInput', 'stopped'] as const).map((st) => styleFor('classic', st).icon);
    expect(new Set(icons).size).toBe(3);
  });

  it('highContrast has no colorId and uses codicon glyph', () => {
    const s = styleFor('highContrast', 'stopped');
    expect(s.colorId).toBeUndefined();
    expect(s.summaryGlyph).toBe('$(circle-large-filled)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/theme.test.ts`
Expected: FAIL — cannot find module `../src/theme`.

- [ ] **Step 3: Create `src/theme.ts`**

```ts
import { SemaphoreState, ThemeName } from './types';

export interface StateStyle {
  colorId?: string;
  icon: string;
  summaryGlyph: string;
}

const ICONS: Record<SemaphoreState, string> = {
  running: 'sync~spin',
  needsInput: 'warning',
  stopped: 'circle-large-filled',
};

const EMOJI: Record<SemaphoreState, string> = {
  running: '🟢',
  needsInput: '🟡',
  stopped: '🔴',
};

export function styleFor(theme: ThemeName, state: SemaphoreState): StateStyle {
  const icon = ICONS[state];
  if (theme === 'highContrast') {
    return { colorId: undefined, icon, summaryGlyph: `$(${icon})` };
  }
  return {
    colorId: `claudeSemaphore.${theme}.${state}`,
    icon,
    summaryGlyph: theme === 'colorblind' ? `$(${icon})` : EMOJI[state],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add theme provider with colorblind palette and distinct shapes"
```

---

### Task 4: Notifier (honk on yellow transition) + SoundPlayer

**Files:**
- Create: `src/notifier.ts`
- Create: `src/soundPlayer.ts`
- Test: `tests/notifier.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `SemaphoreState` from `src/types.ts`.
- Produces: `interface SoundPlayer { play(file: string): void }`; `interface NotifierDeps { player: SoundPlayer; isWindowFocused: () => boolean; isEnabled: () => boolean; soundFile: () => string }`; `class Notifier` with `update(sessions: SessionState[]): void`; `class AfplaySoundPlayer implements SoundPlayer`.

- [ ] **Step 1: Write the failing test `tests/notifier.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Notifier, SoundPlayer } from '../src/notifier';
import { SessionState, SemaphoreState } from '../src/types';

function sess(id: string, state: SemaphoreState): SessionState {
  return { sessionId: id, pid: 1, cwd: '/x', title: id, state };
}

class FakePlayer implements SoundPlayer {
  public plays = 0;
  play(): void { this.plays++; }
}

describe('Notifier', () => {
  let player: FakePlayer;
  let focused: boolean;
  let enabled: boolean;
  let n: Notifier;

  beforeEach(() => {
    player = new FakePlayer();
    focused = false;
    enabled = true;
    n = new Notifier({
      player,
      isWindowFocused: () => focused,
      isEnabled: () => enabled,
      soundFile: () => '/honk.aiff',
    });
  });

  it('does not honk on the initial baseline scan', () => {
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(0);
  });

  it('honks on a transition into needsInput', () => {
    n.update([sess('a', 'running')]);      // baseline
    n.update([sess('a', 'needsInput')]);   // transition
    expect(player.plays).toBe(1);
  });

  it('does not re-honk while staying needsInput', () => {
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(1);
  });

  it('honks again after leaving and re-entering needsInput', () => {
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(2);
  });

  it('does not honk when the window is focused', () => {
    focused = true;
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(0);
  });

  it('does not honk when sound is disabled', () => {
    enabled = false;
    n.update([sess('a', 'running')]);
    n.update([sess('a', 'needsInput')]);
    expect(player.plays).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notifier.test.ts`
Expected: FAIL — cannot find module `../src/notifier`.

- [ ] **Step 3: Create `src/notifier.ts`**

```ts
import { SemaphoreState, SessionState } from './types';

export interface SoundPlayer {
  play(file: string): void;
}

export interface NotifierDeps {
  player: SoundPlayer;
  isWindowFocused: () => boolean;
  isEnabled: () => boolean;
  soundFile: () => string;
}

export class Notifier {
  private prev = new Map<string, SemaphoreState>();
  private baselineSet = false;

  constructor(private deps: NotifierDeps) {}

  update(sessions: SessionState[]): void {
    const current = new Map<string, SemaphoreState>(
      sessions.map((s) => [s.sessionId, s.state]),
    );
    if (this.baselineSet) {
      for (const [id, state] of current) {
        if (state === 'needsInput' && this.prev.get(id) !== 'needsInput') {
          this.maybeHonk();
        }
      }
    }
    this.prev = current;
    this.baselineSet = true;
  }

  private maybeHonk(): void {
    if (!this.deps.isEnabled()) { return; }
    if (this.deps.isWindowFocused()) { return; }
    this.deps.player.play(this.deps.soundFile());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notifier.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Create `src/soundPlayer.ts`**

```ts
import { spawn } from 'child_process';
import { SoundPlayer } from './notifier';

/** macOS audio player. Fire-and-forget; failures are swallowed. */
export class AfplaySoundPlayer implements SoundPlayer {
  play(file: string): void {
    try {
      const child = spawn('afplay', [file], { stdio: 'ignore', detached: true });
      child.on('error', () => { /* afplay unavailable; ignore */ });
      child.unref();
    } catch {
      /* ignore */
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add yellow-transition notifier and macOS sound player"
```

---

### Task 5: SessionStore core (build sessions, liveness, schema guard)

**Files:**
- Create: `src/sessionStore.ts`
- Test: `tests/sessionStore.test.ts`

**Interfaces:**
- Consumes: `RawSessionFile`, `SessionState` from `src/types.ts`; `mapStatus` from `src/stateMapper.ts`.
- Produces: `isValidRaw(raw: unknown): raw is RawSessionFile`; `interface StoreDeps { listSessionFiles: () => { path: string; raw: unknown }[]; isAlive: (pid: number) => boolean; resolveTitle: (raw: RawSessionFile) => string }`; `buildSessions(deps: StoreDeps): { sessions: SessionState[]; sawUnknownSchema: boolean }`.

- [ ] **Step 1: Write the failing test `tests/sessionStore.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildSessions, isValidRaw, StoreDeps } from '../src/sessionStore';

function deps(files: { path: string; raw: unknown }[], alivePids: number[]): StoreDeps {
  return {
    listSessionFiles: () => files,
    isAlive: (pid) => alivePids.includes(pid),
    resolveTitle: (raw) => raw.name ?? raw.cwd,
  };
}

const base = { pid: 1, sessionId: 's1', cwd: '/repo/one', status: 'busy', name: 'One', kind: 'interactive' };

describe('isValidRaw', () => {
  it('accepts a well-formed session file', () => expect(isValidRaw(base)).toBe(true));
  it('rejects objects missing required keys', () => {
    expect(isValidRaw({ pid: 1 })).toBe(false);
    expect(isValidRaw(null)).toBe(false);
  });
});

describe('buildSessions', () => {
  it('maps live interactive sessions to SessionState', () => {
    const { sessions } = buildSessions(deps([{ path: 'a', raw: base }], [1]));
    expect(sessions).toEqual([
      { sessionId: 's1', pid: 1, cwd: '/repo/one', title: 'One', state: 'running' },
    ]);
  });

  it('drops sessions whose pid is not alive', () => {
    const { sessions } = buildSessions(deps([{ path: 'a', raw: base }], []));
    expect(sessions).toHaveLength(0);
  });

  it('skips non-interactive sessions', () => {
    const bg = { ...base, kind: 'background' };
    const { sessions } = buildSessions(deps([{ path: 'a', raw: bg }], [1]));
    expect(sessions).toHaveLength(0);
  });

  it('flags unknown schema and skips the bad file', () => {
    const { sessions, sawUnknownSchema } = buildSessions(
      deps([{ path: 'a', raw: { foo: 'bar' } }], [1]),
    );
    expect(sessions).toHaveLength(0);
    expect(sawUnknownSchema).toBe(true);
  });

  it('sorts sessions by title', () => {
    const f = [
      { path: 'a', raw: { ...base, sessionId: 's2', name: 'Zebra', pid: 2 } },
      { path: 'b', raw: { ...base, sessionId: 's1', name: 'Apple', pid: 1 } },
    ];
    const { sessions } = buildSessions(deps(f, [1, 2]));
    expect(sessions.map((s) => s.title)).toEqual(['Apple', 'Zebra']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sessionStore.test.ts`
Expected: FAIL — cannot find module `../src/sessionStore`.

- [ ] **Step 3: Create `src/sessionStore.ts`**

```ts
import { RawSessionFile, SessionState } from './types';
import { mapStatus } from './stateMapper';

export function isValidRaw(raw: unknown): raw is RawSessionFile {
  if (!raw || typeof raw !== 'object') { return false; }
  const r = raw as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.status === 'string' &&
    typeof r.cwd === 'string' &&
    typeof r.pid === 'number'
  );
}

export interface StoreDeps {
  listSessionFiles: () => { path: string; raw: unknown }[];
  isAlive: (pid: number) => boolean;
  resolveTitle: (raw: RawSessionFile) => string;
}

export function buildSessions(deps: StoreDeps): { sessions: SessionState[]; sawUnknownSchema: boolean } {
  const sessions: SessionState[] = [];
  let sawUnknownSchema = false;

  for (const { raw } of deps.listSessionFiles()) {
    if (!isValidRaw(raw)) {
      sawUnknownSchema = true;
      continue;
    }
    if (raw.kind && raw.kind !== 'interactive') { continue; }
    if (!deps.isAlive(raw.pid)) { continue; }
    sessions.push({
      sessionId: raw.sessionId,
      pid: raw.pid,
      cwd: raw.cwd,
      title: deps.resolveTitle(raw),
      state: mapStatus(raw.status),
    });
  }

  sessions.sort((a, b) => a.title.localeCompare(b.title));
  return { sessions, sawUnknownSchema };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sessionStore.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all tests across the 4 test files green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add session store core with liveness filter and schema guard"
```

---

### Task 6: VS Code integration (manifest contributes + extension wiring)

**Files:**
- Modify: `package.json` (add `contributes` block)
- Create: `src/extension.ts`
- Create: `media/icon.svg` (activity-bar icon)

**Interfaces:**
- Consumes: `buildSessions`, `StoreDeps` (Task 5); `TitleResolver` (Task 2); `styleFor` (Task 3); `Notifier`, `AfplaySoundPlayer` (Task 4); `summarize` (Task 1); types (Task 1).
- Produces: extension `activate(context)` entry point; no exports consumed by later code tasks (Task 7 only packages).

- [ ] **Step 1: Add the `contributes` block to `package.json`**

Insert this top-level key (sibling of `"main"`):

```json
"activationEvents": ["onStartupFinished"],
"contributes": {
  "viewsContainers": {
    "activitybar": [
      { "id": "claudeSemaphore", "title": "Claude Semáforo", "icon": "media/icon.svg" }
    ]
  },
  "views": {
    "claudeSemaphore": [
      { "id": "claudeSemaphore.sessions", "name": "Sesiones" }
    ]
  },
  "configuration": {
    "title": "Claude Semáforo",
    "properties": {
      "claudeSemaphore.theme": {
        "type": "string",
        "enum": ["classic", "colorblind", "highContrast"],
        "default": "classic",
        "description": "Paleta y formas del semáforo."
      },
      "claudeSemaphore.sound.enabled": {
        "type": "boolean",
        "default": true,
        "description": "Reproducir un sonido cuando una sesión pasa a amarillo (necesita atención)."
      },
      "claudeSemaphore.sound.file": {
        "type": "string",
        "default": "",
        "description": "Ruta a un sonido personalizado. Vacío = honk incluido."
      },
      "claudeSemaphore.pollIntervalMs": {
        "type": "number",
        "default": 2000,
        "description": "Intervalo del sondeo de respaldo (ms)."
      }
    }
  },
  "colors": [
    { "id": "claudeSemaphore.classic.running", "description": "Running (classic)", "defaults": { "dark": "#3FB950", "light": "#1A7F37", "highContrast": "#3FB950" } },
    { "id": "claudeSemaphore.classic.needsInput", "description": "Needs input (classic)", "defaults": { "dark": "#D29922", "light": "#9A6700", "highContrast": "#D29922" } },
    { "id": "claudeSemaphore.classic.stopped", "description": "Stopped (classic)", "defaults": { "dark": "#F85149", "light": "#CF222E", "highContrast": "#F85149" } },
    { "id": "claudeSemaphore.colorblind.running", "description": "Running (colorblind)", "defaults": { "dark": "#0072B2", "light": "#0072B2", "highContrast": "#0072B2" } },
    { "id": "claudeSemaphore.colorblind.needsInput", "description": "Needs input (colorblind)", "defaults": { "dark": "#E69F00", "light": "#E69F00", "highContrast": "#E69F00" } },
    { "id": "claudeSemaphore.colorblind.stopped", "description": "Stopped (colorblind)", "defaults": { "dark": "#D55E00", "light": "#D55E00", "highContrast": "#D55E00" } }
  ]
}
```

- [ ] **Step 2: Create `media/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <rect x="8" y="2" width="8" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="12" cy="7" r="2" fill="currentColor"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
  <circle cx="12" cy="17" r="2" fill="currentColor"/>
</svg>
```

- [ ] **Step 3: Create `src/extension.ts`**

```ts
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

/** Locate the transcript JSONL for a session by scanning project dirs for <sessionId>.jsonl. */
function findTranscript(sessionId: string): string | undefined {
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return undefined;
  }
  for (const dir of projectDirs) {
    const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
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

  const refresh = (): void => {
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

    if (sawUnknownSchema && !warnedSchema) {
      warnedSchema = true;
      vscode.window.showWarningMessage(
        'Claude Semáforo: formato de sesión no reconocido — puede que Claude Code haya cambiado. Actualizá la extensión.',
      );
    }
  };

  // Event-driven updates via watcher.
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(SESSIONS_DIR), '*.json'),
  );
  let debounce: NodeJS.Timeout | undefined;
  const onChange = (): void => {
    if (debounce) { clearTimeout(debounce); }
    debounce = setTimeout(refresh, 150);
  };
  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  watcher.onDidDelete(onChange);
  context.subscriptions.push(watcher);

  // Poll fallback (catches missed fs events + dead-pid cleanup).
  const intervalMs = vscode.workspace.getConfiguration('claudeSemaphore').get<number>('pollIntervalMs', 2000);
  const timer = setInterval(refresh, Math.max(500, intervalMs));
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Repaint when the theme setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeSemaphore')) { refresh(); }
    }),
  );

  refresh();
}

export function deactivate(): void {
  /* subscriptions disposed by VS Code */
}
```

- [ ] **Step 4: Build the extension**

Run: `npm run build`
Expected: `out/extension.js` is produced with no errors.

- [ ] **Step 5: Manual verification in the Extension Development Host**

1. Open the project in VS Code; press `F5` (Run Extension).
2. With at least one Claude Code session running in a terminal, confirm:
   - The "Claude Semáforo" icon appears in the activity bar; its view lists each session by its `aiTitle`.
   - A busy session shows the running icon/color; an idle one shows stopped.
   - The status bar (bottom-left) shows `🟢n 🟡n 🔴n`; clicking it reveals the sidebar view.
3. In one session, trigger a permission prompt (e.g. run a command that needs approval). Confirm the row turns to the needs-input icon/color **and**, while VS Code is NOT the focused window, the honk plays. (This also empirically confirms the live `status` value lands in the needs-input set.)
4. Change `claudeSemaphore.theme` to `colorblind` in Settings; confirm palette + codicon glyphs update.

Expected: all four behaviors observed. Note in the commit body if the live needs-input status string differs from `needs_input`/`waiting`/`blocked` (then add it to `STATUS_MAP`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Wire VS Code views, status bar, watcher, and settings"
```

---

### Task 7: Bundle honk asset, README, and package the .vsix

**Files:**
- Create: `media/honk.aiff`
- Create: `README.md`
- Create: `LICENSE` (MIT)

**Interfaces:**
- Consumes: the built extension from Task 6.
- Produces: an installable `claude-semaphore-0.1.0.vsix`.

- [ ] **Step 1: Generate the bundled honk sound**

Run (primary, requires ffmpeg):

```bash
ffmpeg -y -f lavfi -i "sine=frequency=350:duration=0.18" -af "volume=0.6" -ar 22050 /tmp/h1.aiff \
  && ffmpeg -y -f lavfi -i "sine=frequency=350:duration=0.22" -af "volume=0.7" -ar 22050 /tmp/h2.aiff \
  && ffmpeg -y -i "concat:/tmp/h1.aiff|/tmp/h2.aiff" -c copy media/honk.aiff
```

Fallback (no ffmpeg): `cp /System/Library/Sounds/Funk.aiff media/honk.aiff`

Verify: `afplay media/honk.aiff` plays a short honk.

- [ ] **Step 2: Create `README.md`**

```markdown
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
```

- [ ] **Step 3: Create `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Manuel Arguelles

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Package the .vsix**

Run: `npm run package`
Expected: `claude-semaphore-0.1.0.vsix` is created in the project root (vsce may warn about a missing repository field — acceptable for a local build).

- [ ] **Step 5: Install and smoke-test**

1. Install the `.vsix` via *Install from VSIX…* in your real VS Code.
2. Confirm the sidebar list and status-bar summary appear and reflect live sessions.

Expected: extension loads from the packaged build with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add bundled honk, README, license, and package the extension"
```

---

## Notes for the implementer

- Run `npm test` after Tasks 1–5; all pure logic must stay green before wiring VS Code.
- Tasks 6–7 are verified manually (VS Code API can't be unit-tested here) — follow the exact verification steps.
- If the live needs-input status string seen in Task 6 Step 5 is not already in `STATUS_MAP` (Task 1), add it there and re-run `npm test`.
