# Matriz de aceptación — gestión de sesiones

Fecha: 2026-10-10. Diseño, plan y ejecución aprobados. Implementación y revisión terminadas; aceptación nativa parcial. Evidencia detallada: [validación del candidato](1.1.0-rc.1-validation.md).

| Requisito | Evidencia | Estado |
|---|---|---|
| Checkpoint estable | Fuente/VSIX 1.0.0 archivados, hashes y restauración registrados | Verificado |
| Regresiones | 129 pruebas / 22 suites; TypeScript/build correctos | Verificado |
| Agrupación | CWD completo y colisiones en tests; host con grupos separados | Verificado |
| Búsqueda y filtros | Combinaciones y vacío en tests; databricks 1/5 nativo | Parcial: combinación/limpiar/agrupar nativos pendientes |
| Favoritas/prioridad | Orden y persistencia en tests; estrella nativa | Parcial: recarga nativa pendiente |
| Cinco estados | Etiquetas/paletas/summary/tooltip en tests; cinco estados nativos | Parcial: alternar paletas nativo pendiente |
| Diagnóstico/duración | Detalle nativo; intervalo inconsistente y reload RED→GREEN | Verificado |
| Historial | Dedupe/offline/corrupción/límites y almacenamiento; contenido visible en detalle | Parcial: selector nativo pendiente |
| Hooks Claude/Codex | Receptor real, concurrencia, argv, sanitización, versiones; instalación/retirada FS real y fallo de ownership | Parcial: flujo UI y activación real pendientes |
| Inicio/resume/fork | Capacidades/argv/cancelación en tests; terminales nativos con fixtures Claude fork/resume y Codex start | Verificado con fixtures, sin inferencia real |
| Enlace a terminal | PID directo/ancestros/CWD/pruning; regresión del PID propio RED→GREEN | Parcial: observación nativa tras corrección pendiente |
| Worktrees | Git real en tests y creación nativa con Codex fixture/CWD con espacios | Verificado |
| Confianza | Guardas de comandos y manifest con cobertura automática | Parcial: workspace no confiable nativo pendiente |
| Lectores | Claude nativo y Codex real: 11 abiertos, 4 CLI elegibles, 22 ms | Verificado en macOS |
| VSIX | 11 archivos, hash, receptor extraído ejecutado, fuentes/datos privados excluidos | Parcial: carga del paquete final en host pendiente |
| Revisión/documentación | Revisor independiente, seis Important RED→GREEN, suite final; docs/índice actualizados | Verificado |

El puente nativo devuelve `Sky Computer Use native pipe startup failed` incluso tras reset de bindings. Objetivo no completo: no confundir cobertura automática con aceptación gráfica. Se preservaron ventanas y fixtures para reanudar sin reconstruir el trabajo.
