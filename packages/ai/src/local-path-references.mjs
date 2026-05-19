const LOCAL_PATH_PATTERN =
	/(file:\/\/\/(?:\\.|[^\s<>"'`)\]}])+|\/(?:Users|home|Volumes|private|tmp|var|opt|srv|mnt|media)\/(?:\\.|[^\s<>"'`)\]}])+|[A-Za-z]:[\\/](?:\\.|[^\s<>"'`)\]}])+|\\\\[^\\/\s<>"'`)\]}]+[\\/][^\\/\s<>"'`)\]}]+(?:[\\/](?:\\.|[^\s<>"'`)\]}])*)?)/gu;

const trimTrailingPunctuation = (value) =>
	value.replace(/[.,;:!?]+$/u, "").replace(/[)\]}]+$/u, "");

const parseLocalPathReference = (value) => {
	const trimmed = trimTrailingPunctuation(value.trim()).replace(
		/\\(.)/gu,
		"$1",
	);

	if (!trimmed) {
		return null;
	}

	try {
		if (trimmed.startsWith("file://")) {
			const url = new URL(trimmed);
			return decodeURIComponent(url.pathname);
		}
	} catch {
		return null;
	}

	if (/^[A-Za-z]:[\\/]/u.test(trimmed) || trimmed.startsWith("\\\\")) {
		return trimmed.replaceAll("\\", "/");
	}

	return trimmed.startsWith("/") ? trimmed : null;
};

export const extractLocalPathReferences = (text) =>
	Array.from(text.matchAll(LOCAL_PATH_PATTERN), (match) =>
		parseLocalPathReference(match[0]),
	).filter(Boolean);

export const extractTextFromUIMessage = (message) => {
	if (!message || typeof message !== "object") {
		return "";
	}

	if (typeof message.content === "string") {
		return message.content;
	}

	if (!Array.isArray(message.parts)) {
		return "";
	}

	return message.parts
		.map((part) =>
			part && part.type === "text" && typeof part.text === "string"
				? part.text
				: "",
		)
		.join("\n");
};

export const mergeLocalFolders = (...folderGroups) => {
	const foldersById = new Map();

	for (const group of folderGroups) {
		for (const folder of group ?? []) {
			if (
				folder &&
				typeof folder.id === "string" &&
				typeof folder.name === "string"
			) {
				foldersById.set(folder.id, folder);
			}
		}
	}

	return Array.from(foldersById.values());
};
