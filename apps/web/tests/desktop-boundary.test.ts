import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const checkedRoots = ["apps/web/src", "packages/platform/src"];
const allowedDirectBridgeReaders = new Set([
	"packages/platform/src/desktop.ts",
	"packages/platform/src/desktop-bridge.ts",
]);

const collectSourceFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(directory, entry.name);

			if (entry.isDirectory()) {
				return await collectSourceFiles(entryPath);
			}

			return /\.(c|m)?tsx?$/u.test(entry.name) ? [entryPath] : [];
		}),
	);

	return files.flat();
};

describe("desktop platform boundary", () => {
	it("keeps direct bridge access inside packages/platform", async () => {
		const sourceFiles = (
			await Promise.all(
				checkedRoots.map((root) => collectSourceFiles(join(repoRoot, root))),
			)
		).flat();
		const violations: string[] = [];

		for (const filePath of sourceFiles) {
			const relativePath = filePath.slice(repoRoot.length + 1);

			if (allowedDirectBridgeReaders.has(relativePath)) {
				continue;
			}

			const source = await readFile(filePath, "utf8");

			if (source.includes("window.openGranDesktop")) {
				violations.push(relativePath);
			}
		}

		expect(violations).toEqual([]);
	});
});
