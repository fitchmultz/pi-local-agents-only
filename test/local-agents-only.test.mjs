/**
 * Purpose: Verify the local-agents-only extension's repo detection, activation precedence, worktree handling, and prompt stripping.
 * Responsibilities: Test git-root discovery, non-git fallback behavior, env/config precedence, worktree-aware activation, and removal of global prompt blocks.
 * Scope: Minimal unit tests for the extension's exported helpers.
 * Usage: Run `npm test` from the package root.
 * Invariants/Assumptions: Tests use temporary directories and do not touch the user's real pi config.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import localAgentsOnly, { findProjectRoot, getMode, stripGlobalBlocks } from "../extensions/local-agents-only.js";

const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

const createGitRepo = (prefix) => {
	const tempRoot = mkdtempSync(join(tmpdir(), prefix));
	git(tempRoot, "init", "-q");
	git(tempRoot, "config", "user.email", "test@example.com");
	git(tempRoot, "config", "user.name", "Test User");
	writeFileSync(join(tempRoot, "README.md"), "hello\n");
	git(tempRoot, "add", "README.md");
	git(tempRoot, "commit", "-qm", "init");
	return git(tempRoot, "rev-parse", "--show-toplevel");
};

const withEnv = async (name, value, fn) => {
	const previous = process.env[name];
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
	try {
		return await fn();
	} finally {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	}
};

const captureCommandHandler = () => {
	let handler;
	localAgentsOnly({
		registerCommand(name, definition) {
			if (name === "local-agents-only") {
				handler = definition.handler;
			}
		},
		on() {},
	});
	assert.equal(typeof handler, "function");
	return handler;
};

test("findProjectRoot returns the nearest git root", () => {
	const root = createGitRepo("pi-local-agents-only-root-");
	const nested = join(root, "a", "b");
	mkdirSync(nested, { recursive: true });
	assert.equal(findProjectRoot(nested), root);
});

test("findProjectRoot falls back to the current directory outside git instead of filesystem root", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-no-git-"));
	const nested = join(root, "a", "b");
	mkdirSync(nested, { recursive: true });
	assert.equal(findProjectRoot(nested), nested);
});

test("getMode prefers env override, then repo marker, then global config", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-mode-"));
	const configPath = join(root, "local-agents-only.json");
	const markerPath = join(root, ".pi", "local-agents-only");
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({
			projects: [root],
			repositories: [root],
		}),
	);
	writeFileSync(markerPath, "\n");
	assert.deepEqual(getMode(root, "1", configPath), { enabled: true, source: "env" });
	assert.deepEqual(getMode(root, "0", configPath), { enabled: false, source: "env" });
	assert.deepEqual(getMode(root, "", configPath), { enabled: true, source: "marker" });
	rmSync(markerPath, { force: true });
	assert.deepEqual(getMode(root, "", configPath), { enabled: true, source: "global-config" });
	assert.deepEqual(getMode(mkdtempSync(join(tmpdir(), "pi-local-agents-only-default-")), "", configPath), {
		enabled: false,
		source: "default",
	});
});

test("worktrees inherit marker opt-in from sibling worktrees in the same repo", () => {
	const root = createGitRepo("pi-local-agents-only-worktree-marker-");
	const worktree = join(dirname(root), `${Date.now()}-wt-marker`);
	git(root, "worktree", "add", "-q", worktree);
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "local-agents-only"), "\n");
	assert.deepEqual(getMode(worktree, "", join(root, "config.json")), { enabled: true, source: "marker" });
});

test("worktrees inherit global allowlist entries stored by repository id", () => {
	const root = createGitRepo("pi-local-agents-only-worktree-global-");
	const worktree = join(dirname(root), `${Date.now()}-wt-global`);
	const configPath = join(root, "local-agents-only.json");
	git(root, "worktree", "add", "-q", worktree);
	const repoId = resolve(root, git(root, "rev-parse", "--git-common-dir"));
	writeFileSync(configPath, JSON.stringify({ repositories: [repoId] }));
	assert.deepEqual(getMode(worktree, "", configPath), { enabled: true, source: "global-config" });
});

test("worktrees still honor legacy global allowlist entries stored by worktree path", () => {
	const root = createGitRepo("pi-local-agents-only-worktree-legacy-");
	const worktree = join(dirname(root), `${Date.now()}-wt-legacy`);
	const configPath = join(root, "local-agents-only.json");
	git(root, "worktree", "add", "-q", worktree);
	writeFileSync(configPath, JSON.stringify({ projects: [root] }));
	assert.deepEqual(getMode(worktree, "", configPath), { enabled: true, source: "global-config" });
});

test("stripGlobalBlocks removes global blocks from the project context section and keeps local context", () => {
	const globalAgentsPath = "/home/me/.pi/agent/AGENTS.md";
	const globalClaudePath = "/home/me/.pi/agent/CLAUDE.md";
	const localAgentsPath = "/repo/AGENTS.md";
	const localClaudePath = "/repo/subdir/CLAUDE.md";
	const prompt = `System prompt intro\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n## ${globalAgentsPath}\n\nA\n\n## ${globalClaudePath}\n\nB\n\n## ${localAgentsPath}\n\nLOCAL AGENTS\n\n## ${localClaudePath}\n\nLOCAL CLAUDE\n\nCurrent date: 2026-04-07\nCurrent working directory: /repo`;
	const expected = `System prompt intro\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n## ${localAgentsPath}\n\nLOCAL AGENTS\n\n## ${localClaudePath}\n\nLOCAL CLAUDE\n\nCurrent date: 2026-04-07\nCurrent working directory: /repo`;
	assert.equal(stripGlobalBlocks(prompt, [globalAgentsPath, globalClaudePath]), expected);
});

test("stripGlobalBlocks removes the empty project context section when only global context was loaded", () => {
	const globalAgentsPath = "/home/me/.pi/agent/AGENTS.md";
	const prompt = `System prompt intro\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n## ${globalAgentsPath}\n\nGLOBAL\n\nCurrent date: 2026-04-07\nCurrent working directory: /repo`;
	assert.equal(
		stripGlobalBlocks(prompt, [globalAgentsPath]),
		"System prompt intro\nCurrent date: 2026-04-07\nCurrent working directory: /repo",
	);
});

test("stripGlobalBlocks targets pi's appended project context section even if the custom prompt mentions the same heading", () => {
	const globalAgentsPath = "/home/me/.pi/agent/AGENTS.md";
	const prompt = `Intro\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\nThis is just custom prompt text.\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n## ${globalAgentsPath}\n\nGLOBAL\n\nCurrent date: 2026-04-07\nCurrent working directory: /repo`;
	assert.equal(
		stripGlobalBlocks(prompt, [globalAgentsPath]),
		"Intro\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\nThis is just custom prompt text.\nCurrent date: 2026-04-07\nCurrent working directory: /repo",
	);
});

test("/local-agents-only off reports when global allowlist still keeps the repo enabled", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-off-global-"));
	const agentDir = join(root, "agent");
	const repo = join(root, "repo");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(repo, { recursive: true });
	const notifications = [];
	const handler = captureCommandHandler();
	const ctx = {
		cwd: repo,
		hasUI: true,
		ui: {
			notify: (message) => notifications.push(message),
			setStatus() {},
		},
	};

	await withEnv("PI_CODING_AGENT_DIR", agentDir, async () => {
		await handler("global-on", ctx);
		await handler("off", ctx);
	});

	assert.equal(
		notifications.at(-1),
		`Repo marker cleared for ${repo}, but local-agents-only is still enabled via global allowlist. Use /local-agents-only global-off to fully disable it.`,
	);
});

test("/local-agents-only off reports when env override still keeps the repo enabled", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-off-env-"));
	const agentDir = join(root, "agent");
	const repo = join(root, "repo");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(repo, { recursive: true });
	const notifications = [];
	const handler = captureCommandHandler();
	const ctx = {
		cwd: repo,
		hasUI: true,
		ui: {
			notify: (message) => notifications.push(message),
			setStatus() {},
		},
	};

	await withEnv("PI_CODING_AGENT_DIR", agentDir, async () =>
		withEnv("PI_LOCAL_AGENTS_ONLY", "1", async () => {
			await handler("off", ctx);
		}),
	);

	assert.equal(
		notifications.at(-1),
		`Repo marker cleared for ${repo}, but local-agents-only is still enabled via PI_LOCAL_AGENTS_ONLY.`,
	);
});
