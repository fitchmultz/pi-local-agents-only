/**
 * Purpose: Verify repo opt-in logic and prompt stripping for the local-agents-only pi extension.
 * Responsibilities: Cover env overrides, repo marker detection, global allowlist handling, and multi-block prompt stripping.
 * Scope: Unit tests for helper functions exported by the extension package.
 * Usage: Run `npm test` from the package root.
 * Invariants/Assumptions: Tests use temporary directories and do not mutate the user's real pi config.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	findProjectRoot,
	getMode,
	normalizePath,
	stripGlobalBlocks,
	writeGlobalConfig,
} from "../extensions/local-agents-only.js";

test("findProjectRoot returns nearest git root", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-root-"));
	const nested = join(root, "a", "b");
	mkdirSync(join(root, ".git"), { recursive: true });
	mkdirSync(nested, { recursive: true });
	assert.equal(findProjectRoot(nested), root);
});

test("getMode honors env overrides before marker and config", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-env-"));
	const configPath = join(root, "config.json");
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "local-agents-only"), "\n");
	writeGlobalConfig([root], configPath);
	assert.deepEqual(getMode(root, "1", configPath), { enabled: true, source: "env" });
	assert.deepEqual(getMode(root, "0", configPath), { enabled: false, source: "env" });
});

test("getMode falls back to marker then global config", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-local-agents-only-mode-"));
	const configPath = join(root, "config.json");
	assert.deepEqual(getMode(root, "", configPath), { enabled: false, source: "default" });
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "local-agents-only"), "\n");
	assert.deepEqual(getMode(root, "", configPath), { enabled: true, source: "marker" });
	const otherRoot = mkdtempSync(join(tmpdir(), "pi-local-agents-only-config-"));
	writeGlobalConfig([otherRoot], configPath);
	assert.deepEqual(getMode(otherRoot, "", configPath), { enabled: true, source: "global-config" });
	assert.equal(normalizePath(otherRoot), readProjects(configPath)[0]);
});

test("stripGlobalBlocks removes every global context block", () => {
	const blockA = "## /home/me/.pi/agent/AGENTS.md\n\nA\n\n";
	const blockB = "## /home/me/.pi/agent/CLAUDE.md\n\nB\n\n";
	const localBlock = "## /repo/AGENTS.md\n\nLOCAL\n\n";
	const prompt = `base\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n${blockA}${blockB}${localBlock}`;
	assert.equal(stripGlobalBlocks(prompt, [blockA, blockB]), `base\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n${localBlock}`);
});

function readProjects(configPath) {
	return JSON.parse(readFileSync(configPath, "utf8")).projects;
}
