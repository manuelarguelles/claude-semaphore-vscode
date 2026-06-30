# Terminal Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar cada fila del panel "Sesiones" a su terminal de VS Code (clic → revelar terminal) y dejar el panel actualizándose de forma confiable (cerrar el bug de congelado).

**Architecture:** Un componente nuevo `terminalLinker.ts` resuelve, por pid de Claude, el `Terminal` asociado (árbol de procesos vía `ps`; fallback por `cwd`). `extension.ts` resuelve el terminal en cada `refresh()`, guarda un mapa `pid→Terminal`, y registra el comando `claudeSemaphore.revealTerminal` que la fila dispara. El bug de congelado se ataca con systematic-debugging usando la instrumentación `[ClaudeSemaforo]` ya presente, que al cerrar queda detrás de un flag de debug.

**Tech Stack:** TypeScript, VS Code Extension API (`^1.85.0`), esbuild, vitest, `child_process.execFile('ps')`.

## Global Constraints

- VS Code engine floor: `^1.85.0` (no usar API más nueva sin subir el floor).
- Sin atribución a Claude/AI en commits, código ni docs. Autor visible: Manuel Arguelles.
- Lector puro: no escribir en `~/.claude`, no instalar hooks, no tocar `settings.json` del usuario.
- Los 27 tests unitarios existentes deben seguir verdes.
- Mensajes de commit en inglés, concisos.
- macOS (Darwin) es la plataforma objetivo; `ps -o ppid= -p <pid>` es el lookup de padre.

---

## File Structure

- `src/terminalLinker.ts` — **nuevo**. Resuelve `Terminal` por sesión. Sin dependencia dura de `vscode` (usa interfaces mínimas) para testear con vitest.
- `tests/terminalLinker.test.ts` — **nuevo**. Unit tests del resolver.
- `src/extension.ts` — **modificar**. Wiring del linker, comando reveal, `TreeItem.command`/`contextValue`, flag de debug, fix del freeze.
- `package.json` — **modificar**. Declarar comando y menú contextual; setting `claudeSemaphore.debug`.

---

## Task 1: Root-cause y fix del bug de congelado (live-update)

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json` (setting `claudeSemaphore.debug`)
- Test: `tests/refreshLoop.test.ts` (nuevo, forma final según causa raíz)

**Interfaces:**
- Produces: panel que refleja una sesión nueva `busy` como 🟢 en ≤ `pollIntervalMs` sin recargar la ventana. No cambia firmas públicas consumidas por otras tareas.

> Esta tarea es de **debugging**, no greenfield. Se ejecuta con `superpowers:systematic-debugging`. No escribir ningún fix antes de tener la evidencia del runtime.

- [ ] **Step 1: Invocar systematic-debugging y preparar el dev host**

Lanzar la ventana de prueba con el build actual (ya instrumentado):
```bash
cd ~/clawd/projects/claude-semaphore-vscode
npm run build
code --extensionDevelopmentPath="$PWD" ~
```
En la ventana nueva: `Cmd+Shift+P` → "Toggle Developer Tools" → pestaña **Console** → filtro `ClaudeSemaforo`. Luego `Cmd+Shift+P` → "Reload Window".

- [ ] **Step 2: Capturar evidencia (Fase 1) — observar ~10s con una sesión Claude nueva corriendo**

Anotar de la consola, sin tocar código:
- ¿Aparece `poll armed every 2000ms` y `activated`?
- ¿Aparecen `refresh #N (poll)` **cada ~2s**?
- ¿El `summary={...}` cambia cuando arranca/cambia una sesión?
- ¿Hay `watcher event`? ¿Hay algún `refresh #N FAILED`?

- [ ] **Step 3: Clasificar la causa raíz según la evidencia**

| Síntoma en consola | Causa raíz | Fix mínimo |
|---|---|---|
| No hay ticks de `poll` | `setInterval` no corre (activación/host) | revisar `activationEvents`/orden de activación |
| Ticks corren pero `summary` nunca cambia | lectura de estado / `isAlive` / pipeline en vivo | corregir la lectura; cubrir con test de loop |
| Nunca hay `watcher event` al cambiar archivos | `FileSystemWatcher` no dispara fuera del workspace (limitación conocida) | no depender del watcher; confiar en el poll (ya es backstop) — confirmar que el poll basta |
| Hay `FAILED` | excepción en `refresh()` | corregir según el stack |

Escribir en el commit/PR la causa raíz confirmada (una frase: "I think X porque Y").

- [ ] **Step 4: Escribir el test de regresión que falla**

Extraer la lógica de un ciclo de refresh a una unidad testeable si aún no lo está (p.ej. una función `runRefresh(deps): Summary` que `extension.ts` llama desde el poll). Test con vitest y fake timers que reproduzca el caso observado (estado de archivos cambia entre ticks → `setSessions` recibe el estado nuevo):
```ts
import { describe, it, expect, vi } from 'vitest';
// importar la unidad de refresh extraída
it('reflects a newly-started busy session on the next poll tick', () => {
  // arrange: deps con listSessionFiles que devuelve [] y luego [busySession]
  // act: ejecutar dos ciclos de refresh
  // assert: setSessions/summary pasa de running:0 a running:1
});
```
Run: `npx vitest run tests/refreshLoop.test.ts` → Expected: FAIL (reproduce el congelado).

- [ ] **Step 5: Implementar el fix mínimo de la causa raíz confirmada**

Aplicar SOLO el fix correspondiente a la causa del Step 3. Un cambio, sin mejoras "de paso".

- [ ] **Step 6: Verificar fix + no romper lo existente**

Run: `npx vitest run` → Expected: PASS (incluye el nuevo test y los 27 previos).
Volver al dev host, Reload Window, confirmar visualmente que una sesión nueva `busy` aparece 🟢 en ≤2s.

- [ ] **Step 7: Gatear la instrumentación detrás de `claudeSemaphore.debug`**

En `package.json`, agregar el setting:
```json
"claudeSemaphore.debug": {
  "type": "boolean",
  "default": false,
  "description": "Emite logs de diagnóstico [ClaudeSemaforo] en la consola del Extension Host."
}
```
En `extension.ts`, reemplazar las llamadas directas a `console.log('[ClaudeSemaforo] ...')` por un helper:
```ts
const debugEnabled = (): boolean =>
  vscode.workspace.getConfiguration('claudeSemaphore').get<boolean>('debug', false);
const dbg = (msg: string): void => { if (debugEnabled()) { console.log(`[ClaudeSemaforo] ${msg}`); } };
```
`console.error` del catch de `refresh()` se mantiene siempre (errores reales).

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts package.json tests/refreshLoop.test.ts
git commit -m "fix: keep sessions panel live-updating; gate debug logs behind setting"
```

---

## Task 2: `terminalLinker.ts` — resolver de matching sesión↔terminal

**Files:**
- Create: `src/terminalLinker.ts`
- Test: `tests/terminalLinker.test.ts`

**Interfaces:**
- Produces:
  - `interface TerminalLike { readonly processId: Thenable<number | undefined>; readonly shellIntegration?: { cwd?: { fsPath: string } }; show(preserveFocus?: boolean): void; }`
  - `interface LinkerDeps { getParentPid: (pid: number) => Promise<number | undefined>; }`
  - `class TerminalLinker { constructor(deps: LinkerDeps); resolve(session: { pid: number; cwd: string }, terminals: readonly TerminalLike[]): Promise<TerminalLike | undefined>; }`
  - `function psParentPid(pid: number): Promise<number | undefined>` (implementación real de `getParentPid` vía `execFile('ps', ['-o','ppid=','-p',String(pid)])`).
- Consumes: nada de tareas previas.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/terminalLinker.test.ts
import { describe, it, expect } from 'vitest';
import { TerminalLinker, TerminalLike } from '../src/terminalLinker';

const term = (pid: number | undefined, cwd?: string): TerminalLike => ({
  processId: Promise.resolve(pid),
  shellIntegration: cwd ? { cwd: { fsPath: cwd } } : undefined,
  show: () => {},
});

describe('TerminalLinker.resolve', () => {
  it('matches by process tree: claude ppid === terminal processId', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => 100 });
    const shell = term(100);
    const other = term(200);
    const found = await linker.resolve({ pid: 999, cwd: '/x' }, [other, shell]);
    expect(found).toBe(shell);
  });

  it('falls back to cwd when ppid does not match any terminal', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => 555 });
    const byCwd = term(300, '/work/app');
    const found = await linker.resolve({ pid: 999, cwd: '/work/app' }, [byCwd]);
    expect(found).toBe(byCwd);
  });

  it('returns undefined when neither ppid nor cwd match', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => undefined });
    const t = term(300, '/other');
    const found = await linker.resolve({ pid: 999, cwd: '/work/app' }, [t]);
    expect(found).toBeUndefined();
  });

  it('prefers process-tree match over cwd match', async () => {
    const linker = new TerminalLinker({ getParentPid: async () => 100 });
    const byTree = term(100, '/other');
    const byCwd = term(200, '/work/app');
    const found = await linker.resolve({ pid: 999, cwd: '/work/app' }, [byCwd, byTree]);
    expect(found).toBe(byTree);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/terminalLinker.test.ts`
Expected: FAIL con "Cannot find module '../src/terminalLinker'".

- [ ] **Step 3: Implementar `terminalLinker.ts`**

```ts
import { execFile } from 'child_process';

export interface TerminalLike {
  readonly processId: Thenable<number | undefined>;
  readonly shellIntegration?: { cwd?: { fsPath: string } };
  show(preserveFocus?: boolean): void;
}

export interface LinkerDeps {
  getParentPid: (pid: number) => Promise<number | undefined>;
}

export class TerminalLinker {
  /** claudePid -> ppid (estable durante la vida del proceso). */
  private ppidCache = new Map<number, number>();

  constructor(private deps: LinkerDeps) {}

  async resolve(
    session: { pid: number; cwd: string },
    terminals: readonly TerminalLike[],
  ): Promise<TerminalLike | undefined> {
    let ppid = this.ppidCache.get(session.pid);
    if (ppid === undefined) {
      const looked = await this.deps.getParentPid(session.pid);
      if (looked !== undefined) {
        ppid = looked;
        this.ppidCache.set(session.pid, looked);
      }
    }
    if (ppid !== undefined) {
      for (const t of terminals) {
        if ((await t.processId) === ppid) { return t; }
      }
    }
    // Fallback: cwd.
    for (const t of terminals) {
      const tcwd = t.shellIntegration?.cwd?.fsPath;
      if (tcwd && tcwd === session.cwd) { return t; }
    }
    return undefined;
  }

  /** Limpia el cache de pids que ya no están en la lista de sesiones vigentes. */
  prune(livePids: ReadonlySet<number>): void {
    for (const pid of this.ppidCache.keys()) {
      if (!livePids.has(pid)) { this.ppidCache.delete(pid); }
    }
  }
}

export function psParentPid(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (err, stdout) => {
      if (err) { return resolve(undefined); }
      const n = parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(n) ? n : undefined);
    });
  });
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/terminalLinker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/terminalLinker.ts tests/terminalLinker.test.ts
git commit -m "feat: add terminal linker resolving session pid to its VS Code terminal"
```

---

## Task 3: Wiring del comando reveal + TreeItem en `extension.ts` y `package.json`

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes (de Task 2): `TerminalLinker`, `psParentPid`, `TerminalLike`.
- Produces: comando `claudeSemaphore.revealTerminal` y filas del panel que lo disparan cuando hay terminal asociado.

- [ ] **Step 1: Declarar comando y menú contextual en `package.json`**

Dentro de `contributes`, agregar:
```json
"commands": [
  { "command": "claudeSemaphore.revealTerminal", "title": "Revelar terminal", "category": "Claude Semáforo" }
],
"menus": {
  "view/item/context": [
    { "command": "claudeSemaphore.revealTerminal", "when": "view == claudeSemaphore.sessions && viewItem == sessionWithTerminal", "group": "navigation" }
  ]
}
```

- [ ] **Step 2: En `extension.ts`, instanciar el linker y mantener el mapa pid→terminal**

Tras los imports, agregar:
```ts
import { TerminalLinker, psParentPid } from './terminalLinker';
```
Dentro de `activate`, antes de `refresh`:
```ts
const linker = new TerminalLinker({ getParentPid: psParentPid });
const terminalByPid = new Map<number, vscode.Terminal>();
```

- [ ] **Step 3: Resolver terminales dentro de `refresh()` y exponerlos al provider**

En `refresh`, después de obtener `sessions` y antes de `tree.setSessions(sessions)`:
```ts
terminalByPid.clear();
await Promise.all(sessions.map(async (s) => {
  const t = await linker.resolve({ pid: s.pid, cwd: s.cwd }, vscode.window.terminals);
  if (t) { terminalByPid.set(s.pid, t as vscode.Terminal); }
}));
linker.prune(new Set(sessions.map((s) => s.pid)));
```
> Si `refresh` no era `async`, convertirlo a `async` y ajustar sus call sites (`refresh('poll')` etc. no necesitan `await`; el `setInterval`/watcher pueden seguir llamándolo sin await).
Pasar el mapa al provider — agregar en `SemaphoreTreeProvider` un campo y setter:
```ts
private terminals = new Map<number, vscode.Terminal>();
setTerminals(m: Map<number, vscode.Terminal>): void { this.terminals = m; }
hasTerminal(pid: number): boolean { return this.terminals.has(pid); }
```
y llamar `tree.setTerminals(terminalByPid)` junto con `tree.setSessions(sessions)`.

- [ ] **Step 4: En `getTreeItem`, setear `command` y `contextValue` cuando hay terminal**

Antes del `return item;`:
```ts
if (this.terminals.has(s.pid)) {
  item.contextValue = 'sessionWithTerminal';
  item.command = {
    command: 'claudeSemaphore.revealTerminal',
    title: 'Revelar terminal',
    arguments: [s.pid],
  };
} else {
  item.tooltip = `${s.title}\n${s.cwd}\n${label}\n(sin terminal en esta ventana)`;
}
```

- [ ] **Step 5: Registrar el comando reveal**

En `activate`, junto al resto de `context.subscriptions.push(...)`:
```ts
context.subscriptions.push(
  vscode.commands.registerCommand('claudeSemaphore.revealTerminal', (pid: number) => {
    terminalByPid.get(pid)?.show(false);
  }),
);
```

- [ ] **Step 6: Refrescar al cerrar un terminal**

```ts
context.subscriptions.push(
  vscode.window.onDidCloseTerminal(() => refresh('terminalClosed')),
);
```

- [ ] **Step 7: Build y verificación manual en el dev host**

Run: `npm run build && npx vitest run`
Expected: build OK; los 27 + nuevos tests PASS.
En el dev host (Reload Window): clic en una fila con sesión Claude activa → enfoca su terminal. Fila sin terminal → no hace nada y el tooltip lo aclara.

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: reveal a session's terminal from the sessions panel"
```

---

## Task 4: Empaquetado y verificación de cierre

**Files:**
- Modify: ninguno de código (solo artefacto `.vsix`)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Verificar working tree limpio de instrumentación cruda**

Run: `grep -rn "console.log('\[ClaudeSemaforo\]" src/`
Expected: 0 resultados (todo pasa por `dbg(...)`).

- [ ] **Step 2: Suite completa + empaquetar**

Run: `npx vitest run && npm run build && npm run package`
Expected: tests PASS, build OK, genera `claude-semaphore-0.1.0.vsix`.

- [ ] **Step 3: Smoke test del `.vsix` instalado**

```bash
code --install-extension claude-semaphore-0.1.0.vsix
```
Recargar una ventana real con sesiones Claude activas: panel actualiza en vivo, clic revela terminal, `claudeSemaphore.debug=false` no ensucia la consola.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "chore: package terminal-link build"
```

---

## Self-Review

**Spec coverage:**
- Resolver matching (árbol + cwd + sin-match) → Task 2 ✓
- Acción revelar terminal (fila + contextual) → Task 3 ✓
- Fix del freeze (systematic-debugging) → Task 1 ✓
- Tests del resolver + regresión del fix → Task 2 + Task 1 ✓
- Instrumentación detrás de flag → Task 1 Step 7 ✓
- Fuera de scope (pintar pestaña, opción B, separación por ventana) → no aparecen como tareas ✓

**Placeholder scan:** Task 1 es debugging por naturaleza; su fix exacto (Step 5) se elige de la tabla de causas del Step 3 con evidencia real — es un procedimiento concreto, no un "TODO". El resto tiene código completo.

**Type consistency:** `TerminalLinker`, `LinkerDeps`, `TerminalLike`, `psParentPid`, `resolve(...)`, `prune(...)` usados igual en Task 2 y Task 3. `setTerminals`/`hasTerminal`/`terminalByPid` consistentes en Task 3.
