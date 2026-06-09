export const desktopPackageContract = {
	appDirectory: ".package-app",
	asarUnpack: ["dist-electron/main/bin/**"],
	builderFiles: [
		"dist-electron/**/*",
		"dist-app/**/*",
		"package.json",
		"!node_modules/**",
	],
	mainEntry: "dist-electron/main/index.js",
	packagedResourcesPath: "release/mac-arm64/Graneri.app/Contents/Resources/app",
	packagedResourcesAsarPath:
		"release/mac-arm64/Graneri.app/Contents/Resources/app.asar",
	rendererDirectory: "dist-app",
	runtimeDirectory: "dist-electron/main",
	runtimeImportDirectory: "dist-electron/",
};

export const createDesktopPackageManifest = (desktopPackage) => ({
	name: "desktop",
	productName: "Graneri",
	version: desktopPackage.version,
	description: desktopPackage.description,
	author: desktopPackage.author,
	type: "module",
	main: desktopPackageContract.mainEntry,
	dependencies: {},
});
