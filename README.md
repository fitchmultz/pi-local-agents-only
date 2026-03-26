# pi-local-agents-only

Use repo-local `AGENTS.md` only for selected projects by stripping global `AGENTS.md` and `CLAUDE.md` from pi's effective prompt.

## Install

```bash
pi install git:github.com/fitchmultz/pi-local-agents-only
```

## Use

Enable for the current repo:

```bash
/local-agents-only on
```

Disable for the current repo:

```bash
/local-agents-only off
```

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

Env override for one run:

```bash
PI_LOCAL_AGENTS_ONLY=1 pi
PI_LOCAL_AGENTS_ONLY=0 pi
```

This changes the prompt the model sees. It does not change pi's startup header.
