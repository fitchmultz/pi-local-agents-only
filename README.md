# pi-local-agents-only

A tiny pi extension package that strips `~/.pi/agent/AGENTS.md` and `~/.pi/agent/CLAUDE.md` from the effective prompt for selected projects.

This keeps global guidance available by default everywhere else while letting specific repos run with repo-local instructions only.

## Install

```bash
pi install /absolute/path/to/pi-local-agents-only
```

Later, the same package can be installed from git:

```bash
pi install git:github.com/<you>/pi-local-agents-only
```

## Enable for a repo

Inside the repo:

```bash
/local-agents-only on
```

That creates this marker file:

```text
.pi/local-agents-only
```

If you prefer not to touch the repo, add the repo to the global allowlist instead:

```bash
/local-agents-only global-on
```

## Disable

Repo marker only:

```bash
/local-agents-only off
```

Global allowlist only:

```bash
/local-agents-only global-off
```

Check status:

```bash
/local-agents-only status
```

## Global config file

Global allowlist entries are stored here:

```text
~/.pi/agent/local-agents-only.json
```

Shape:

```json
{
  "projects": [
    "/absolute/path/to/repo"
  ]
}
```

## Env override

Force on for the current process:

```bash
PI_LOCAL_AGENTS_ONLY=1 pi
```

Force off for the current process:

```bash
PI_LOCAL_AGENTS_ONLY=0 pi
```

## Notes

- This changes the effective prompt seen by the model.
- It does not change pi's startup header or resource discovery UI.
- Project-local `AGENTS.md` files still remain in prompt context.

## Test

```bash
npm test
```
