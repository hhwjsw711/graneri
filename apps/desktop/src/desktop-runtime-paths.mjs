import { existsSync } from "node:fs";
import { resolve } from "node:path";

const asarPathSegment = ".asar";
const asarUnpackedPathSegment = ".asar.unpacked";

const resolveAsarUnpackedPath = (filePath) =>
	filePath.includes(asarPathSegment)
		? filePath.replace(asarPathSegment, asarUnpackedPathSegment)
		: null;

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
	const runtimeBinPath = resolveDesktopRuntimeBinPath({
		executableName,
		runtimeDir,
	});
	const candidates = [
		envPath?.trim(),
		resolveAsarUnpackedPath(runtimeBinPath),
		runtimeBinPath,
		resolveGeneratedDesktopHelperPath({ executableName, runtimeDir }),
	].filter(Boolean);

	return candidates.find((candidatePath) => existsSync(candidatePath)) ?? null;
};
