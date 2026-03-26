/**
 * Purpose: Verify the local-agents-only extension's repo detection, activation precedence, and prompt stripping.
 * Responsibilities: Test git-root discovery, env and config precedence, and removal of global prompt blocks.
 * Scope: Minimal unit tests for the extension's exported helpers.
 * Usage: Run `npm test` from the package root.
 * Invariants/Assumptions: Tests use temporary directories and do not touch the user's real pi config.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findProjectRoot, getMode, stripGlobalBlocks } from "../extensions/local-agents-only.js";

test("findProjectRoot returns the nearest git root", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-root-"));
	const nested = join(root, "a", "b");
	mkdirSync(join(root, ".git"), { recursive: true });
	mkdirSync(nested, { recursive: true });
	assert.equal(findProjectRoot(nested), root);
});

test("getMode prefers env override, then repo marker, then global config", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-mode-"));
	const configPath = join(root, "local-agents-only.json");
	const markerPath = join(root, ".pi", "local-agents-only");
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(configPath, JSON.stringify({ projects: [root] }));
	writeFileSync(markerPath, "\n");
	assert.deepEqual(getMode(root, "1", configPath), { enabled: true, source: "env" });
	assert.deepEqual(getMode(root, "0", configPath), { enabled: false, source: "env" });
	assert.deepEqual(getMode(root, "", configPath), { enabled: true, source: "marker" });
	assert.equal(rmSync(markerPath, { force: true }), undefined);
	assert.deepEqual(getMode(root, "", configPath), { enabled: true, source: "global-config" });
	assert.deepEqual(getMode(mkdtempSync(join(tmpdir(), "pi-local-agents-only-default-")), "", configPath), {
		enabled: false,
		source: "default",
	});
});

test("stripGlobalBlocks removes all global blocks and keeps local context", () => {
	const globalAgents = "## /home/me/.pi/agent/AGENTS.md\n\nA\n\n";
	const globalClaude = "## /home/me/.pi/agent/CLAUDE.md\n\nB\n\n";
	const localAgents = "## /repo/AGENTS.md\n\nLOCAL\n\n";
	const prompt = `${globalAgents}${globalClaude}${localAgents}`;
	assert.equal(stripGlobalBlocks(prompt, [globalAgents, globalClaude]), localAgents);
});
