import { spawn } from "node:child_process";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutDir = resolve(packageRoot, ".generated", "system-audio");
const outDirFlagIndex = process.argv.indexOf("--out-dir");
const outDir =
	outDirFlagIndex >= 0 && process.argv[outDirFlagIndex + 1]
		? resolve(process.argv[outDirFlagIndex + 1])
		: defaultOutDir;
const cacheRootDir = resolve(outDir, ".cache");
const clangModuleCacheDir = resolve(cacheRootDir, "clang", "ModuleCache");
const emptyPkgConfigDir = resolve(cacheRootDir, "pkgconfig-empty");
const tmpDir = resolve(outDir, ".tmp");
const nativeAecManifest = resolve(packageRoot, "native-aec", "Cargo.toml");
const nativeAecTargetDir = resolve(packageRoot, "native-aec", "target");
const nativeAecReleaseDir = resolve(nativeAecTargetDir, "release");
const helpers = [
	{
		outputFile: resolve(outDir, "graneri-system-audio-helper"),
		sourceFiles: [
			resolve(packageRoot, "native", "NativeAudioEventIO.swift"),
			resolve(packageRoot, "native", "SystemAudioCaptureCLI.swift"),
		],
	},
	{
		outputFile: resolve(outDir, "graneri-microphone-helper"),
		sourceFiles: [
			resolve(packageRoot, "native", "NativeAudioEventIO.swift"),
			resolve(packageRoot, "native", "MicrophoneCaptureCLI.swift"),
		],
	},
	{
		outputFile: resolve(outDir, "graneri-combined-audio-helper"),
		sourceFiles: [
			resolve(packageRoot, "native", "NativeAudioEventIO.swift"),
			resolve(packageRoot, "native", "WebRtcAec3Processor.swift"),
			resolve(packageRoot, "native", "CombinedAudioProcessingPipeline.swift"),
			resolve(packageRoot, "native", "SystemAudioCaptureCLI.swift"),
			resolve(packageRoot, "native", "MicrophoneCaptureCLI.swift"),
			resolve(packageRoot, "native", "CombinedAudioCaptureCLI.swift"),
		],
		swiftFlags: ["-D", "GRANERI_COMBINED_AUDIO_HELPER"],
		linkFlags: [
			"-L",
			nativeAecReleaseDir,
			"-lgraneri_aec",
			"-lc++",
			"-framework",
			"Security",
			"-framework",
			"SystemConfiguration",
		],
	},
	{
		outputFile: resolve(outDir, "graneri-microphone-activity-helper"),
		sourceFiles: [
			resolve(packageRoot, "native", "LineEventIO.swift"),
			resolve(packageRoot, "native", "MicrophoneActivityCLI.swift"),
		],
	},
	{
		outputFile: resolve(outDir, "graneri-meeting-window-helper"),
		sourceFiles: [
			resolve(packageRoot, "native", "LineEventIO.swift"),
			resolve(packageRoot, "native", "MeetingWindowCLI.swift"),
		],
	},
	{
		outputFile: resolve(outDir, "graneri-global-dictation-hotkey-helper"),
		sourceFiles: [
			resolve(packageRoot, "native", "LineEventIO.swift"),
			resolve(packageRoot, "native", "GlobalDictationHotkeyCLI.swift"),
		],
	},
];

const run = (cmd, args) =>
	new Promise((resolvePromise, rejectPromise) => {
		const isCargoBuild = cmd === "cargo";
		const child = spawn(cmd, args, {
			cwd: packageRoot,
			env: {
				...process.env,
				CLANG_MODULE_CACHE_PATH: clangModuleCacheDir,
				...(isCargoBuild
					? {
							PKG_CONFIG_LIBDIR: emptyPkgConfigDir,
							PKG_CONFIG_PATH: emptyPkgConfigDir,
						}
					: {}),
				TMPDIR: tmpDir,
				XDG_CACHE_HOME: cacheRootDir,
			},
			stdio: "inherit",
		});

		child.on("error", rejectPromise);
		child.on("exit", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}

			rejectPromise(
				new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? -1}.`),
			);
		});
	});

if (process.platform !== "darwin") {
	await rm(outDir, { recursive: true, force: true });
	process.exit(0);
}

await mkdir(outDir, { recursive: true });
await mkdir(clangModuleCacheDir, { recursive: true });
await mkdir(emptyPkgConfigDir, { recursive: true });
await mkdir(tmpDir, { recursive: true });

await run("cargo", [
	"build",
	"--release",
	"--manifest-path",
	nativeAecManifest,
	"--target-dir",
	nativeAecTargetDir,
]);

for (const {
	outputFile,
	sourceFiles,
	swiftFlags = [],
	linkFlags = [],
} of helpers) {
	await run("swiftc", [
		"-O",
		"-module-cache-path",
		clangModuleCacheDir,
		"-parse-as-library",
		...swiftFlags,
		"-o",
		outputFile,
		...sourceFiles,
		...linkFlags,
	]);
	await chmod(outputFile, 0o755);
}
