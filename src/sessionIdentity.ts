import { SessionState } from './types';
export function sessionKey(s: SessionState): string { return JSON.stringify([s.provider ?? 'claude', s.sessionId, s.pid]); }
