# Codex sessions implementation plan

Goal: add read-only local Codex CLI monitoring to the existing Claude semaphore, without interrupting live sessions.
Architecture: discover open Codex rollout files with one asynchronous lsof call; read metadata and recent events incrementally with bounded buffers; keep Claude reader intact. Session identity includes provider, session id and pid. Unknown status is explicit. Terminal linking uses process ancestry, never ambiguous cwd.
Tech stack: TypeScript, VS Code API, Node fs, vitest, esbuild, vsce. macOS/Linux lsof for Codex; no hooks/config writes/network.

- [x] Test and implement Codex event reducer: starts, completion, abort, synchronous input request/output, unknown events.
- [x] Test and implement discovery and bounded reader: partial writes, truncation, multiple sessions per pid, ignore non-CLI/subagents, unchanged files, failures.
- [x] Test and implement ancestor terminal linkage with ambiguous-folder protection.
- [x] Integrate provider labels, unknown state, collision-free row identity, non-overlapping refresh and disabled/discovery-error behavior.
- [x] Validate tests, TypeScript, build, VSIX contents, real local Codex metadata only. Independent review and fixes.
- [x] Document limitations and release criteria. Package release candidate; no host reload or marketplace publication without explicit instruction.

Release target: 1.0.0 after verification; candidate while GUI/live approval-state coverage remains incomplete. Yellow means a persisted explicit input request; approval prompts not persisted cannot reliably be inferred. This limitation must be visible in docs/tooltips.
