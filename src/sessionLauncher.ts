import * as path from 'path';
import { Provider } from './types';
import { AgentCapabilities } from './agentCapabilities';
export interface LaunchRequest { provider: Provider; cwd: string; action: 'start' | 'resume' | 'fork'; sessionId?: string; nativePicker?: boolean }
export interface LaunchSpec { executable: string; args: string[]; cwd: string }
export function buildLaunch(request: LaunchRequest, capabilities: AgentCapabilities): LaunchSpec {
  if (capabilities.provider !== request.provider || !capabilities.start || !capabilities[request.action]) throw new Error('Esta operación no está disponible en el CLI instalado.');
  if (!path.isAbsolute(request.cwd) || /[\x00-\x1f]/.test(request.cwd)) throw new Error('La carpeta debe ser una ruta absoluta válida.');
    let args: string[] = [];
    if (request.action !== 'start') {
      const id = request.sessionId;
      if (request.action === 'resume' && request.nativePicker && !id) {
        if (request.provider === 'claude') return { executable: capabilities.executable, args: ['--resume'], cwd: request.cwd };
        if (request.provider === 'opencode') return { executable: capabilities.executable, args: ['-c'], cwd: request.cwd };
        return { executable: capabilities.executable, args: ['resume'], cwd: request.cwd };
      }
      if (!id || !/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,199}$/.test(id)) throw new Error('ID de sesión no válido.');
      if (request.provider === 'opencode') {
        args = ['-s', id, ...(request.action === 'fork' ? ['--fork'] : [])];
      } else {
        args = request.provider === 'claude' ? ['--resume', id, ...(request.action === 'fork' ? ['--fork-session'] : [])] : [request.action, id];
      }
    }
  return { executable: capabilities.executable, args, cwd: request.cwd };
}
