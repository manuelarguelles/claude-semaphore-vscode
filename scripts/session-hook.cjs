'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeEvent } = require('./hook-protocol.cjs');
const [provider, directory] = process.argv.slice(2);
// Observation only: zero stdout, no hook decisions, no agent failures on I/O errors.
let size = 0; const chunks = [];
process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size <= 65536) chunks.push(chunk);
  else { process.stdin.pause(); process.exit(0); }
});
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  let temporary;
  try {
    const event = normalizeEvent(provider, JSON.parse(Buffer.concat(chunks).toString('utf8')), Date.now());
    if (!event || !directory || !path.isAbsolute(directory)) return;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const key = crypto.createHash('sha256').update(JSON.stringify([provider, event.sessionId])).digest('hex');
    const target = path.join(directory, `${key}.json`);
    temporary = path.join(directory, `.${key}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target); temporary = undefined;
  } catch { /* telemetry must not block the normal agent flow */ }
  finally { if (temporary) { try { fs.unlinkSync(temporary); } catch {} } }
});
