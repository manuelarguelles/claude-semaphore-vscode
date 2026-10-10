# Roadmap

- Complete: Claude 0.3.0 base.
- Complete: Codex read-only reader, panel integration, terminal matching, regression tests.
- Complete: 1.0.0-rc.1 packaging and local reader smoke verification.
- Complete: rc.2 metadata compatibility fix, regression coverage, live 1/5 → 5/5 reader verification.
- Complete: user confirmed session visibility in-editor; 1.0.0 packaged and uploaded at user request.
- Complete: Microsoft validation; Marketplace shows 1.0.0 Public.
- Pending: further live synchronous-input coverage.
- Out of scope: Windows Codex discovery, unrecorded approvals, nested/async questions, gateway/subagent rows.

## Session management candidate — 2026-10-10
- Implemented and tested: grouping/search/filters/favorites/priority, five states, bounded history, provider launch/resume/fork, Git worktrees, optional hook configuration and stable receiver.
- Native host verified: five states/groups, search 1/5, details/favorite, real fixture terminals for Claude fork/resume and Codex start/worktree.
- Pending: remaining native hook/history/palette/reload flows after CUA pipe outage; final packaged-host acceptance. Independent review and its six regression fixes are complete.
- Candidate: 1.1.0-rc.1 local; stable Marketplace 1.0.0 unchanged.

2026-10-10 final source review: six Important findings reproduced and corrected in one RED→GREEN pass; 129 tests / 22 suites, TypeScript and build pass. Native pipe remains unavailable. Local candidate only; no completion claim or Marketplace update.
