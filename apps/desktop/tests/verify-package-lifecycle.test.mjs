import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const verifyPackageSource = readFileSync(
	resolve("scripts", "verify-package.mjs"),
	"utf8",
);

test("desktop package verification rejects legacy chat lifecycle fallbacks", () => {
	for (const forbiddenPatternSource of [
		'["allow", "Concurrent", "Run"].join("")',
		'["allow", "concurrent"].join("_")',
		'["return", "existing"].join("_")',
		'["mark", "Assistant", "Run", "Running"].join("")',
		'["requeue", "Claimed"].join("")',
		'["queued", "Assistant", "Run"].join("")',
		'["queued", "assistant", "run"].join("_")',
		'["status", ":", \'"discarded"\'].join("")',
	]) {
		assert.match(
			verifyPackageSource,
			new RegExp(
				`pattern: ${forbiddenPatternSource.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
				"u",
			),
		);
	}
});
