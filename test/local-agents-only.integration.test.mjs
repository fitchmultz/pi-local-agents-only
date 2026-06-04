/**
 * Purpose: Exercise the extension against pi's real system-prompt builder and before_agent_start hook.
 * Responsibilities: Verify stripping uses the already-loaded prompt context rather than rereading live global files.
 * Scope: Integration tests for prompt rewriting only.
 * Usage: Run `npm test` from the package root.
 * Invariants/Assumptions: The repo's devDependency on `@earendil-works/pi-coding-agent` is installed locally.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import localAgentsOnly from "../extensions/local-agents-only.js";

// `buildSystemPrompt` is not part of pi's public exports, so resolve the repo-local package
// entry and import the adjacent internal module from the same pinned installation.
const piEntryUrl = await import.meta.resolve("@earendil-works/pi-coding-agent");
const { buildSystemPrompt } = await import(new URL("./core/system-prompt.js", piEntryUrl));

const withEnv = (name, value, fn) => {
	const previous = process.env[name];
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
	try {
		return fn();
	} finally {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	}
};

const captureBeforeAgentStart = () => {
	let handler;
	localAgentsOnly({
		registerCommand() {},
		on(eventName, next) {
			if (eventName === "before_agent_start") {
				handler = next;
			}
		},
	});
	assert.equal(typeof handler, "function");
	return handler;
};

const createFixture = () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-integration-"));
	const agentDir = join(root, "agent");
	const repo = join(root, "repo");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(repo, ".pi"), { recursive: true });
	writeFileSync(join(repo, ".pi", "local-agents-only"), "\n");
	return { agentDir, repo };
};

const buildPromptFixture = ({ repo, agentDir, globalContent, localBlocks = [] }) => {
	const systemPromptOptions = {
		cwd: repo,
		contextFiles: [{ path: join(agentDir, "AGENTS.md"), content: globalContent }, ...localBlocks],
		selectedTools: ["read"],
		toolSnippets: { read: "Read file contents" },
	};
	return {
		systemPrompt: buildSystemPrompt(systemPromptOptions),
		systemPromptOptions,
	};
};

const runBeforeAgentStart = (handler, repo, agentDir, fixture) =>
	withEnv("PI_CODING_AGENT_DIR", agentDir, () =>
		handler({ prompt: "", images: [], ...fixture }, { cwd: repo }).systemPrompt,
	);

test(
	"before_agent_start strips the loaded global block from a real pi system prompt",
	{ concurrency: false },
	() => {
		const { agentDir, repo } = createFixture();
		const globalPath = join(agentDir, "AGENTS.md");
		writeFileSync(globalPath, "GLOBAL RULES\n");
		const beforeAgentStart = captureBeforeAgentStart();
		const fixture = buildPromptFixture({
			repo,
			agentDir,
			globalContent: "GLOBAL RULES\n",
			localBlocks: [{ path: join(repo, "AGENTS.md"), content: "LOCAL RULES\n" }],
		});

		const prompt = runBeforeAgentStart(beforeAgentStart, repo, agentDir, fixture);

		assert.equal(prompt.includes("GLOBAL RULES"), false);
		assert.equal(prompt.includes("LOCAL RULES"), true);
		assert.equal(prompt.includes(`# Local Context Mode`), true);
		assert.equal(prompt.includes(`- ${globalPath}`), true);
	},
);

test(
	"before_agent_start still strips the already-loaded global block after the file changes on disk",
	{ concurrency: false },
	() => {
		const { agentDir, repo } = createFixture();
		const globalPath = join(agentDir, "AGENTS.md");
		writeFileSync(globalPath, "OLD GLOBAL\n");
		const beforeAgentStart = captureBeforeAgentStart();
		const fixture = buildPromptFixture({
			repo,
			agentDir,
			globalContent: "OLD GLOBAL\n",
			localBlocks: [{ path: join(repo, "AGENTS.md"), content: "LOCAL\n" }],
		});
		writeFileSync(globalPath, "NEW GLOBAL\n");

		const prompt = runBeforeAgentStart(beforeAgentStart, repo, agentDir, fixture);

		assert.equal(prompt.includes("OLD GLOBAL"), false);
		assert.equal(prompt.includes("NEW GLOBAL"), false);
		assert.equal(prompt.includes("LOCAL"), true);
		assert.equal(prompt.includes(`- ${globalPath}`), true);
	},
);

test(
	"before_agent_start removes stale global-only context even after the source file is deleted",
	{ concurrency: false },
	() => {
		const { agentDir, repo } = createFixture();
		const globalPath = join(agentDir, "AGENTS.md");
		writeFileSync(globalPath, "GLOBAL ONLY\n");
		const beforeAgentStart = captureBeforeAgentStart();
		const fixture = buildPromptFixture({
			repo,
			agentDir,
			globalContent: "GLOBAL ONLY\n",
		});
		rmSync(globalPath, { force: true });

		const prompt = runBeforeAgentStart(beforeAgentStart, repo, agentDir, fixture);

		assert.equal(prompt.includes("GLOBAL ONLY"), false);
		assert.equal(prompt.includes("# Project Context"), false);
		assert.equal(prompt.includes(`# Local Context Mode`), true);
		assert.equal(prompt.includes(`- ${globalPath}`), true);
	},
);
