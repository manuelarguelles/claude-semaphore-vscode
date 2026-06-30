# Diseño — Asociar semáforo de sesión a su terminal (Opción A)

**Fecha:** 2026-06-30
**Rama:** `feat/semaphore-mvp` (o rama nueva derivada)
**Estado:** aprobado en brainstorming, pendiente de plan

## Problema

El usuario espera ver el estado (🟢/🟡/🔴) de cada sesión de Claude Code asociado a su
**terminal** en el panel de terminales de VS Code. Restricción dura verificada en los
typings de VS Code (`node_modules/@types/vscode/index.d.ts`): `Terminal.name`,
`Terminal.color` e `Terminal.iconPath` son **readonly**; `color`/`iconPath` solo se
setean al **crear** el terminal (`TerminalOptions`). No existe API pública para
recolorear o re-iconizar un terminal que creó otro proceso (el shell / Claude Code).
Por lo tanto, **decorar la pestaña del terminal es inviable** desde una extensión
publicable.

Además, hay un bug en pausa (handoff `HANDOFF.md`): en el Extension Development Host el
panel "Sesiones" se queda con datos viejos y una sesión nueva `busy` no aparece como
🟢 (resumen mostraba 🟢0). El pipeline de datos está descartado como causa (repro
headless funciona); el bug está en el wiring de actualización en vivo.

## Objetivo

Entregar, dentro de lo que la API permite, la asociación **terminal ↔ semáforo**:
el semáforo vive en el panel lateral "Sesiones" (superficie existente), pero cada fila
queda ligada 1:1 a su terminal y permite saltar a él. Y dejar el panel **actualizando
de forma confiable** (cerrar el bug de congelado).

## Alcance

### En scope
1. Resolver, por cada sesión, su `Terminal` de VS Code correspondiente.
2. Acción "Revelar terminal" desde el panel (clic en la fila + menú contextual).
3. Root-cause + fix del bug de actualización en vivo (systematic-debugging).
4. Tests del resolver de matching y regresión del fix.
5. Limpieza de la instrumentación de debug.

### Fuera de scope (YAGNI)
- Pintar/iconizar la pestaña del terminal (imposible con API pública).
- Estado por terminal activo en la status bar (opción B, descartada).
- Separación por ventana/workspace (decisión abierta del handoff, queda fuera).

## Diseño

### Componente nuevo: `terminalLinker.ts`

Responsabilidad única: dado el pid del proceso Claude de una sesión, devolver el
`Terminal` de VS Code asociado (o `undefined`).

**Estrategia de matching (en orden):**
1. **Árbol de procesos (primario):** el pid del archivo de sesión es el pid de Claude;
   `Terminal.processId` es el pid del **shell** padre. Resolver el `ppid` de Claude con
   `ps -o ppid= -p <pid>` y buscar el `Terminal` cuyo `processId === ppid`.
2. **`cwd` (fallback):** si el árbol no resuelve, comparar `session.cwd` con
   `Terminal.shellIntegration?.cwd`. Si varias terminales comparten cwd, no se garantiza
   unicidad → se toma la primera y el tooltip lo indica.
3. **Sin match:** la fila existe igual; "Revelar terminal" queda inerte.

**Interfaz:**
- `resolveTerminal(session: SessionState, terminals: readonly Terminal[]): Promise<Terminal | undefined>`
- Entrada inyectable para `ps` (lookup de ppid) y la lista de terminales → testeable sin VS Code real.
- Cache por pid (`Map<pid, terminalProcessId>`) válido mientras el terminal viva;
  `window.onDidCloseTerminal` invalida la entrada.

### Cambios en `extension.ts`
- Registrar comando `claudeSemaphore.revealTerminal` que recibe la `SessionState` (o su pid)
  y hace `terminal.show(false)`.
- En `getTreeItem`, cuando hay terminal resuelto: setear `item.command` (revealTerminal con
  args) y `item.contextValue = 'sessionWithTerminal'`.
- El matching se recalcula en cada `refresh()`; el `TreeItem` refleja el terminal vigente.
- Suscribir `window.onDidCloseTerminal` para invalidar cache y `refresh()`.

### `package.json`
- Declarar el comando `claudeSemaphore.revealTerminal`.
- `menus.view/item/context` para `claudeSemaphore.sessions` con `when: viewItem == sessionWithTerminal`.

### Bug de congelado (systematic-debugging)
- Levantar dev host, capturar consola (`[ClaudeSemaforo]`), discriminar hipótesis del handoff:
  ¿corre el `setInterval`? ¿cambia el `summary`? ¿dispara el watcher fuera del workspace?
- Causa raíz → fix mínimo → test de regresión. Sin parches a ciegas.
- **Instrumentación:** al cerrar, mover los `console.log` detrás de un flag
  (`claudeSemaphore.debug`, default `false`) en vez de borrarlos, para diagnósticos futuros
  sin ruido en producción.

## Flujo de datos

```
refresh()  →  buildSessions()  →  [SessionState...]
                                      │
                  terminalLinker.resolveTerminal(session, window.terminals)
                                      │
                          TreeItem.command = revealTerminal(pid)
                                      │
            clic en fila  →  comando  →  terminal.show(false)
```

## Manejo de errores
- `ps` falla / no existe el pid → matching cae al fallback por cwd; si tampoco, sin-match (no error visible).
- Terminal cerrado entre refrescos → cache invalidado por `onDidCloseTerminal`; comando con terminal muerto no hace nada.
- `shellIntegration` ausente (terminal viejo o sin integración) → solo queda el match por árbol de procesos.

## Tests
- `terminalLinker`: pid→ppid→terminal (match por árbol); fallback por cwd; sin-match;
  cache invalidada al cerrar terminal. `ps` y lista de terminales mockeados.
- Regresión del fix del freeze (forma depende de la causa raíz hallada).
- Los 27 tests actuales se mantienen verdes.

## Criterios de éxito
1. Clic en una fila del panel enfoca el terminal correcto de esa sesión.
2. Una sesión nueva `busy` aparece 🟢 en ≤ pollInterval sin recargar la ventana (freeze resuelto).
3. Sin terminal asociado, la fila no rompe y lo comunica en el tooltip.
4. Instrumentación de debug detrás de flag; tests verdes; `.vsix` empaqueta.
