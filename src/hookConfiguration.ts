import { Provider } from './types';
const { EVENTS } = require('../scripts/hook-protocol.cjs') as { EVENTS: Record<Provider, string[]> };
type Handler = Record<string, unknown>;
type Group = { matcher?: string; hooks: Handler[]; [key: string]: unknown };
function validate(original: unknown): { [key: string]: unknown; hooks?: Record<string, Group[]> } {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Configuración JSON no válida; no se modificó.');
  const c = JSON.parse(JSON.stringify(original));
  if (c.hooks !== undefined && (!c.hooks || typeof c.hooks !== 'object' || Array.isArray(c.hooks))) throw new Error('hooks no es un objeto; no se modificó.');
  for (const groups of Object.values(c.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.some(g => !g || !Array.isArray(g.hooks))) throw new Error('Entradas hooks no válidas; no se modificó.');
  }
  return c;
}
export function mergeHooks(provider: Provider, original: unknown, command: string): unknown {
  const c = validate(original); c.hooks ??= {};
  for (const event of EVENTS[provider]) {
    const groups = c.hooks[event] ?? [];
    if (!groups.some(g => g.hooks.some(h => h.type === 'command' && h.command === command))) {
      groups.push({ hooks: [{ type: 'command', command, timeout: 2 }] });
    }
    c.hooks[event] = groups;
  }
  return c;
}
export function removeOwnHooks(provider: Provider, original: unknown, command: string): unknown {
  const c = validate(original);
  for (const event of EVENTS[provider]) {
    const groups = c.hooks?.[event]; if (!groups) continue;
    const remaining = groups.map(g => ({ ...g, hooks: g.hooks.filter(h => !(h.type === 'command' && h.command === command)) })).filter(g => g.hooks.length);
    if (remaining.length) c.hooks![event] = remaining; else delete c.hooks![event];
  }
  if (c.hooks && !Object.keys(c.hooks).length && !(original as any).hooks) delete c.hooks;
  return c;
}
export function hookCommand(node: string, receiver: string, directory: string, provider: Provider, platform: NodeJS.Platform = process.platform): string {
  const values = [node, receiver, provider, directory];
  if (values.some(v => /[\x00-\x1f]/.test(v))) throw new Error('Ruta de hook no válida.');
  if (platform === 'win32') {
    if (values.some(v => /["%!]/.test(v))) throw new Error('La ruta contiene caracteres no compatibles con hooks en Windows.');
    return values.map(v => `"${v}"`).join(' ');
  }
  return values.map(v => `'${v.replace(/'/g, `'"'"'`)}'`).join(' ');
}
