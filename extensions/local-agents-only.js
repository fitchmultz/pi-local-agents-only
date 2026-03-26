/**
 * Purpose: Strip pi's global AGENTS.md and CLAUDE.md blocks from the effective prompt for opted-in projects.
 * Responsibilities: Detect project opt-in state, manage repo and global toggles, and remove matching global context blocks before model calls.
 * Scope: Works as a pi extension package installed globally or per project. It does not change pi's startup header or context discovery.
 * Usage: Install the package, then use `/local-agents-only on`, `/local-agents-only off`, `/local-agents-only global-on`, `/local-agents-only global-off`, or add `.pi/local-agents-only` manually.
 * Invariants/Assumptions: pi injects context files as `## /absolute/path\n\n<file contents>\n\n`, and global context files live under `~/.pi/agent/`.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MARKER_RELATIVE_PATH = join(".pi", "local-agents-only");
const GLOBAL_DIR = join(homedir(), ".pi", "agent");
const GLOBAL_CONFIG_PATH = join(GLOBAL_DIR, "local-agents-only.json");
const GLOBAL_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md"];
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export function normalizePath(path) {
	return resolve(path).replace(/\\/g, "/");
}

export function findProjectRoot(start = process.cwd()) {
	let current = resolve(start);
	while (true) {
		if (existsSync(join(current, ".git"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return current;
		}
		current = parent;
	}
}

export function getMarkerPath(projectRoot) {
	return join(projectRoot, MARKER_RELATIVE_PATH);
}

export function readGlobalConfig(configPath = GLOBAL_CONFIG_PATH) {
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		return { projects: Array.isArray(parsed.projects) ? parsed.projects.map(normalizePath) : [] };
	} catch {
		return { projects: [] };
	}
}

export function writeGlobalConfig(projects, configPath = GLOBAL_CONFIG_PATH) {
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({ projects: [...new Set(projects.map(normalizePath))].sort() }, null, 2) + "\n",
	);
}

export function getMode(projectRoot, envValue = process.env.PI_LOCAL_AGENTS_ONLY, configPath = GLOBAL_CONFIG_PATH) {
	const value = `${envValue ?? ""}`.trim().toLowerCase();
	if (TRUTHY.has(value)) {
		return { enabled: true, source: "env" };
	}
	if (FALSY.has(value)) {
		return { enabled: false, source: "env" };
	}
	if (existsSync(getMarkerPath(projectRoot))) {
		return { enabled: true, source: "marker" };
	}
	if (readGlobalConfig(configPath).projects.includes(normalizePath(projectRoot))) {
		return { enabled: true, source: "global-config" };
	}
	return { enabled: false, source: "default" };
}

export function getGlobalBlocks(globalDir = GLOBAL_DIR) {
	return GLOBAL_CONTEXT_FILES.map((name) => join(globalDir, name))
		.filter(existsSync)
		.map((path) => `## ${path}\n\n${readFileSync(path, "utf8")}\n\n`);
}

export function stripGlobalBlocks(prompt, blocks = getGlobalBlocks()) {
	return blocks.reduce((nextPrompt, block) => nextPrompt.replace(block, ""), prompt);
}

function setRepoMode(projectRoot, enabled) {
	const markerPath = getMarkerPath(projectRoot);
	if (enabled) {
		mkdirSync(dirname(markerPath), { recursive: true });
		writeFileSync(markerPath, "\n");
	} else {
		rmSync(markerPath, { force: true });
	}
}

function setGlobalMode(projectRoot, enabled, configPath = GLOBAL_CONFIG_PATH) {
	const current = readGlobalConfig(configPath).projects;
	const target = normalizePath(projectRoot);
	writeGlobalConfig(enabled ? [...current, target] : current.filter((path) => path !== target), configPath);
}

function notify(ctx, message, type = "info") {
	if (ctx.hasUI) {
		ctx.ui.notify(message, type);
	}
}

function setStatus(ctx) {
	if (!ctx.hasUI) {
		return;
	}
	const mode = getMode(findProjectRoot(ctx.cwd));
	ctx.ui.setStatus("local-agents-only", mode.enabled ? `AGENTS: local-only (${mode.source})` : undefined);
}

export default function localAgentsOnly(pi) {
	pi.registerCommand("local-agents-only", {
		description: "Toggle repo-local-only AGENTS prompt mode",
		handler: async (args, ctx) => {
			const projectRoot = findProjectRoot(ctx.cwd);
			const action = args.trim() || "status";
			if (action === "on") {
				setRepoMode(projectRoot, true);
				setStatus(ctx);
				notify(ctx, `Repo marker enabled at ${getMarkerPath(projectRoot)}`);
				return;
			}
			if (action === "off") {
				setRepoMode(projectRoot, false);
				setStatus(ctx);
				notify(ctx, "Repo marker removed");
				return;
			}
			if (action === "global-on") {
				setGlobalMode(projectRoot, true);
				setStatus(ctx);
				notify(ctx, `Global allowlist enabled for ${normalizePath(projectRoot)}`);
				return;
			}
			if (action === "global-off") {
				setGlobalMode(projectRoot, false);
				setStatus(ctx);
				notify(ctx, `Global allowlist disabled for ${normalizePath(projectRoot)}`);
				return;
			}
			if (action === "status") {
				const mode = getMode(projectRoot);
				notify(ctx, `local-agents-only: ${mode.enabled ? `enabled via ${mode.source}` : "disabled"}`);
				return;
			}
			notify(ctx, "Usage: /local-agents-only [status|on|off|global-on|global-off]", "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		setStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("local-agents-only", undefined);
		}
	});

	pi.on("before_agent_start", (event, ctx) => {
		const mode = getMode(findProjectRoot(ctx.cwd));
		return mode.enabled ? { systemPrompt: stripGlobalBlocks(event.systemPrompt) } : undefined;
	});
}
