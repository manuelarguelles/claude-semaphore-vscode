# Claude + Codex Semáforo

## Current state and recovery
Stable Marketplace 1.0.0; local candidate 1.1.0-rc.1 on feat/session-management. All agreed functionality implemented and reviewed; 129 tests, typecheck/build pass. Native acceptance remains partial because Computer Use cannot connect. Source of truth: STATE.md and docs/releases/1.1.0-rc.1-validation.md. Resume with `/recuperar-proyecto claude-semaphore-vscode`; do not repeat approved design/plan or completed tasks. Preserve original dirty published checkout and fixture host.

## Vision
Organize, inspect and manage local coding-agent sessions from VS Code using direct observed evidence.

## Stack
TypeScript, native VS Code TreeView/commands/terminals, Node filesystem and child_process, Vitest/esbuild. No new production dependencies.

## Constraints
Observe without model calls. Mutating actions are explicit user commands and require workspace trust. Never bypass agent permissions/trust, terminate existing sessions or automatically reload user windows. Hooks optional; preserve foreign configuration and keep telemetry free of conversation content.

## Scope
Project groups, literal search/filters/favorites/attention priority; five states and local observation history; known-session recovery/native pickers; start/resume/fork; Git worktrees; optional metadata-only lifecycle hooks.

## Validation
macOS ARM native development host plus CLI/filesystem/Git fixtures. Windows/Linux runtime not verified. Candidate remains local until validation/publication gates are met; Marketplace stable 1.0.0 remains available.

## Links
https://github.com/manuelarguelles/claude-semaphore-vscode
https://marketplace.visualstudio.com/items?itemName=ManuelArguelles.claude-semaphore
