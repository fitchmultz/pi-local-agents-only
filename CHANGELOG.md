# Changelog

## Unreleased

- updated the local pi development baseline to `@earendil-works/pi-coding-agent` `0.76.0` and regenerated the npm lockfile
- reviewed the pi `0.76.0` changelog and package guidance; the extension remains compatible with current system-prompt and package-loading behavior

## 0.1.16 - 2026-05-23

- updated the local pi development baseline to `@earendil-works/pi-coding-agent` `0.75.5`, refreshed Node tooling, and regenerated the npm lockfile
- reviewed the pi `0.75.5` changelog and package guidance; the extension remains compatible with current system-prompt and package-loading behavior

## 0.1.15 - 2026-05-18

- updated the local pi development baseline to `@earendil-works/pi-coding-agent` `0.75.3` and refreshed the npm lockfile
- raised the local Node.js tooling floor to `>=22.19.0`
- ignored local `.cueloop/` runtime state
- reviewed current pi `0.75.3` package and extension guidance and confirmed the extension remains compatible with current system-prompt and package-loading behavior


## 0.1.14 - 2026-05-07

- migrated the local pi development baseline and peer metadata from deprecated `@mariozechner/*` packages to maintained `@earendil-works/*` `0.74.0`
- regenerated the npm lockfile against the current stable dependency graph
- reviewed the pi `0.74.0` changelog and confirmed the extension remains compatible with current system-prompt and package-loading behavior

## 0.1.13 - 2026-05-01

- updated the local pi development baseline to `@mariozechner/pi-coding-agent` `0.72.0`
- regenerated the npm lockfile against the current stable dependency graph
- aligned pi core peer metadata with current pi package guidance
- reviewed the pi `0.72.0` changelog and confirmed the extension remains compatible with current system-prompt and package-loading behavior


## 0.1.12 - 2026-05-01

- updated the local pi development baseline to `@mariozechner/pi-coding-agent` `0.71.1`
- regenerated the npm lockfile against the current stable dependency graph
- reviewed the pi `0.71.1` changelog and confirmed the extension remains compatible with current system-prompt and package-loading behavior


## 0.1.11 - 2026-04-23

- updated the local pi development baseline to `@mariozechner/pi-coding-agent` `0.70.0`
- regenerated the npm lockfile against the current stable dependency graph
- reviewed the pi `0.70.0` changelog and confirmed the extension does not depend on the TypeBox migration surface, removed cwd-bound helpers, or stale session-replacement objects, or changed terminal progress defaults


## 0.1.10 - 2026-04-21

- updated the local pi development baseline to `@mariozechner/pi-coding-agent` `0.68.0`
- regenerated the npm lockfile against the current stable dependency graph
- reviewed the pi `0.68.0` changelog and confirmed the extension does not depend on removed cwd-bound tool exports or implicit cwd helper fallbacks

## 0.1.9 - 2026-04-18

- bumped the local pi development baseline to `@mariozechner/pi-coding-agent` `0.67.68` and `typescript` `6.0.3`
- refreshed the release lockfile against the current stable pi patch line

## 0.1.8 - 2026-04-15

- refresh the local development toolchain to `@mariozechner/pi-coding-agent` `0.67.2`, `typescript` `6.0.2`, and `@types/node` `25.6.0`
- declare `node >=20.6.0` and `packageManager: npm@11.12.1` in published metadata
- refresh the lockfile to the current stable development baseline

## 0.1.7 - 2026-04-11

- fix non-git project-root detection so the global `~/.pi` directory no longer hijacks repo inference under a user's home directory
- make the integration tests hermetic by resolving the repo-local `@mariozechner/pi-coding-agent` install instead of a global npm install
- refuse to overwrite malformed global allowlist config and write config updates atomically
- add regression tests for the homedir root bug and config-write hardening
- add GitHub Actions CI plus a `prepublishOnly` guard that reruns `npm run check` before publish

## 0.1.6 - 2026-04-07

- add dev-time static checking with `tsc --noEmit`
- add a local `check` script that runs tests plus typechecking
- keep pi core typing support in `devDependencies` only so this stays a lightweight published package
- annotate the extension with `// @ts-check` and JSDoc types for earlier local error detection

## 0.1.5 - 2026-04-07

- strip already-loaded global `AGENTS.md` / `CLAUDE.md` context reliably instead of rereading live files from disk
- remove the now-empty `# Project Context` section when only global context was loaded
- handle prompts whose custom prompt text also mentions the `# Project Context` heading
- make `/local-agents-only off` report when the repo is still enabled via the global allowlist or `PI_LOCAL_AGENTS_ONLY`
- document the repo-marker-only behavior of `/local-agents-only off`
- add integration tests against pi's real system prompt builder and command UX regressions
