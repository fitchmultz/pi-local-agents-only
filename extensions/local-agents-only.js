/**
 * Purpose: Strip pi's global AGENTS.md and CLAUDE.md blocks from the effective prompt for opted-in projects.
 * Responsibilities: Detect repo opt-in state, manage repo and global toggles, and remove matching global context blocks before model calls.
 * Scope: Works as a pi extension package. It changes only the prompt the model sees, not pi's startup header.
 * Usage: Install the package, then use `/local-agents-only on|off|status|global-on|global-off`.
 * Invariants/Assumptions: pi injects context files as `## /absolute/path\n\n<file contents>\n\n`.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const COMMAND = "local-agents-only";
const MARKER = join(".pi", COMMAND);
const GLOBAL_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md"];
const ENV_TRUE = ["1", "true", "yes", "on"];
const ENV_FALSE = ["0", "false", "no", "off"];

const getAgentDir = () => {
	const env = process.env.PI_CODING_AGENT_DIR;
	if (env === "~") {
		return homedir();
	}
	if (env?.startsWith("~/")) {
		return join(homedir(), env.slice(2));
	}
	return env || join(homedir(), ".pi", "agent");
};
const normalizePath = (path) => resolve(path).replace(/\\/g, "/");
const CONFIG = () => join(getAgentDir(), `${COMMAND}.json`);
const getMarkerPath = (projectRoot) => join(projectRoot, MARKER);
const readProjects = (configPath = CONFIG()) => {
	try {
		const { projects = [] } = JSON.parse(readFileSync(configPath, "utf8"));
		return Array.isArray(projects) ? projects.map(normalizePath) : [];
	} catch {
		return [];
	}
};
const writeProjects = (projects, configPath = CONFIG()) => {
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({ projects: [...new Set(projects.map(normalizePath))].sort() }, null, 2) + "\n",
	);
};
const getEnvToggle = (value = process.env.PI_LOCAL_AGENTS_ONLY) => {
	const toggle = `${value ?? ""}`.trim().toLowerCase();
	if (ENV_TRUE.includes(toggle)) {
		return true;
	}
	if (ENV_FALSE.includes(toggle)) {
		return false;
	}
};
const getGlobalBlocks = (agentDir = getAgentDir()) =>
	GLOBAL_CONTEXT_FILES.flatMap((name) => {
		const path = join(agentDir, name);
		return existsSync(path) ? [`## ${path}\n\n${readFileSync(path, "utf8")}\n\n`] : [];
	});
const setStatus = (ctx) => {
	if (!ctx.hasUI) {
		return;
	}
	const mode = getMode(findProjectRoot(ctx.cwd));
	ctx.ui.setStatus(COMMAND, mode.enabled ? `AGENTS: local-only (${mode.source})` : undefined);
};

export function findProjectRoot(start = process.cwd()) {
	let current = resolve(start);
	while (!existsSync(join(current, ".git"))) {
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return current;
}

export function getMode(projectRoot, envValue = process.env.PI_LOCAL_AGENTS_ONLY, configPath = CONFIG()) {
	const envToggle = getEnvToggle(envValue);
	if (envToggle !== undefined) {
		return { enabled: envToggle, source: "env" };
	}
	if (existsSync(getMarkerPath(projectRoot))) {
		return { enabled: true, source: "marker" };
	}
	if (readProjects(configPath).includes(normalizePath(projectRoot))) {
		return { enabled: true, source: "global-config" };
	}
	return { enabled: false, source: "default" };
}

export function stripGlobalBlocks(prompt, blocks = getGlobalBlocks()) {
	return blocks.reduce((nextPrompt, block) => nextPrompt.replace(block, ""), prompt);
}

export default function localAgentsOnly(pi) {
	pi.registerCommand(COMMAND, {
		description: "Use only repo-local AGENTS prompt context",
		handler: async (args, ctx) => {
			const projectRoot = findProjectRoot(ctx.cwd);
			switch ((args.trim() || "status").toLowerCase()) {
				case "on":
					mkdirSync(dirname(getMarkerPath(projectRoot)), { recursive: true });
					writeFileSync(getMarkerPath(projectRoot), "\n");
					setStatus(ctx);
					ctx.ui.notify(`Enabled at ${getMarkerPath(projectRoot)}`, "info");
					return;
				case "off":
					rmSync(getMarkerPath(projectRoot), { force: true });
					setStatus(ctx);
					ctx.ui.notify("Disabled for this repo", "info");
					return;
				case "global-on":
					writeProjects([...readProjects(), projectRoot]);
					setStatus(ctx);
					ctx.ui.notify(`Global allowlist enabled for ${normalizePath(projectRoot)}`, "info");
					return;
				case "global-off":
					writeProjects(readProjects().filter((path) => path !== normalizePath(projectRoot)));
					setStatus(ctx);
					ctx.ui.notify(`Global allowlist disabled for ${normalizePath(projectRoot)}`, "info");
					return;
				case "status": {
					const mode = getMode(projectRoot);
					ctx.ui.notify(`local-agents-only: ${mode.enabled ? `enabled via ${mode.source}` : "disabled"}`, "info");
					return;
				}
				default:
					ctx.ui.notify("Usage: /local-agents-only [status|on|off|global-on|global-off]", "warning");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		setStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(COMMAND, undefined);
		}
	});

	pi.on("before_agent_start", (event, ctx) => {
		return getMode(findProjectRoot(ctx.cwd)).enabled ? { systemPrompt: stripGlobalBlocks(event.systemPrompt) } : undefined;
	});
}
