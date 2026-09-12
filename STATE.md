# State — 2026-09-11

## Current phase
Claude + Codex support implemented; 1.0.0-rc.1 prepared. Stable 1.0.0 is not declared.

## Validation
- 81 tests passed in 12 suites, including real file readers and activation integration behind a VS Code API boundary.
- TypeScript noEmit and esbuild pass; VSIX built and contents inspected.
- Read-only smoke on Codex CLI 0.154.0 found 5 main CLI sessions among 15 open rollouts. One sample observed 4 running and 1 stopped; values are transient.
- Independent review caught historical read-only file attribution; fixed by requiring writable lsof descriptors and added regression coverage.

## Constraints and limitations
Existing VS Code still has Claude Semáforo 0.3.0 installed. No active terminal, agent session, or window was closed/reloaded. No live agent hooks/configuration were altered. 1.0.0-rc.1 is an installer artifact, not a Marketplace release.
Codex statuses are best-effort rollout observations. Unrecorded permission prompts, asynchronous/nested questions, non-CLI sessions and subagents are unsupported. Unknown is explicit when no sufficient event exists within bounded reads.

## Next action
Validate the RC in a separate Extension Development Host or install after active jobs finish. Verify the visible mixed panel, per-session terminal reveal and a real synchronous input request. Then decide stable 1.0.0 promotion.
