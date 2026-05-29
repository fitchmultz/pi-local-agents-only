# pi-local-agents-only

Use repo-local `AGENTS.md` only for selected projects by stripping global `AGENTS.md` and `CLAUDE.md` from pi's effective prompt.

## Install

Install it from npm with pi:

```bash
pi install npm:pi-local-agents-only
```

Or install it directly from GitHub with pi:

```bash
pi install https://github.com/fitchmultz/pi-local-agents-only
```

Compatibility note: this package is tested against the current pi release during each package update, and pi-bundled runtime packages are declared as optional wildcard peers. That keeps installs forward-open for future pi releases: npm peer ranges should not block users from trying a newer pi, though runtime behavior is only verified against the tested baseline until a follow-up package release confirms it.

## Use

Enable for the current repo:

```bash
/local-agents-only on
```

Disable for the current repo:

```bash
/local-agents-only off
```

`/local-agents-only off` clears the repo marker only. If the repo is still enabled via `/local-agents-only global-on` or `PI_LOCAL_AGENTS_ONLY=1`, it remains enabled until you also run `/local-agents-only global-off` or unset the env var.

Enable or disable via the global allowlist:

```bash
/local-agents-only global-on
/local-agents-only global-off
```

Check status:

```bash
/local-agents-only status
```

Repo opt-in uses this marker file:

```text
.pi/local-agents-only
```

For git repos, marker and global allowlist activation apply across linked worktrees.

Env override for one run:

```bash
PI_LOCAL_AGENTS_ONLY=1 pi
PI_LOCAL_AGENTS_ONLY=0 pi
```

This changes the prompt the model sees. It does not change pi's startup header.

If you toggle it during an existing session, start a fresh turn or `/new` for the cleanest verification.
