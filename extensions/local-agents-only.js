/**
 * Purpose: Strip pi's global AGENTS.md and CLAUDE.md blocks from the effective prompt for opted-in projects.
 * Responsibilities: Detect repo and worktree opt-in state, manage repo and global toggles, add a local-only guardrail, and remove matching global context blocks before model calls.
 * Scope: Works as a pi extension package. It changes only the prompt the model sees, not pi's startup header.
 * Usage: Install the package, then use `/local-agents-only on|off|status|global-on|global-off`.
 * Invariants/Assumptions: pi injects context files as `## /absolute/path\n\n<file contents>\n\n`; git worktrees that share a common git dir should share local-agents-only state.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const COMMAND = "local-agents-only";
const MARKER = join(".pi", COMMAND);
const GLOBAL_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md"];
const ENV_TRUE = ["1", "true", "yes", "on"];
const ENV_FALSE = ["0", "false", "no", "off"];
const PROJECT_CONTEXT_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";
const SKILLS_HEADER = "\n\nThe following skills provide specialized instructions for specific tasks.";
const DATE_HEADER = "\nCurrent date:";
const CONTEXT_BLOCK_HEADER = /^## ([^\n]+(?:AGENTS|CLAUDE)\.md)\n\n/gm;

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
const uniqueSorted = (values) => [...new Set(values.map(normalizePath))].sort();
const walkUp = (start, predicate) => {
	let current = resolve(start);
	while (true) {
		if (predicate(current)) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return;
		}
		current = parent;
	}
};
const runGit = (start, args) => {
	try {
		return execFileSync("git", args, {
			cwd: resolve(start),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return;
	}
};
const readConfig = (configPath = CONFIG()) => {
	try {
		const { projects = [], repositories = [] } = JSON.parse(readFileSync(configPath, "utf8"));
		return {
			projects: Array.isArray(projects) ? projects.map(normalizePath) : [],
			repositories: Array.isArray(repositories) ? repositories.map(normalizePath) : [],
		};
	} catch {
		return { projects: [], repositories: [] };
	}
};
const writeConfig = ({ projects, repositories }, configPath = CONFIG()) => {
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify(
			{
				projects: uniqueSorted(projects),
				repositories: uniqueSorted(repositories),
			},
			null,
			2,
		) + "\n",
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
const getGlobalContextPaths = (agentDir = getAgentDir()) => GLOBAL_CONTEXT_FILES.map((name) => join(agentDir, name));
const getExistingGlobalContextPaths = (agentDir = getAgentDir()) =>
	getGlobalContextPaths(agentDir).filter((path) => existsSync(path));
const getContextSectionEnd = (prompt, offset) => {
	const candidates = [prompt.indexOf(SKILLS_HEADER, offset), prompt.indexOf(DATE_HEADER, offset)].filter(
		(index) => index !== -1,
	);
	return candidates.length > 0 ? Math.min(...candidates) : prompt.length;
};
const getContextBlocks = (contextSection) => {
	const matches = [...contextSection.matchAll(CONTEXT_BLOCK_HEADER)];
	return matches.map((match, index) => ({
		path: match[1],
		start: match.index,
		end: index + 1 < matches.length ? matches[index + 1].index : contextSection.length,
	}));
};
const stripGlobalContext = (prompt, globalPaths = getGlobalContextPaths()) => {
	const sectionStart = prompt.lastIndexOf(PROJECT_CONTEXT_HEADER);
	if (sectionStart === -1) {
		return { prompt, removedPaths: [] };
	}
	const contextStart = sectionStart + PROJECT_CONTEXT_HEADER.length;
	const sectionEnd = getContextSectionEnd(prompt, contextStart);
	const contextSection = prompt.slice(contextStart, sectionEnd);
	const blocks = getContextBlocks(contextSection);
	if (blocks.length === 0) {
		return { prompt, removedPaths: [] };
	}
	const globalPathKeys = new Set(globalPaths.map(normalizePath));
	const keptBlocks = [];
	const removedPaths = [];
	for (const block of blocks) {
		const blockText = contextSection.slice(block.start, block.end);
		if (globalPathKeys.has(normalizePath(block.path))) {
			removedPaths.push(block.path);
		} else {
			keptBlocks.push(blockText);
		}
	}
	if (removedPaths.length === 0) {
		return { prompt, removedPaths: [] };
	}
	const prefix = prompt.slice(0, sectionStart);
	const suffix = prompt.slice(sectionEnd);
	if (keptBlocks.length === 0) {
		return { prompt: `${prefix}${suffix}`, removedPaths: uniqueSorted(removedPaths) };
	}
	return {
		prompt: `${prefix}${PROJECT_CONTEXT_HEADER}${keptBlocks.join("")}${suffix}`,
		removedPaths: uniqueSorted(removedPaths),
	};
};
const getGitTopLevel = (start) => {
	const topLevel = runGit(start, ["rev-parse", "--show-toplevel"]);
	return topLevel ? normalizePath(topLevel) : undefined;
};
const getGitCommonDir = (start) => {
	const commonDir = runGit(start, ["rev-parse", "--git-common-dir"]);
	return commonDir ? normalizePath(resolve(start, commonDir)) : undefined;
};
const getWorktreeRoots = (start) => {
	const list = runGit(start, ["worktree", "list", "--porcelain"]);
	if (!list) {
		return [];
	}
	return uniqueSorted(
		list
			.split(/\r?\n/u)
			.filter((line) => line.startsWith("worktree "))
			.map((line) => line.slice("worktree ".length)),
	);
};
const getProjectState = (start = process.cwd()) => {
	const normalizedStart = normalizePath(start);
	const gitTopLevel = getGitTopLevel(normalizedStart);
	const projectRoot =
		gitTopLevel ||
		walkUp(normalizedStart, (dir) => existsSync(getMarkerPath(dir))) ||
		walkUp(normalizedStart, (dir) => existsSync(join(dir, ".pi"))) ||
		normalizedStart;
	const worktreeRoots = getWorktreeRoots(normalizedStart);
	return {
		start: normalizedStart,
		projectRoot: normalizePath(projectRoot),
		repoId: getGitCommonDir(normalizedStart) || normalizePath(projectRoot),
		worktreeRoots:
			worktreeRoots.length > 0 ? uniqueSorted([projectRoot, ...worktreeRoots]) : [normalizePath(projectRoot)],
	};
};
const getMarkerRoots = (state) => uniqueSorted([state.projectRoot, ...state.worktreeRoots]);
const hasMarker = (state) => getMarkerRoots(state).some((root) => existsSync(getMarkerPath(root)));
const writeMarkers = (state) => {
	for (const root of getMarkerRoots(state)) {
		mkdirSync(dirname(getMarkerPath(root)), { recursive: true });
		writeFileSync(getMarkerPath(root), "\n");
	}
};
const clearMarkers = (state) => {
	for (const root of getMarkerRoots(state)) {
		rmSync(getMarkerPath(root), { force: true });
	}
};
const buildLocalOnlyNotice = (paths = getExistingGlobalContextPaths(getAgentDir())) => {
	if (paths.length === 0) {
		return "";
	}
	return [
		"# Local Context Mode",
		"This repo is in local-agents-only mode.",
		"Ignore instructions from these global context files even if they appear in older session messages, summaries, or retries:",
		...uniqueSorted(paths).map((path) => `- ${path}`),
		"Follow only repo-local AGENTS.md or CLAUDE.md guidance for this project.",
	].join("\n");
};
const applyLocalOnlyPrompt = (prompt, agentDir = getAgentDir()) => {
	const { prompt: stripped, removedPaths } = stripGlobalContext(prompt, getGlobalContextPaths(agentDir));
	const notice = buildLocalOnlyNotice(
		removedPaths.length > 0 ? removedPaths : getExistingGlobalContextPaths(agentDir),
	);
	return notice ? `${stripped}\n\n${notice}` : stripped;
};
const setStatus = (ctx) => {
	if (!ctx.hasUI) {
		return;
	}
	const mode = getMode(ctx.cwd);
	ctx.ui.setStatus(COMMAND, mode.enabled ? `AGENTS: local-only (${mode.source})` : undefined);
};
const getProjectTarget = (state) =>
	state.worktreeRoots.length > 1 ? `${state.projectRoot} and linked worktrees` : state.projectRoot;
const getOffNotification = (state) => {
	const mode = getMode(state);
	if (!mode.enabled) {
		return `Disabled for ${getProjectTarget(state)}`;
	}
	if (mode.source === "global-config") {
		return `Repo marker cleared for ${getProjectTarget(state)}, but local-agents-only is still enabled via global allowlist. Use /local-agents-only global-off to fully disable it.`;
	}
	if (mode.source === "env") {
		return `Repo marker cleared for ${getProjectTarget(state)}, but local-agents-only is still enabled via PI_LOCAL_AGENTS_ONLY.`;
	}
	return `Repo marker cleared for ${getProjectTarget(state)}, but local-agents-only is still enabled via ${mode.source}.`;
};

export function findProjectRoot(start = process.cwd()) {
	return getProjectState(start).projectRoot;
}

export function getMode(start = process.cwd(), envValue = process.env.PI_LOCAL_AGENTS_ONLY, configPath = CONFIG()) {
	const state = typeof start === "string" ? getProjectState(start) : start;
	const envToggle = getEnvToggle(envValue);
	if (envToggle !== undefined) {
		return { enabled: envToggle, source: "env" };
	}
	if (hasMarker(state)) {
		return { enabled: true, source: "marker" };
	}
	const { projects, repositories } = readConfig(configPath);
	if (repositories.includes(state.repoId)) {
		return { enabled: true, source: "global-config" };
	}
	if (projects.includes(state.projectRoot) || state.worktreeRoots.some((root) => projects.includes(root))) {
		return { enabled: true, source: "global-config" };
	}
	return { enabled: false, source: "default" };
}

export function stripGlobalBlocks(prompt, globalPaths = getGlobalContextPaths()) {
	return stripGlobalContext(prompt, globalPaths).prompt;
}

export default function localAgentsOnly(pi) {
	pi.registerCommand(COMMAND, {
		description: "Use only repo-local AGENTS prompt context",
		handler: async (args, ctx) => {
			const state = getProjectState(ctx.cwd);
			switch ((args.trim() || "status").toLowerCase()) {
				case "on":
					writeMarkers(state);
					setStatus(ctx);
					ctx.ui.notify(`Enabled for ${state.projectRoot}${state.worktreeRoots.length > 1 ? ` across ${state.worktreeRoots.length} worktrees` : ""}`, "info");
					return;
				case "off":
					clearMarkers(state);
					setStatus(ctx);
					ctx.ui.notify(getOffNotification(state), "info");
					return;
				case "global-on": {
					const config = readConfig();
					writeConfig({
						projects: [...config.projects, ...state.worktreeRoots],
						repositories: [...config.repositories, state.repoId],
					});
					setStatus(ctx);
					ctx.ui.notify(`Global allowlist enabled for ${state.projectRoot}`, "info");
					return;
				}
				case "global-off": {
					const config = readConfig();
					writeConfig({
						projects: config.projects.filter((path) => !state.worktreeRoots.includes(path)),
						repositories: config.repositories.filter((id) => id !== state.repoId),
					});
					setStatus(ctx);
					ctx.ui.notify(`Global allowlist disabled for ${state.projectRoot}`, "info");
					return;
				}
				case "status": {
					const mode = getMode(state);
					ctx.ui.notify(
						`local-agents-only: ${mode.enabled ? `enabled via ${mode.source}` : "disabled"} (${state.projectRoot})`,
						"info",
					);
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
		return getMode(ctx.cwd).enabled ? { systemPrompt: applyLocalOnlyPrompt(event.systemPrompt) } : undefined;
	});
}
