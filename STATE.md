# Estado de Semáforo — cierre 2026-10-10

## Estado actual

✅ Estable 1.0.0 publicada previamente en Marketplace `ManuelArguelles.claude-semaphore`; checkpoint fuente/VSIX conservado en `/Users/macdenix/clawd/archive/2026-10/semaphore-1.0.0-checkpoint/`.

🟡 Candidato local 1.1.0-rc.1: todas las capacidades aprobadas implementadas, revisión independiente resuelta; aceptación visual parcial, objetivo aún abierto. Rama `feat/session-management`, worktree `/Users/macdenix/clawd/worktrees/semaphore-management`. Diseño y plan aprobados: no pedirlos otra vez.

✅ Gates repetidos al empaquetar sesión: 129 pruebas / 22 suites, `npx tsc --noEmit`, `npm run build`; runtime del VSIX coincide con salida reconstruida. Fuente actual: f9f8fcc (antes del commit de este cierre). Seis Important corregidos RED→GREEN en 42d39f8; revisión inicial sobre 4bb0b79..6998937, sin Critical ni minors.

✅ Receptor del paquete ejecutado, Git real, smoke Codex real y parte de los flujos en host nativo. Detalle exacto en `docs/releases/1.1.0-rc.1-validation.md` y matriz de aceptación. Windows/Linux no ejecutados.

## Pendientes vivos

| Estado | Síntoma / reproducción | Causa o siguiente paso |
|---|---|---|
| 🐞 Conector externo | getApp(com.microsoft.VSCode) devuelve `Sky Computer Use native pipe startup failed` antes de observar la ventana; mismo resultado tras js_reset | Servicio presente; causa no confirmada. Restablecer conexión Computer Use del cliente. No reiniciar VS Code ni tocar protecciones para eludirlo. |
| ⏳ Paquete final en host | Se validó fuente anterior en host, pero falta cargar el VSIX con correcciones y observar enlace a terminal | Abrir exclusivamente el host fixture `semaforo-test (Workspace)`; comprobar PID directo y resume sin duplicación. |
| ⏳ Hooks UI | Installer/remover pasan con FS real en tests; falta completar preview/Aplicar/retirada en UI | Usar HOME y ejecutables fixture; preservar entradas ajenas. Configurar no demuestra activación real ni sustituye confianza Codex. |
| ⏳ Historial/filtros/temas | Detalle y búsqueda 1/5 observados; falta selector historial, combinaciones/limpiar/agrupar y alternar paletas | Secuencia nativa exacta en informe de validación; cancelar no debe mutar. |
| ⏳ Recarga/confianza | Favorita persistente y workspace no confiable cubiertos en tests, no cerrados visualmente | Recargar solo host propio; verificar tiempo offline y guardas de comandos. |
| ⏳ Cierre | Tasks 5/6 y goal abiertos; no nueva publicación autorizada | Cerrar únicamente con evidencia de todos los pasos restantes. |

El pedido original de Manu fue «dale con todas pf.; tu /goal es terminar y validar todo». No reducir ese criterio a pruebas automáticas. La instrucción `/empaquemos-sesion` cierra el hilo dejando el trabajo recuperable; no declara las capacidades completamente aceptadas.

## Retomar

`/recuperar-proyecto claude-semaphore-vscode`

Leer primero el overview del índice, la sesión de cierre y el informe. Luego el ledger `.superpowers/sdd/2026-10-09-session-management/progress.md` del worktree. Tasks 1–4 y las seis correcciones ya terminadas no se repiten. Mantener ventanas, terminales fixture y worktrees: pueden contener un editor no guardado. Cambios sin seguimiento: `docs/releases/marketplace-1.0.0.jpg` y `docs/weekly-review/`, copiados de publicación estable y seguimiento local; conservados sin incorporar a publicación pública.

## Revisión semanal existente

Solicitada por Manu: Telegram, lunes 09:00 America/Lima. Job registrado anteriormente `3c758e02-edce-4434-8f4c-c7e2dc35b87e`; baseline 63 instalaciones / 149 descargas. Ver `docs/weekly-review/`. Estado del job no reconsultado en este cierre. Sin sesiones elegibles debe informar SIN MUESTRA. Sin correcciones ni releases automáticos.
