// @ts-check

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

/** @typedef {import("@mariozechner/pi-coding-agent").ExtensionAPI} ExtensionAPI */
/** @typedef {import("@mariozechner/pi-coding-agent").ExtensionContext} ExtensionContext */
/** @typedef {{ projects: string[]; repositories: string[] }} LocalAgentsOnlyConfig */
/** @typedef {{ start: string; projectRoot: string; repoId: string; worktreeRoots: string[] }} ProjectState */
/** @typedef {{ enabled: boolean; source: "env" | "marker" | "global-config" | "default" }} Mode */
/** @typedef {{ path: string; start: number; end: number }} ContextBlock */
/** @typedef {{ prompt: string; removedPaths: string[] }} StripResult */

const COMMAND = "local-agents-only";
const MARKER = join(".pi", COMMAND);
const GLOBAL_CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md"];
const ENV_TRUE = ["1", "true", "yes", "on"];
const ENV_FALSE = ["0", "false", "no", "off"];
const PROJECT_CONTEXT_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";
const SKILLS_HEADER = "\n\nThe following skills provide specialized instructions for specific tasks.";
const DATE_HEADER = "\nCurrent date:";
const CONTEXT_BLOCK_HEADER = /^## ([^\n]+(?:AGENTS|CLAUDE)\.md)\n\n/gm;

/** @returns {string} */
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

/** @param {string} path */
const normalizePath = (path) => resolve(path).replace(/\\/g, "/");

/** @returns {string} */
const CONFIG = () => join(getAgentDir(), `${COMMAND}.json`);

/** @param {string} projectRoot */
const getMarkerPath = (projectRoot) => join(projectRoot, MARKER);

/** @param {string[]} values */
const uniqueSorted = (values) => [...new Set(values.map(normalizePath))].sort();

/**
 * @param {string} start
 * @param {(dir: string) => boolean} predicate
 * @returns {string | undefined}
 */
const walkUp = (start, predicate) => {
	let current = resolve(start);
	while (true) {
		if (predicate(current)) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
};

/**
 * @param {string} start
 * @param {string[]} args
 * @returns {string | undefined}
 */
const runGit = (start, args) => {
	try {
		return execFileSync("git", args, {
			cwd: resolve(start),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
};

/**
 * @param {string} [configPath]
 * @returns {LocalAgentsOnlyConfig}
 */
const readConfig = (configPath = CONFIG()) => {
	try {
		const parsed = /** @type {{ projects?: unknown; repositories?: unknown }} */ (
			JSON.parse(readFileSync(configPath, "utf8"))
		);
		const { projects = [], repositories = [] } = parsed;
		return {
			projects: Array.isArray(projects) ? projects.map((value) => normalizePath(String(value))) : [],
			repositories: Array.isArray(repositories) ? repositories.map((value) => normalizePath(String(value))) : [],
		};
	} catch {
		return { projects: [], repositories: [] };
	}
};

/**
 * @param {LocalAgentsOnlyConfig} config
 * @param {string} [configPath]
 */
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

/**
 * @param {string | undefined} [value]
 * @returns {boolean | undefined}
 */
const getEnvToggle = (value = process.env.PI_LOCAL_AGENTS_ONLY) => {
	const toggle = `${value ?? ""}`.trim().toLowerCase();
	if (ENV_TRUE.includes(toggle)) {
		return true;
	}
	if (ENV_FALSE.includes(toggle)) {
		return false;
	}
	return undefined;
};

/** @param {string} [agentDir] */
const getGlobalContextPaths = (agentDir = getAgentDir()) => GLOBAL_CONTEXT_FILES.map((name) => join(agentDir, name));

/** @param {string} [agentDir] */
const getExistingGlobalContextPaths = (agentDir = getAgentDir()) =>
	getGlobalContextPaths(agentDir).filter((path) => existsSync(path));

/**
 * @param {string} prompt
 * @param {number} offset
 * @returns {number}
 */
const getContextSectionEnd = (prompt, offset) => {
	const candidates = [prompt.indexOf(SKILLS_HEADER, offset), prompt.indexOf(DATE_HEADER, offset)].filter(
		(index) => index !== -1,
	);
	return candidates.length > 0 ? Math.min(...candidates) : prompt.length;
};

/**
 * @param {string} contextSection
 * @returns {ContextBlock[]}
 */
const getContextBlocks = (contextSection) => {
	const matches = [...contextSection.matchAll(CONTEXT_BLOCK_HEADER)];
	return matches.map((match, index) => ({
		path: match[1],
		start: match.index ?? 0,
		end: index + 1 < matches.length ? (matches[index + 1].index ?? contextSection.length) : contextSection.length,
	}));
};

/**
 * @param {string} prompt
 * @param {string[]} [globalPaths]
 * @returns {StripResult}
 */
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
	/** @type {string[]} */
	const keptBlocks = [];
	/** @type {string[]} */
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

/**
 * @param {string} start
 * @returns {string | undefined}
 */
const getGitTopLevel = (start) => {
	const topLevel = runGit(start, ["rev-parse", "--show-toplevel"]);
	return topLevel ? normalizePath(topLevel) : undefined;
};

/**
 * @param {string} start
 * @returns {string | undefined}
 */
const getGitCommonDir = (start) => {
	const commonDir = runGit(start, ["rev-parse", "--git-common-dir"]);
	return commonDir ? normalizePath(resolve(start, commonDir)) : undefined;
};

/**
 * @param {string} start
 * @returns {string[]}
 */
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

/**
 * @param {string} [start]
 * @returns {ProjectState}
 */
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

/** @param {ProjectState} state */
const getMarkerRoots = (state) => uniqueSorted([state.projectRoot, ...state.worktreeRoots]);

/** @param {ProjectState} state */
const hasMarker = (state) => getMarkerRoots(state).some((root) => existsSync(getMarkerPath(root)));

/** @param {ProjectState} state */
const writeMarkers = (state) => {
	for (const root of getMarkerRoots(state)) {
		mkdirSync(dirname(getMarkerPath(root)), { recursive: true });
		writeFileSync(getMarkerPath(root), "\n");
	}
};

/** @param {ProjectState} state */
const clearMarkers = (state) => {
	for (const root of getMarkerRoots(state)) {
		rmSync(getMarkerPath(root), { force: true });
	}
};

/**
 * @param {string[]} [paths]
 * @returns {string}
 */
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

/**
 * @param {string} prompt
 * @param {string} [agentDir]
 * @returns {string}
 */
const applyLocalOnlyPrompt = (prompt, agentDir = getAgentDir()) => {
	const { prompt: stripped, removedPaths } = stripGlobalContext(prompt, getGlobalContextPaths(agentDir));
	const notice = buildLocalOnlyNotice(
		removedPaths.length > 0 ? removedPaths : getExistingGlobalContextPaths(agentDir),
	);
	return notice ? `${stripped}\n\n${notice}` : stripped;
};

/** @param {ExtensionContext} ctx */
const setStatus = (ctx) => {
	if (!ctx.hasUI) {
		return;
	}
	const mode = getMode(ctx.cwd);
	ctx.ui.setStatus(COMMAND, mode.enabled ? `AGENTS: local-only (${mode.source})` : undefined);
};

/**
 * @param {ProjectState} state
 * @returns {string}
 */
const getProjectTarget = (state) =>
	state.worktreeRoots.length > 1 ? `${state.projectRoot} and linked worktrees` : state.projectRoot;

/**
 * @param {ProjectState} state
 * @returns {string}
 */
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

/**
 * @param {string} [start]
 * @returns {string}
 */
export function findProjectRoot(start = process.cwd()) {
	return getProjectState(start).projectRoot;
}

/**
 * @param {string | ProjectState} [start]
 * @param {string | undefined} [envValue]
 * @param {string} [configPath]
 * @returns {Mode}
 */
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

/**
 * @param {string} prompt
 * @param {string[]} [globalPaths]
 * @returns {string}
 */
export function stripGlobalBlocks(prompt, globalPaths = getGlobalContextPaths()) {
	return stripGlobalContext(prompt, globalPaths).prompt;
}

/** @param {ExtensionAPI} pi */
export default function localAgentsOnly(pi) {
	pi.registerCommand(COMMAND, {
		description: "Use only repo-local AGENTS prompt context",
		handler: async (args, ctx) => {
			const state = getProjectState(ctx.cwd);
			switch ((args.trim() || "status").toLowerCase()) {
				case "on":
					writeMarkers(state);
					setStatus(ctx);
					ctx.ui.notify(
						`Enabled for ${state.projectRoot}${state.worktreeRoots.length > 1 ? ` across ${state.worktreeRoots.length} worktrees` : ""}`,
						"info",
					);
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
