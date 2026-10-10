# Semáforo Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar todas las capacidades aprobadas de organización, diagnóstico y gestión y entregar un VSIX candidato verificado.

**Architecture:** TreeView nativo sobre lectores actuales; presentación y journal independientes del editor; hooks locales opcionales como evidencia complementaria. Lanzadores construyen argv por proveedor y crean terminales nuevas. Git administra worktrees mediante argumentos separados.

**Tech Stack:** TypeScript strict, Node fs/child_process, VS Code API >=1.85, Vitest y esbuild; sin paquetes nuevos de producción previstos.

**Spec:** `docs/superpowers/specs/2026-10-09-session-management-design.md`, aprobada por Manuel.

## Global Constraints

- Preservar extensión `manuelarguelles.claude-semaphore` y checkpoint 1.0.0; desarrollar en worktree aislado incluyendo los cambios pendientes de esa versión.
- Observación/organización sin llamadas a modelos; validación con fixtures y CLI sin prompts de pago.
- Hooks opcionales, sin decisiones/contexto en stdout, sin bypass de confianza o permisos; preservar configuración ajena.
- Estados: trabajando, necesita respuesta, inactivo/finalizado, error observado y desconocido; silencio no implica atención.
- Historial: 30 días, 1.000 sesiones, 200 eventos por sesión; sin mensajes, prompts ni argumentos de herramientas.
- No recargar/cerrar ventanas o terminales del usuario; no borrar worktrees, ramas o sesiones.
- Ejecución comprobada en macOS ARM; Windows/Linux requieren evidencia propia antes de declarar soporte verificado.
- Entregar candidato local. Marketplace será una publicación separada del artefacto validado.

## Review Focus

- Dos proyectos con el mismo nombre y dos sesiones con el mismo PID: conservar identidad, grupo y acción correcta (Tasks 1, 2, 5).
- Rutas/IDs con espacios o caracteres de shell: pasar argv literales, sin ejecutar sustituciones (Tasks 3, 4).
- Recarga, reloj/eventos viejos y journal corrupto: no inventar tiempo trabajado ni mantener espera obsoleta (Tasks 2, 3).
- Configuración existente y eventos de subagentes: conservar entradas ajenas y no atribuir estado a la sesión principal (Task 3).
- Cancelación, CLI no compatible, destino Git existente y fallo después de crear worktree: no acciones parciales ocultas o borrados (Tasks 4, 5).

---

### Task 1: Estados explícitos y presentación

**Files:** Modify `src/types.ts`, `src/stateMapper.ts`, `src/theme.ts`, `src/tooltip.ts`, `src/renderSignature.ts`, `package.json`; create `src/sessionPresentation.ts`, `tests/sessionPresentation.test.ts`; extend corresponding existing tests.

**Interfaces:** `Provider = 'claude' | 'codex'`; `SemaphoreState` añade `error` y mantiene `stopped` interno para inactivo. `SessionState` añade `evidence?: { source: string; reason: string; at?: number }`. `ViewOptions {query:string; provider?:Provider; state?:SemaphoreState; favoritesOnly:boolean; grouped:boolean}`. `presentSessions(sessions:SessionState[], options:ViewOptions, favorites:ReadonlySet<string>): ProjectGroup[]`, `ProjectGroup {id:string; cwd:string; sessions:SessionState[]}`. `persistentSessionKey(s:Pick<SessionState,'provider'|'sessionId'>):string` en `src/sessionIdentity.ts`.

- [x] Escribir tests RED: igualdad del basename no fusiona CWD; filtro combinado elimina grupos vacíos; espera precede a favorita inactiva; PID compartido conserva IDs; estado desconocido no se presenta como error. Ejemplo: `expect(presentSessions([a,b], options, new Set()).map(g=>g.cwd)).toEqual(['/one/app','/two/app'])`.
- [x] Ejecutar `npx vitest run tests/sessionPresentation.test.ts tests/stateMapper.test.ts tests/theme.test.ts tests/tooltip.test.ts tests/renderSignature.test.ts`; confirmar fallo por nuevas capacidades ausentes.
- [x] Implementar interfaces, orden estable y cinco estados; colores grises para inactivo y rojos solo para error; mantener temas accesibles y firma de render sin tiempo que cambia por tick.
- [x] Repetir tests y `npx tsc --noEmit`; corregir usos exhaustivos de tipos y resumen.
- [x] Commit solo archivos de esta tarea.

### Task 2: Journal y recuperación local

**Files:** Create `src/sessionJournal.ts`, `tests/sessionJournal.test.ts`; extend `src/sessionIdentity.ts` and tests.

**Interfaces:** `JournalData {version:1; sessions:RecordedSession[]}`; `RecordedSession {key:string; provider:Provider; sessionId:string; cwd:string; title:string; lastSeenAt:number; active:boolean; events:StateEvent[]}`; `StateEvent {at:number; state:SemaphoreState|'offline'; reason:string; source:string}`. `SessionJournal` constructor `(data:unknown, now:()=>number)`; methods `observe(sessions:SessionState[]):boolean`, `snapshot():JournalData`, `recent():RecordedSession[]`, `clear():void`. Tiempo observado calculado desde transiciones con corte offline; no continuidad durante cierre de la ventana.

- [x] Tests RED: dos ticks iguales dejan un evento; nuevo PID mismo proveedor/sessionId mantiene catálogo; desaparición registra offline una vez; carga corrupta devuelve catálogo vacío; purga 30 días/1.000 sesiones/200 eventos; reload no suma tiempo offline. Ejemplo: `expect(journal.snapshot().sessions[0].events).toHaveLength(1)` tras dos observaciones iguales.
- [x] Ejecutar `npx vitest run tests/sessionJournal.test.ts` y comprobar RED.
- [x] Implementar journal validado y acotado, incluyendo campos permitidos únicamente y una API para detalle del tiempo observado. Serializar mediante almacenamiento del editor en Task 5, con escrituras secuenciales y diagnóstico del fallo.
- [x] Ejecutar tests del journal y TypeScript; verificar que JSON no contiene contenido de conversaciones.
- [x] Commit task.

### Task 3: Hooks y resolución de evidencia

**Files:** Create `src/sessionEvents.ts`, `src/hookConfiguration.ts`, `scripts/session-hook.cjs`, `tests/sessionEvents.test.ts`, `tests/hookConfiguration.test.ts`, `tests/sessionHook.test.ts`; extend `esbuild.js`/`.vscodeignore` only if needed for packaged receiver.

**Interfaces:** `NormalizedEvent {provider:Provider; sessionId:string; cwd:string; event:string; at:number; turnId?:string}`. `normalizeEvent(provider:Provider, raw:unknown, now:number):NormalizedEvent|undefined`. `resolveEventState(session:SessionState, event:NormalizedEvent|undefined):SessionState`. `mergeHooks(provider:Provider, original:unknown, command:string):unknown`, `removeOwnHooks(provider:Provider, original:unknown, command:string):unknown`. Ownership matches exact generated command/receiver marker, never broad command substring. Receiver writes bounded per-session sanitized JSON atomically.

- [x] Tests RED: permiso→espera y evento posterior→trabajando; fin→inactivo; StopFailure→error; eventos viejos/subagente/turno diferente no cambian estado; tamaño limitado y traversal rechazado; merge idempotente y removal preserva hook ajeno. Ejemplo: `expect(mergeHooks(p, mergeHooks(p, original, cmd), cmd)).toEqual(mergeHooks(p, original, cmd))`.
- [x] Ejecutar `npx vitest run tests/sessionEvents.test.ts tests/hookConfiguration.test.ts tests/sessionHook.test.ts`; comprobar RED.
- [x] Implementar normalización, precedencia temporal documentada, receptor sin decisiones/stdout, timeout corto, merge y copia previa. Usar únicamente eventos compatibles según ayuda/docs y distinguir configuración de señal recibida. Instalación/retirada solo por comando explícito y workspace confiable (Task 5).
- [x] Tests ejecutan realmente `node scripts/session-hook.cjs` con stdin fixture y directorio temporal; verificar JSON, stdout vacío y comportamiento no bloqueante ante fallo. Ejecutar suite task y TypeScript.
- [x] Commit task.

### Task 4: CLI y worktrees

**Files:** Create `src/agentCapabilities.ts`, `src/sessionLauncher.ts`, `src/worktreeManager.ts`, `tests/agentCapabilities.test.ts`, `tests/sessionLauncher.test.ts`, `tests/worktreeManager.test.ts`.

**Interfaces:** `AgentCapabilities {provider:Provider; executable:string; start:boolean; resume:boolean; fork:boolean; worktree:boolean; hooks:boolean; version?:string}`. `inspectAgent(provider:Provider, executable:string):Promise<AgentCapabilities>` con caché/timeout. `LaunchRequest {provider:Provider; cwd:string; action:'start'|'resume'|'fork'; sessionId?:string}`; `LaunchSpec {executable:string; args:string[]; cwd:string}`; `buildLaunch(request:LaunchRequest, capabilities:AgentCapabilities):LaunchSpec`. `createWorktree(repo:string, branch:string, destination:string):Promise<string>`.

- [x] Tests RED: argumentos resume/fork por proveedor; falta de soporte no cae a resume; IDs/rutas literales no son comandos; CLI ausente no informa éxito; repo con espacios crea worktree real; rama/destino existentes se conservan; Git sin HEAD falla claro. Ejemplo: `expect(buildLaunch(claudeFork, cap).args).toEqual(['--resume', id, '--fork-session'])`.
- [x] Ejecutar `npx vitest run tests/agentCapabilities.test.ts tests/sessionLauncher.test.ts tests/worktreeManager.test.ts`; comprobar RED.
- [x] Implementar inspección con args separados y límites, lanzadores sin shell y Git real con `execFile`. Worktree propio desde HEAD, sin copiar cambios locales. Bifurcación en otro CWD solo si evidencia de CLI confirma la combinación; mantener worktree si lanzamiento posterior falla.
- [x] Tests Git en repo temporal; verificar árbol original/ramas intactos ante cancelación/fallo. Ejecutar suite task, TypeScript y build.
- [x] Commit task.

### Task 5: Integración completa en VS Code

**Files:** Create `src/sessionTree.ts`, `src/sessionCommands.ts`, `src/sessionDetails.ts`; modify `src/extension.ts`, `package.json`, `tests/extension.test.ts`; create `tests/sessionCommands.test.ts`, `tests/sessionTree.test.ts`.

**Interfaces:** `SessionTree` consume `presentSessions`, `SessionJournal`, preferencias y enlaces de terminal; `TreeNode = ProjectGroup | SessionState` con discriminación explícita. `registerSessionCommands(context:vscode.ExtensionContext, services:SessionServices):void`; `SessionServices` contiene getSessions, getJournal, updateView, toggleFavorite, getCapabilities, launch, configureHooks y refresh. `formatSessionDetails(session:RecordedSession):string` produce texto escapado y tiempo observado.

- [ ] Tests RED de integración: grupos/lista plana, filtros visible/total, limpiar vacío, favoritas persistentes, todos los comandos registrados, acción para fila sin terminal, cancelar dialog no ejecuta nada, workspace no confiable bloquea mutaciones, fallo de escritura/CLI visible y lifecycle dispone watchers/timers.
- [ ] Ejecutar `npx vitest run tests/extension.test.ts tests/sessionCommands.test.ts tests/sessionTree.test.ts`; comprobar RED antes de integrar.
- [ ] Conectar todos los módulos al refresh existente, filtros y menús, journal serializado, receptor/eventos con lecturas limitadas, detalle/historial, búsqueda nativa, configuración opcional y nuevas terminales mediante shellPath/args/CWD. Summary total y vista visible separados. Evitar reentrancia y conservar notificación/enlace seguro.
- [ ] Ejecutar tests y TypeScript. Validar argv/CWD con CLI fixture en host de desarrollo y sin inferencia; comprobar start/resume/fork/worktree, cancelación y recuperación de error; prueba real de lectores actuales.
- [ ] Revisión visual en host aislado, default y filtrado, detalle/historial, estados y paletas. Registrar evidencia; corregir fallos antes de marcar task.
- [ ] Commit task.

### Task 6: Paquete, revisión y entrega

**Files:** Modify `README.md`, `CHANGELOG.md`, `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `package.json`, `package-lock.json`; create `docs/releases/1.1.0-rc.1-validation.md`; update plan checkboxes and local recovery index session.

- [ ] Redactar docs del comportamiento final, configuración reversible, confianza de hooks, almacenamiento, CLI/plataformas, coste del agente y rollback. Candidato `1.1.0-rc.1` local, conservando ID.
- [ ] Ejecutar `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run smoke:codex`, `npx vsce package`; salida esperada: suite completa correcta y paquete generado, smoke distingue muestra ausente de éxito.
- [ ] Inspeccionar lista ZIP/VSIX: receptor incluido y ejecutable con rutas válidas, documentos privados/credenciales/snapshots excluidos; SHA-256 y matriz de validación registrados.
- [ ] Revisión independiente de rama completa, corregir hallazgos con regresiones RED→GREEN; repetir únicamente verificaciones afectadas y suite final tras correcciones.
- [ ] Documentar estado/memoria/índice y pendientes reales. Instalar/mostrar candidato en host aislado para entrega local sin cerrar ventanas del usuario. Goal completo solo si las capacidades aprobadas y verificaciones están cerradas; publicación Marketplace no forma parte de esta entrega.

## Revisión del plan

Cobertura: organización/estados Task 1; historial/recuperación Task 2; señales/configuración Task 3; gestión/worktrees Task 4; experiencia completa Task 5; validación y entrega Task 6. Interfaces comparten Provider, SessionState y claves persistentes. No funcionalidades acordadas omitidas. Ejecución propuesta: nativa en esta sesión, con revisión independiente final conforme a WORKFLOW. Plan y ejecución nativa aprobados por Manuel mediante «apruebo, sigamos» el 2026-10-10.

Execution evidence: Tasks 1–4 complete; Task 5 implemented and partly verified natively; Task 6 package/review/documents prepared. Native hook/history/filter/palette/reload and final packaged-host acceptance remain open due to native pipe failure. See docs/releases/1.1.0-rc.1-validation.md.
