'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeEvent } = require('./hook-protocol.cjs');
const [provider, directory] = process.argv.slice(2);
// Observation only: zero stdout, no hook decisions, bounded waits and metadata.
let size = 0; const chunks = [];
process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size <= 65536) chunks.push(chunk);
  else { process.stdin.pause(); process.exit(0); }
});
process.stdin.on('error', () => process.exit(0));
async function acquire(lock) {
  const deadline = Date.now() + 1000;
  do {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      try { fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 }); }
      catch (error) { fs.rmdirSync(lock); throw error; }
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Only recover a dead writer; never steal a live or initializing lock.
      try {
        const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
        if (Number.isInteger(pid) && pid > 1) {
          try { process.kill(pid, 0); }
          catch (e) { if (e.code === 'ESRCH') { fs.unlinkSync(path.join(lock, 'pid')); fs.rmdirSync(lock); } }
        }
      } catch (e) {
        if (e.code === 'ENOENT' && Date.now() - fs.statSync(lock).mtimeMs > 5000) { try { fs.rmdirSync(lock); } catch {} }
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } while (Date.now() < deadline);
  return false;
}
process.stdin.on('end', async () => {
  let temporary; let locked = false; let lock;
  try {
    const event = normalizeEvent(provider, JSON.parse(Buffer.concat(chunks).toString('utf8')), Date.now());
    if (!event || !directory || !path.isAbsolute(directory)) return;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    lock = path.join(directory, '.writer-lock'); locked = await acquire(lock);
    if (!locked) return;
    const key = crypto.createHash('sha256').update(JSON.stringify([provider, event.sessionId])).digest('hex');
    const target = path.join(directory, `${key}.json`);
    let previous; try { previous = JSON.parse(fs.readFileSync(target, 'utf8')); } catch {}
    if (!previous || !(previous.at > event.at)) {
      temporary = path.join(directory, `.${key}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
      fs.writeFileSync(temporary, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, target); temporary = undefined;
    }
    // Serialization also bounds storage. Touch current sessions, expire old
    // artifacts and retain the newest 1,000; foreign files/symlinks are untouched.
    const files = [];
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(directory, name); const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (Date.now() - stat.mtimeMs > 30 * 86400000) fs.unlinkSync(file);
      else files.push({ file, at: stat.mtimeMs });
    }
    files.sort((a, b) => b.at - a.at || (a.file === target ? -1 : b.file === target ? 1 : a.file.localeCompare(b.file)));
    for (const entry of files.slice(1000)) fs.unlinkSync(entry.file);
  } catch { /* telemetry must not block the normal agent flow */ }
  finally {
    if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
    if (locked) { try { fs.unlinkSync(path.join(lock, 'pid')); fs.rmdirSync(lock); } catch {} }
  }
});
