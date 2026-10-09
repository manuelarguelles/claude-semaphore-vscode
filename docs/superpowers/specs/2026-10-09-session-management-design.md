# Semáforo: organización, diagnóstico y gestión de sesiones

Fecha: 2026-10-09. Estado: especificación aprobada por Manuel el 2026-10-09 mediante respuesta «Apruebo la especificación».

## Objetivo y autorización

Manuel aprobó todas las capacidades propuestas y pidió terminar y validar el trabajo mediante un goal: agrupación por proyecto, búsqueda, filtros, favoritas, prioridad de atención, historial, explicación de estados, eventos opcionales, inicio, recuperación, bifurcación y worktrees. Implementación propia para VS Code, sin dependencia ni copia del código de Agent Deck. El alcance es esa propuesta; no incluye un gestor de MCP, cuentas, canales remotos o un conductor autónomo.

El resultado debe servir a otros usuarios: rutas derivadas del entorno y ajustes del usuario, sin rutas de Manuel, credenciales o dependencias de su infraestructura. Observar y organizar no debe invocar modelos. Los agentes conservan sus mecanismos de autenticación, permisos y consumo.

La publicación anterior está autorizada para 1.0.0 y ya se realizó. Esta entrega produce una nueva versión candidata local y su evidencia; publicar otra versión en Marketplace es una acción posterior sobre el artefacto validado.

## Base verificada

Repositorio: `claude-semaphore-codex`, ID de extensión `manuelarguelles.claude-semaphore`, versión 1.0.0. Rama actual `feat/codex-sessions`, cambios de la publicación anterior sin integrar. No descartar, sobrescribir ni incluir esos cambios accidentalmente en un commit de diseño. Antes de implementar, guardar VSIX estable y una copia verificable del árbol fuente actual; desarrollar en un worktree aislado que incorpore ese estado.

Validación inicial: 86 tests en 12 suites, `tsc --noEmit` y build correctos. El warning CJS de Vite ya existe. Lectores actuales: archivos Claude, rollouts Codex descubiertos por lsof, enlace de terminal por PID/ancestros/CWD y notificación sonora de atención. Conservar los tests de metadatos Codex `vscode`/`codex-tui` y exclusión de subagentes.

CLI instalados inspeccionados sin iniciar inferencia: Claude 2.1.295 y Codex 0.160.0. Claude expone `--resume`, `--fork-session`, `--settings`, `--worktree`; Codex expone `resume`, `fork`, `--cd`, `--worktree`. Estas capacidades no se presuponen en equipos ajenos.

## Enfoque seleccionado

1. **Extender la vista nativa y usar terminales integradas (recomendado):** reutiliza el editor, sus accesos, permisos y lectores actuales. Añade componentes pequeños para organización, persistencia, eventos y gestión. No requiere tmux, un servicio remoto o un motor de embeddings.
2. Introducir un daemon propio: permitiría compartir todo entre ventanas, pero aumenta instalación, mantenimiento y superficie de fallo. No necesario para este alcance.
3. Gestionar todo mediante tmux: útil fuera del editor, pero cambia la experiencia y añade una dependencia. No seleccionado.

La interfaz principal sigue siendo el TreeView nativo. El detalle e historial se muestran en una vista de documento local o panel nativo, con texto escapado. La búsqueda se abre desde la barra de la vista mediante InputBox; filtros mediante QuickPick. Las acciones también figuran en la paleta.

## Modelo y responsabilidades

- `SessionState`: mantener identidad de proveedor, sesión y proceso; añadir evidencia, fecha de observación y estado explícito de error. Para identidad persistente usar proveedor + sessionId, sin confundir procesos distintos que compartan PID.
- `sessionPresentation`: búsqueda literal insensible a mayúsculas sobre nombre, proveedor y ruta; filtros por estado/proveedor, solo favoritas, agrupación por ruta completa de proyecto y orden determinista. Aplicar filtros antes de formar grupos. Dentro de cada grupo: atención, error, trabajando, inactivo, desconocido; favoritas primero dentro del mismo nivel. Grupos con atención antes de grupos sin atención.
- `sessionJournal`: registros locales versionados y acotados de sesiones conocidas y transiciones. Preferencias en Memento; historial/catalogación en almacenamiento local de la extensión. No guardar mensajes de conversación, prompts, resultados de herramientas o secretos. Escrituras serializadas/atómicas o mediante Memento, con validación al cargar y recuperación de datos corruptos.
- `sessionEvents`: normalizar exclusivamente campos permitidos de los hooks y resolver evidencia frente a los lectores. Eventos antiguos, desconocidos, malformados y de subagentes no cambian una sesión principal. Nunca inferir atención por silencio.
- `agentCapabilities` y `sessionLauncher`: resolver ejecutables, inspeccionar ayuda con timeout y caché, construir argumentos por proveedor y ejecutar cada agente en una terminal nueva, con CWD explícito. No concatenar texto arbitrario en comandos de shell. Errores de lanzamiento se muestran y no se anuncian como éxito.
- `worktreeManager`: operaciones Git con `execFile` y argumentos separados, timeout, validación de repositorio, nombre de rama y destino, prevención de colisiones. Crear rama y worktree nuevos desde HEAD; no copiar modificaciones no confirmadas ni borrar worktrees/ramas existentes.
- `extension.ts`: composición, comandos y refresh; extraer presentación para evitar mezclar estado, persistencia y acciones.

No introducir paquetes de producción salvo que una necesidad comprobada lo exija; usar Node y la API estable de VS Code.

## Organización y experiencia

Agrupación por proyecto activada por defecto, con opción de lista plana. Rutas distintas con igual basename no se fusionan. IDs estables para grupos y filas; conservar expansión y selección.

Comandos: buscar, elegir filtros, limpiar filtros, alternar favorita, alternar agrupación, actualizar, abrir detalle, abrir historial, iniciar, retomar, bifurcar y crear sesión en worktree. Menús de sesión ofrecen acciones según capacidad; sesiones sin terminal pueden abrir detalle y retomarse, sin tratar de revelar una terminal arbitraria.

La vista indica filtros activos y número visible/total. El status bar refleja las sesiones activas totales y distingue esa cifra del filtro. El mensaje de vacío explica si faltan sesiones o si el filtro no tiene coincidencias. El comando de limpiar filtros siempre está accesible.

Favoritas por proveedor + sessionId, persistentes entre recargas; no por título o PID. Las preferencias de búsqueda/filtros son locales a la ventana/workspace. Sesiones conocidas que ya no están activas figuran en el selector de recuperación, separadas de las activas.

No repintar cada dos segundos solo para actualizar una duración. Usar firma de los campos visibles, manteniendo el arreglo del hover existente. Duración calculada al abrir detalle/historial; transiciones reales disparan la actualización.

## Estados, evidencia e historial

Estados visibles: trabajando (verde), necesita respuesta (amarillo), inactivo/finalizado (gris), error observado (rojo) y desconocido (símbolo de pregunta). Se puede conservar el nombre interno `stopped` para compatibilidad, pero su etiqueta y color dejan de implicar error. Actualizar las tres paletas, resumen, tooltips, documentación y tests coherentemente.

Error solo ante evento de fallo explícito del agente o registro estructurado equivalente. Un fallo de lsof/lector es un diagnóstico de descubrimiento, no un error de todas las sesiones. Una herramienta fallida aislada no significa que el agente entero falló.

Detalle: proveedor, proyecto, sesión, estado, motivo estructurado, fuente de evidencia, última observación y tiempo observado en el estado. No confundir última lectura de un archivo con última actividad. No presentar duración de tarea, porcentaje completado o coste inferidos.

Historial: registrar primera observación, cambio de estado/motivo y desaparición de la lista activa; deduplicar ticks iguales. Restaurar transiciones al recargar sin inventar continuidad durante el tiempo que el editor estuvo cerrado. Retención por defecto: 30 días, máximo 1.000 sesiones y 200 eventos por sesión; purgar lo más antiguo. Comando explícito para limpiar historial. Recuperación usa el catálogo local y ofrece el selector nativo cuando la sesión deseada no está registrada.

## Eventos y hooks opcionales

Observación existente funciona con hooks desactivados. Ofrecer configuración opcional mediante comando explícito: mostrar archivos/entradas que se agregarán, fusionar solo entradas propias, hacer copia previa y permitir retirar exclusivamente las entradas de Semáforo. No editar configuración al activar la extensión, ni autorizar permisos o saltar la confianza del proveedor.

Claude: eventos de inicio, prompt, herramientas, PermissionRequest/Notification, Stop, StopFailure y SessionEnd según soporte verificado. Codex: hooks actuales de ciclo de sesión/turno, PermissionRequest e Interrupt según disponibilidad. `notify` legado solo informa finalización; no prometer permisos usando ese mecanismo. Mostrar capacidad parcial cuando un CLI no soporta los eventos solicitados.

Receptor local empaquetado, invocado mediante Node disponible en el entorno o un ejecutable configurable verificado. Lee JSON de stdin con límite de tamaño, escribe solo esquema permitido y no produce decisiones ni contexto en stdout. Fallar sin bloquear al agente. Timeout corto y sin hooks de tipo prompt/agent que consuman tokens.

Datos mínimos: proveedor, sessionId, evento, CWD, hora y correlación de turno cuando exista; no almacenar argumentos ni contenido del modelo. Identificar subagentes y descartarlos para la vista principal. Usar archivos por sesión con reemplazo atómico para impedir líneas intercaladas y acotar almacenamiento. Validar nombres/rutas para evitar traversal. Eventos tienen precedencia solo si la correlación y el orden temporal lo justifican; al aparecer evidencia posterior de trabajo/fin, retirar el amarillo anterior. Documentar cualquier intervalo no observable.

La documentación oficial actual de Codex exige revisión/confianza de hooks por hash: no usar `--dangerously-bypass-hook-trust`. La instalación por sí sola no demuestra que el hook está activo; diagnósticos deben distinguir configurado, compatible y señal recibida.

## Inicio, recuperación, bifurcación y worktrees

Inicio: elegir proveedor y carpeta; lanzar sesión interactiva sin prompt automático, con permisos normales. Recuperación: elegir sesión conocida y usar ID explícito; alternativa selector nativo del proveedor. Si la sesión sigue activa y tiene terminal, ofrecer revelarla en lugar de iniciar recuperación concurrente. En ausencia de terminal, advertir de sesión activa antes de retomar.

Bifurcación: Claude `--resume <id> --fork-session`; Codex `fork <id>`. Validar ID y soporte, no reutilizar el original como sustituto silencioso. No afirmar que la bifurcación está completada hasta observar su nueva identidad; separar terminal creada de sesión detectada.

Worktree: elegir carpeta repo, rama nueva y destino vacío/no existente. Crear mediante Git y arrancar agente en ese directorio. Permitir sesión nueva o bifurcación solo si la combinación funciona realmente con ese proveedor. No alterar el CWD de sesiones en ejecución. Si falla el agente tras crear el worktree, conservarlo y explicar cómo retomarlo; no rollback destructivo. Validar repositorios con espacios, subdirectorios, HEAD ausente, rama/destino existentes y cambios locales.

Bloquear operaciones que ejecutan agentes/modifican configuración/Git en workspaces sin confianza, mientras la observación y organización siguen disponibles. No ejecutar prompts reales de prueba en sesiones del usuario. Integración con terminales usa sesiones y repositorios temporales controlados.

## Portabilidad y límites

Pruebas de ejecución local en macOS ARM; no declarar Windows/Linux verificados sin correr allí. Mantener diagnóstico de lsof en macOS/Linux y degradación honesta en Windows. Acciones de CLI pueden funcionar independientemente del descubrimiento si los ejecutables y sus capacidades están disponibles. Configurar rutas propias para instalaciones fuera de PATH.

El catálogo de recuperación almacena sesiones observadas por Semáforo, no todo el historial de todos los productos. No gestionar credenciales, controlar agentes ajenos, enviar mensajes, cambiar modelos ni estimar dinero automáticamente.

## Validación y aceptación

1. Checkpoint estable verificable: VSIX 1.0.0, SHA-256, fuente y comandos de restauración; árbol original preservado.
2. Tests de presentación: grupos, colisiones de nombres, búsqueda, filtros combinados, orden de atención/favoritas, IDs y vacío. Tests de integración de comandos y estado de vista.
3. Tests de journal: deduplicación, reload, cambio de PID, desaparición, límites, corrupción, errores de escritura y ausencia de prompts/secretos.
4. Tests de estados/eventos: espera/permiso, resolución, Stop, fallo explícito, eventos viejos, turnos diferentes, entradas parciales, subagentes y no amarillo por inactividad.
5. Hooks: configuración idempotente y retirada preservando entradas ajenas; probar receptor real con fixtures, no solo mocks; errores no bloquean ni producen decisiones. Verificar empaquetado/ruta de Node/confianza requerida.
6. Lanzadores: comandos exactos con IDs/rutas que incluyen espacios, sin interpretación de shell; fallback ante CLI ausente/incompatible; repositorios temporales reales para crear worktrees sin modificar el repo del usuario.
7. Validar terminales en Extension Development Host con ejecutables controlados que registren argv/CWD; probar cada acción y flujo cancelado. Prueba de humo real de lectores actuales, sin consumir tokens ni enviar un prompt.
8. Revisión visual en host de desarrollo: grupos, filtros, favoritos, detalle/historial, estados, vacíos y legibilidad con paletas. No recargar ni cerrar la ventana de trabajo del usuario.
9. Tests completos, TypeScript, build y VSIX. Inspeccionar contenido de paquete: incluye receptor necesario; excluye corpus, snapshots de usuario, credenciales y documentos privados. Registrar resultados y limitaciones por plataforma/CLI.
10. Actualizar README, changelog, PROJECT, ROADMAP, STATE y sesión del índice. Revisión independiente según WORKFLOW antes del cierre. Marcar goal completo únicamente cuando todas las funciones acordadas estén implementadas y verificadas; ninguna capacidad pendiente debe presentarse como terminada.

## Fuentes de compatibilidad

- Ayuda de Claude 2.1.295 y Codex 0.160.0 inspeccionada localmente el 2026-10-09.
- Codex hooks: https://learn.chatgpt.com/docs/hooks
- Claude hooks: https://code.claude.com/docs/en/hooks
- Agent Deck como referencia de capacidades, no como dependencia ni código fuente de esta implementación: https://github.com/asheshgoplani/agent-deck

## Revisión del documento

Scope delimitado a las capacidades aprobadas; observación separada de ejecución; respaldo y permisos definidos; estados y fuentes distinguidos; retención acotada; pruebas y límites explícitos. La siguiente etapa es revisar esta especificación, redactar el plan de implementación y ejecutar en el worktree aislado.
