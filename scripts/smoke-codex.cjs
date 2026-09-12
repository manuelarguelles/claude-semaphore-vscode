// Read-only probe: print aggregate counts and states, never transcript text.
const esbuild = require('esbuild');
esbuild.buildSync({entryPoints:['src/codexSessions.ts'],bundle:true,platform:'node',format:'cjs',outfile:'out/codex-smoke.cjs'});
const {CodexReader,discoverCodexRollouts}=require('../out/codex-smoke.cjs');
(async()=>{
 const files=await discoverCodexRollouts(); const reader=new CodexReader();
 const start=Date.now(); const sessions=(await Promise.all(files.map(f=>reader.read(f)))).filter(Boolean);
 console.log(JSON.stringify({openRollouts:files.length,cliSessions:sessions.length,readMs:Date.now()-start,states:sessions.map(s=>s.state)},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
