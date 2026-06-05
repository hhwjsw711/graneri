import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const resolveDesktopRuntimeBinPath = ({ executableName, runtimeDir }) =>
	resolve(runtimeDir, "bin", executableName);

export const resolveGeneratedDesktopHelperPath = ({
	executableName,
	runtimeDir,
}) => resolve(runtimeDir, "..", ".generated", "system-audio", executableName);

export const resolveDesktopRuntimeExecutablePath = ({
	envPath,
	executableName,
	runtimeDir,
}) => {
	const candidates = [
		envPath?.trim(),
		resolveDesktopRuntimeBinPath({ executableName, runtimeDir }),
		resolveGeneratedDesktopHelperPath({ executableName, runtimeDir }),
	].filter(Boolean);

	return candidates.find((candidatePath) => existsSync(candidatePath)) ?? null;
};
