import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(packageRoot, "src/assets");
const sourceIconPath = resolve(assetsDir, "GraneriTemplate.svg");
const dockSourceIconPath = resolve(assetsDir, "GraneriDock.svg");

const buildMarkup = (svgMarkup, _canvasSize, iconSize) => `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<style>
			html,
			body {
				margin: 0;
				width: 100%;
				height: 100%;
				background: transparent;
				overflow: hidden;
			}

			body {
				display: grid;
				place-items: center;
			}

			svg {
				width: ${iconSize}px;
				height: ${iconSize}px;
				display: block;
			}
		</style>
	</head>
	<body>${svgMarkup}</body>
</html>`;

const renderIcon = async ({ svgMarkup, canvasSize, iconSize, outputPath }) => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "graneri-tray-"));
	const tempHtmlPath = resolve(tempDir, `tray-${canvasSize}.html`);

	const window = new BrowserWindow({
		width: canvasSize,
		height: canvasSize,
		show: false,
		frame: false,
		transparent: true,
		resizable: false,
		useContentSize: true,
		webPreferences: {
			backgroundThrottling: false,
		},
	});

	try {
		await writeFile(
			tempHtmlPath,
			buildMarkup(svgMarkup, canvasSize, iconSize),
			"utf8",
		);
		await window.loadFile(tempHtmlPath);
		await new Promise((resolvePromise) => {
			setTimeout(resolvePromise, 50);
		});

		const image = await window.webContents.capturePage();
		const pngBuffer = image.toPNG({ scaleFactor: 1 });
		await writeFile(outputPath, pngBuffer);
	} finally {
		window.destroy();
		await rm(tempDir, { recursive: true, force: true });
	}
};

app.on("window-all-closed", (event) => {
	event.preventDefault();
});

app.whenReady().then(async () => {
	try {
		await mkdir(assetsDir, { recursive: true });
		const svgMarkup = await readFile(sourceIconPath, "utf8");
		const dockSvgMarkup = await readFile(dockSourceIconPath, "utf8");

		await renderIcon({
			svgMarkup,
			canvasSize: 16,
			iconSize: 8,
			outputPath: resolve(assetsDir, "GraneriTemplate.png"),
		});
		await renderIcon({
			svgMarkup,
			canvasSize: 32,
			iconSize: 16,
			outputPath: resolve(assetsDir, "GraneriTemplate@2x.png"),
		});
		await renderIcon({
			svgMarkup: dockSvgMarkup,
			canvasSize: 256,
			iconSize: 224,
			outputPath: resolve(assetsDir, "GraneriDock.png"),
		});
		app.exit(0);
	} catch (error) {
		console.error(error);
		app.exit(1);
	} finally {
		app.quit();
	}
});
