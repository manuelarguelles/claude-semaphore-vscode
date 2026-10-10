import { RecordedSession, observedDurations } from './sessionJournal';
import { stateLabels } from './sessionPresentation';
const safe = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');
export function formatSessionDetails(session: RecordedSession): string {
  const last = session.events[session.events.length - 1];
  const durations = observedDurations(session);
  return [safe(session.title), `Proveedor: ${session.provider}`, `Proyecto: ${safe(session.cwd)}`, `Sesión: ${session.sessionId}`,
    `Estado: ${last?.state === 'offline' ? 'No observada actualmente' : last ? stateLabels[last.state] : 'Desconocido'}`,
    `Última observación: ${new Date(session.lastSeenAt).toLocaleString()}`,
    `Fuente: ${last?.source ?? 'sin señal'} · motivo: ${last?.reason ?? 'sin señal'}`, '', 'Tiempo observado (sin contar el editor cerrado):',
    ...Object.entries(durations).map(([state, ms]) => `${stateLabels[state as keyof typeof stateLabels]}: ${Math.round(ms / 1000)} s`),
    '', 'Historial de observaciones:', ...session.events.map(e => `${new Date(e.at).toLocaleString()} · ${e.state === 'offline' ? 'fuera de observación' : stateLabels[e.state]} · ${e.source} · ${e.reason}`),
    '', 'Las señales locales pueden ser parciales. Un tiempo sin cambios no prueba bloqueo ni error.'].join('\n');
}
