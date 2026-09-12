import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexLogState, parseOpenRollouts, CodexReader } from '../src/codexSessions';

const event = (type: string, extra = {}) => ({ type: 'event_msg', payload: { type, ...extra } });
const response = (type: string, extra = {}) => ({ type: 'response_item', payload: { type, ...extra } });
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
function fixture(source: unknown = 'cli') {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semaphore-test-')); roots.push(dir);
 const file = path.join(dir, 'rollout-test.jsonl');
 fs.writeFileSync(file, JSON.stringify({type:'session_meta',payload:{id:'abc',cwd:'/work/project',source}})+'\n');
 return file;
}
function append(file: string, row: unknown) { fs.appendFileSync(file, JSON.stringify(row)+'\n'); }

describe('CodexLogState', () => {
 it('does not invent a stopped status for an unknown log', () => {
  const s = new CodexLogState(); s.accept(event('token_count')); expect(s.state).toBe('unknown');
 });
 it('tracks turn start, explicit question, matching answer and completion', () => {
  const s = new CodexLogState(); s.accept(event('task_started',{turn_id:'t'})); expect(s.state).toBe('running');
  s.accept(response('function_call',{name:'request_user_input',call_id:'q'})); expect(s.state).toBe('needsInput');
  s.accept(response('function_call_output',{call_id:'other'})); expect(s.state).toBe('needsInput');
  s.accept(response('function_call_output',{call_id:'q'})); expect(s.state).toBe('running');
  s.accept(event('task_complete',{turn_id:'t'})); expect(s.state).toBe('stopped');
 });
 it('clears pending questions on abort and ignores an old turn completion', () => {
  const s = new CodexLogState(); s.accept(event('task_started',{turn_id:'new'}));
  s.accept(event('task_complete',{turn_id:'old'})); expect(s.state).toBe('running');
  s.accept(response('custom_tool_call',{name:'functions.request_user_input',call_id:'q'}));
  s.accept(event('turn_aborted')); expect(s.state).toBe('stopped'); expect(s.waitingFor).toBeUndefined();
 });
 it('does not interpret a tool output containing fake event text as an event', () => {
  const s = new CodexLogState(); s.accept(event('task_started'));
  s.accept(response('custom_tool_call_output',{output: JSON.stringify(event('task_complete'))})); expect(s.state).toBe('running');
 });
});
describe('Codex discovery and files', () => {
 it('keeps multiple sessions per process, rejects unrelated paths and deduplicates descriptors', () => {
  expect(parseOpenRollouts('p42\nf1\nau\nn/x/sessions/2026/rollout-a.jsonl\nf2\naw\nn/x/sessions/2026/rollout-a.jsonl\nf3\naw\nn/x/sessions/2026/rollout-b.jsonl\np99\nf4\nar\nn/x/sessions/2026/rollout-old.jsonl\nf5\naw\nn/tmp/other.jsonl\n')).toEqual([
   {pid:42,file:'/x/sessions/2026/rollout-a.jsonl'}, {pid:42,file:'/x/sessions/2026/rollout-b.jsonl'}]);
 });
 it('reads main CLI sessions, carries partial lines, and observes appended completion', async () => {
  const file=fixture();append(file,event('task_started'));
  const reader=new CodexReader(); expect((await reader.read({pid:42,file}))?.state).toBe('running');
  fs.appendFileSync(file,'{"type":"event_msg","payload":');
  expect((await reader.read({pid:42,file}))?.state).toBe('running');
  fs.appendFileSync(file,'{"type":"task_complete"}}\n');
  expect((await reader.read({pid:42,file}))?.state).toBe('stopped');
 });
 it('excludes subagents and non-CLI sessions', async () => {
  const reader=new CodexReader();
  expect(await reader.read({pid:42,file:fixture({subagent:{thread_spawn:{}}})})).toBeUndefined();
  expect(await reader.read({pid:42,file:fixture('vscode')})).toBeUndefined();
 });
 it('handles a truncated file without carrying a stale state', async () => {
  const file=fixture();append(file,event('task_started'));const reader=new CodexReader();
  await reader.read({pid:42,file});fs.writeFileSync(file,'');
  expect(await reader.read({pid:42,file})).toBeUndefined();
 });
 it('does not retain deleted files or fail on a missing file', async () => {
  expect(await new CodexReader().read({pid:42,file:'/nonexistent/rollout.jsonl'})).toBeUndefined();
 });
});

it('uses unknown when a bounded tail has no observable lifecycle event', async () => {
 const file=fixture(); append(file,event('task_started'));
 append(file,response('custom_tool_call_output',{output:'x'.repeat(1100000)}));
 append(file,event('token_count'));
 const s=await new CodexReader().read({pid:42,file});
 expect(s?.state).toBe('unknown');
});
it('retains multiple unanswered synchronous questions until all outputs arrive', () => {
 const s=new CodexLogState();s.accept(event('task_started'));
 s.accept(response('function_call',{name:'request_user_input',call_id:'a'}));
 s.accept(response('function_call',{name:'request_user_input',call_id:'b'}));
 s.accept(response('function_call_output',{call_id:'a'}));expect(s.state).toBe('needsInput');
 s.accept(response('function_call_output',{call_id:'b'}));expect(s.state).toBe('running');
});
it('does not mistake async tool acknowledgement for a user answer', () => {
 const s=new CodexLogState();s.accept(event('task_started'));
 s.accept(response('function_call',{name:'request_user_input_async',call_id:'a'}));
 s.accept(response('function_call_output',{call_id:'a'}));
 expect(s.state).toBe('running'); // async questions are deliberately unsupported
});
