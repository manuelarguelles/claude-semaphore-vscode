import { it, expect } from 'vitest';
import { sessionKey } from '../src/sessionIdentity';
import { renderSignature } from '../src/renderSignature';
import { SessionState } from '../src/types';
const base: SessionState = {sessionId:'abc',pid:42,cwd:'/x',title:'x',state:'running'};
it('separates threads sharing a process and agents sharing a thread name', () => {
 expect(sessionKey(base)).not.toBe(sessionKey({...base,sessionId:'def'}));
 expect(sessionKey(base)).not.toBe(sessionKey({...base,provider:'codex'}));
});
it('repaints when the provider label changes', () => {
 expect(renderSignature([base],new Set(),'classic')).not.toBe(renderSignature([{...base,provider:'codex'}],new Set(),'classic'));
});
