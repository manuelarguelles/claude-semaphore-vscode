import * as fs from 'fs';

export function extractLastAiTitle(text: string): string | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"aiTitle"')) {
      continue;
    }
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.aiTitle === 'string' && obj.aiTitle.length > 0) {
        return obj.aiTitle;
      }
    } catch {
      // truncated/partial line from tailing mid-file; skip
    }
  }
  return undefined;
}

function readTail(path: string, maxBytes: number): string {
  const fd = fs.openSync(path, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

interface CacheEntry {
  mtimeMs: number;
  title: string;
}

export class TitleResolver {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readFileTail: (path: string, maxBytes: number) => string = readTail,
    private statFn: (path: string) => { mtimeMs: number } = fs.statSync,
  ) {}

  resolve(transcriptPath: string, fallback: string): string {
    let mtimeMs: number;
    try {
      mtimeMs = this.statFn(transcriptPath).mtimeMs;
    } catch {
      return fallback;
    }
    const cached = this.cache.get(transcriptPath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.title;
    }
    const title = extractLastAiTitle(this.readFileTail(transcriptPath, 64 * 1024)) ?? fallback;
    this.cache.set(transcriptPath, { mtimeMs, title });
    return title;
  }
}
