# Claude + Codex Semáforo

## Vision
A read-only VS Code panel showing local coding-agent activity and revealing the matching terminal.
## Stack
TypeScript, VS Code, Node fs/child_process, vitest, esbuild.
## Constraints
Never close/reload terminals or write agent configuration. Preserve existing Claude settings and extension ID. Codex status is best-effort with documented observability limits.
## Scope
Claude session files; writable main CLI Codex rollouts on macOS/Linux; explicit unknown state; safe process ancestry linking.
## Links
https://github.com/manuelarguelles/claude-semaphore-vscode
