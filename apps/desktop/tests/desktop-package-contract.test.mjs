import assert from "node:assert/strict";
import test from "node:test";
import {
	createDesktopPackageManifest,
	desktopPackageContract,
} from "../scripts/desktop-package-contract.mjs";

test("desktop package contract owns the generated runtime layout", () => {
	assert.equal(desktopPackageContract.appDirectory, ".package-app");
	assert.equal(
		desktopPackageContract.mainEntry,
		"dist-electron/main/index.js",
	);
	assert.equal(desktopPackageContract.rendererDirectory, "dist-app");
	assert.equal(desktopPackageContract.runtimeDirectory, "dist-electron/main");
	assert.deepEqual(desktopPackageContract.asarUnpack, [
		"dist-electron/main/bin/**",
	]);
	assert.deepEqual(desktopPackageContract.builderFiles, [
		"dist-electron/**/*",
		"dist-app/**/*",
		"package.json",
		"!node_modules/**",
	]);
});

test("desktop package manifest points Electron at the generated main entry", () => {
	assert.deepEqual(
		createDesktopPackageManifest({
			author: "Graneri",
			description: "Graneri desktop app",
			version: "0.1.0",
		}),
		{
			author: "Graneri",
			dependencies: {},
			description: "Graneri desktop app",
			main: "dist-electron/main/index.js",
			name: "desktop",
			productName: "Graneri",
			type: "module",
			version: "0.1.0",
		},
	);
});
