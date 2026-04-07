# Changelog

## 0.1.5 - 2026-04-07

- strip already-loaded global `AGENTS.md` / `CLAUDE.md` context reliably instead of rereading live files from disk
- remove the now-empty `# Project Context` section when only global context was loaded
- handle prompts whose custom prompt text also mentions the `# Project Context` heading
- make `/local-agents-only off` report when the repo is still enabled via the global allowlist or `PI_LOCAL_AGENTS_ONLY`
- document the repo-marker-only behavior of `/local-agents-only off`
- add integration tests against pi's real system prompt builder and command UX regressions
