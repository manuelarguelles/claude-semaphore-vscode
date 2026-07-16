import { describe, it, expect } from 'vitest';
import { extractLastAiTitle, TitleResolver } from '../src/titleResolver';

describe('extractLastAiTitle', () => {
  it('returns the last aiTitle across multiple lines', () => {
    const text = [
      '{"type":"user","aiTitle":"First title"}',
      '{"type":"assistant","content":"hi"}',
      '{"type":"user","aiTitle":"Latest title"}',
    ].join('\n');
    expect(extractLastAiTitle(text)).toBe('Latest title');
  });

  it('ignores a truncated first line (from tailing mid-file)', () => {
    const text = [
      'tatus":"busy"}',                          // garbage partial line
      '{"type":"user","aiTitle":"Good title"}',
    ].join('\n');
    expect(extractLastAiTitle(text)).toBe('Good title');
  });

  it('returns undefined when no aiTitle present', () => {
    expect(extractLastAiTitle('{"type":"user"}')).toBeUndefined();
  });
});

describe('TitleResolver caching', () => {
  it('re-reads only when mtime changes', () => {
    let reads = 0;
    let mtime = 100;
    const tail = () => { reads++; return '{"aiTitle":"T"}'; };
    const stat = () => ({ mtimeMs: mtime });
    const r = new TitleResolver(tail, stat);
    expect(r.resolve('/x.jsonl', 'fb')).toBe('T');
    expect(r.resolve('/x.jsonl', 'fb')).toBe('T'); // cached
    expect(reads).toBe(1);
    mtime = 200;
    expect(r.resolve('/x.jsonl', 'fb')).toBe('T'); // mtime changed → re-read
    expect(reads).toBe(2);
  });

  it('returns fallback when stat throws (missing file)', () => {
    const r = new TitleResolver(() => '', () => { throw new Error('nofile'); });
    expect(r.resolve('/missing.jsonl', 'fallback-name')).toBe('fallback-name');
  });
});
