import { readFile, writeFile } from "node:fs/promises";
import { logError } from "./logger.mjs";

const createDefaultDesktopAppPreferences = () => ({
	keepDictationBarVisible: true,
});

const parseDesktopAppPreferences = (value) => {
	const defaults = createDefaultDesktopAppPreferences();

	if (!value || typeof value !== "object") {
		return defaults;
	}

	return {
		keepDictationBarVisible:
			typeof value.keepDictationBarVisible === "boolean"
				? value.keepDictationBarVisible
				: defaults.keepDictationBarVisible,
	};
};

export const createDesktopPreferencesStore = ({ filePath }) => {
	let preferences = createDefaultDesktopAppPreferences();

	return {
		get: () => preferences,
		load: async () => {
			try {
				preferences = parseDesktopAppPreferences(
					JSON.parse(await readFile(filePath, "utf8")),
				);
			} catch (error) {
				if (error?.code !== "ENOENT") {
					logError({
						error: error,
						message: "Failed to read desktop preferences.",
					});
				}

				preferences = createDefaultDesktopAppPreferences();
			}

			return preferences;
		},
		set: async (patch) => {
			preferences = parseDesktopAppPreferences({
				...preferences,
				...patch,
			});
			await writeFile(filePath, JSON.stringify(preferences, null, 2));
			return preferences;
		},
	};
};
