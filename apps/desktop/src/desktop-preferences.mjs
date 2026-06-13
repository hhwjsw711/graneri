import { readFile, writeFile } from "node:fs/promises";

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
					console.warn("Failed to read desktop preferences.", error);
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
