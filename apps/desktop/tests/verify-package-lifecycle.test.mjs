import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));

const verifyPackageSource = readFileSync(
	resolve(testDir, "..", "scripts", "verify-package.mjs"),
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

test("desktop package verification rejects unexpected Convex deployments generically", () => {
	assert.match(
		verifyPackageSource,
		/convexDeploymentUrlPattern\s*=/u,
	);
	assert.match(
		verifyPackageSource,
		/Packaged app contains unexpected Convex deployment/u,
	);
	assert.doesNotMatch(verifyPackageSource, /clever-chinchilla-887/u);
});
