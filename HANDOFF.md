# HANDOFF — Claude Semáforo (sesión de debug, 2026-06-30)

## Qué es el proyecto
Extensión VS Code que muestra un **semáforo por sesión de Claude Code**: 🟢 corriendo / 🟡 necesita atención / 🔴 detenido. Lista en la barra lateral (TreeView) + resumen en la status bar (`🟢n 🟡n 🔴n`). **Lector puro**: lee archivos que Claude Code ya mantiene, **no instala hooks**, no toca `settings.json`.

- **Repo:** `~/clawd/projects/claude-semaphore-vscode` (git, rama actual **`feat/semaphore-mvp`**)
- **Spec:** `docs/superpowers/specs/2026-06-30-claude-semaphore-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-30-claude-semaphore.md`
- **Memoria:** `claude-semaphore-vscode.md` en el dir de memoria del proyecto APEX

## Fuente de datos (verificado)
- Estado en vivo por sesión: `~/.claude/sessions/<pid>.json` → campos `status`, `sessionId`, `cwd`, `pid`, `name`, `kind`.
- Valores de `status` observados en vivo: `busy`, `idle`, `waiting`, **`shell`** (y en el binario: `needs_input`, `blocked`, `paused`).
- Mapeo actual (`src/stateMapper.ts`): busy→running; needs_input/waiting/blocked→needsInput; idle/paused→stopped; **desconocido→stopped**.
  - ⚠️ **`shell` NO está mapeado** → cae a rojo por default. Decidir si es lo deseado (sesión en prompt de shell = "detenido" es defendible).
- Título de cada fila = última `aiTitle` del transcript `~/.claude/projects/<dir>/<sessionId>.jsonl` (leído por la cola, 64KB, cache por mtime).

## Estado de construcción
- **7 tareas implementadas** (TDD, subagentes), **27 tests unitarios verdes**, build esbuild OK, `.vsix` empaquetado (`claude-semaphore-0.1.0.vsix`).
- **Review final (opus): "Ready to merge"**, solo findings Minor. Se aplicaron 3 hardening (commit `3b87e6c`): memoizar ruta de transcript, try/catch en `refresh()`, limpiar debounce.
- Commits en la rama: `f73b143` scaffold+stateMapper · `83fba01` titleResolver · `fd21d33` theme · `1b38d15` notifier+sound · `9e82e8a` sessionStore · `cee21ab` wiring VS Code · `6b60278` honk+README+package · `3b87e6c` hardening.
- Ledger SDD: `.superpowers/sdd/progress.md`. Briefs/reports por tarea en `.superpowers/sdd/`.

## ⛔ MERGE EN PAUSA — bug encontrado en prueba manual
Probando en una ventana **Extension Development Host** (lanzada con `code --extensionDevelopmentPath`), el usuario reportó:
1. **Congelado**: el panel se quedó con datos viejos; una sesión nueva que arrancó (estaba `busy`) **no apareció como verde** (resumen mostraba 🟢0).
2. **No separa por ventana**: ve las sesiones de la otra ventana (es lectura global de `~/.claude/sessions/` — comportamiento de diseño, pero el usuario espera separación por ventana → decisión de diseño pendiente).

## Debug hecho (systematic-debugging, Fase 1)
- **Reproducción headless** (`/tmp/repro.mjs`) que replica EXACTO el pipeline de `refresh()` sobre los archivos reales → **funciona perfecto, sin excepciones**: busy→running×3, waiting→needsInput, idle→stopped. Summary `{running:3,needsInput:1,stopped:1}`. Títulos correctos.
- **Conclusión:** el bug **NO está en los datos/lógica** (queda descartado que el try/catch congele por excepción en el pipeline). Está en el **wiring de actualización en vivo** del extension host: `refresh()` no se re-ejecuta/refleja tras la carga inicial. El código (`setInterval` poll cada 2s + `createFileSystemWatcher`) se ve correcto, por eso hay que **observar el runtime**, no parchear.

## Instrumentación agregada (NO commiteada todavía)
- `src/extension.ts` tiene logs `console.log('[ClaudeSemaforo] ...')` en: activación, "poll armed", cada tick de poll, cada evento de watcher, y el summary de cada refresh (+ `FAILED` en catch). **Working tree sucio**; `out/extension.js` ya rebuildeado con la instrumentación.
- ⚠️ **Revertir/limpiar la instrumentación antes de mergear.**

## ▶️ PRÓXIMO PASO (evidencia que falta)
En la ventana **Extension Development Host**:
1. `Cmd+Shift+P` → **Toggle Developer Tools** → pestaña **Console** → filtro `ClaudeSemaforo`.
2. `Cmd+Shift+P` → **Reload Window** (carga el build instrumentado).
3. Observar ~10s: ¿aparecen `refresh #N (poll)` + `refresh #N ok: ... summary={...}` **cada 2s**? ¿el summary cambia al cambiar sesiones? ¿hay `watcher event`? ¿algún `FAILED`?

**Hipótesis a discriminar con esos logs:**
- Si NO aparecen ticks de poll → `setInterval` no corre (raro) → investigar activación/host.
- Si aparecen ticks pero summary nunca cambia → lectura/estado, no render.
- Si nunca hay `watcher event` al cambiar archivos → el `FileSystemWatcher` no dispara para rutas fuera del workspace (limitación conocida de VS Code); el poll es el backstop y hay que confiar en él.
- Si hay `FAILED` → ver el error.

## Decisiones de diseño abiertas
- **¿Filtrar por ventana/workspace?** Hoy es global. Opción: filtrar sesiones cuyo `cwd` esté dentro de los workspace folders de la ventana. Pero el dev-host abrió en `~` (sin workspace) → definir comportamiento sin workspace.
- **`shell` status** → ¿rojo (actual) u otro?

## Infra de cierre (cuando el bug esté resuelto)
- Opción elegida: **PR + merge**. Repo a crear: **privado**, cuenta **`manuelarguelles`** (ya autenticada en `gh`, hacer `gh auth switch --user manuelarguelles`). Aún NO se creó el repo ni se pusheó.
- `code` CLI v1.119.0 y `gh` disponibles. No hay secretos en el repo.

## Reglas
Español, directo. **Sin atribución a Claude/AI** en commits/PRs/docs. Autor: Manuel Arguelles.
