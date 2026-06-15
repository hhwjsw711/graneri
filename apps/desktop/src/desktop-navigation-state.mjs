import { mkdir, readFile, writeFile } from "node:fs/promises";
import { logError } from "./logger.mjs";

const defaultLastNavigation = {
	hash: "",
	pathname: "/home",
	search: "",
};

const normalizeRestorableNavigation = ({
	pathname = "/home",
	search = "",
} = {}) => {
	if (typeof pathname !== "string") {
		return null;
	}

	if (!["/home", "/chat", "/note", "/shared"].includes(pathname)) {
		return null;
	}

	const params = new URLSearchParams(typeof search === "string" ? search : "");

	if (pathname === "/note") {
		const noteId = params.get("noteId")?.trim();

		if (!noteId) {
			return null;
		}

		return {
			hash: "",
			pathname,
			search: `?noteId=${encodeURIComponent(noteId)}`,
		};
	}

	if (pathname === "/chat") {
		const chatId = params.get("chatId")?.trim();

		return {
			hash: "",
			pathname,
			search: chatId ? `?chatId=${encodeURIComponent(chatId)}` : "",
		};
	}

	return {
		hash: "",
		pathname,
		search: "",
	};
};

export const createDesktopNavigationState = ({
	lastNavigationPath,
	resolveRendererUrl,
	sameRendererUrl,
	userDataPath,
}) => {
	let lastNavigation = { ...defaultLastNavigation };

	const load = async () => {
		try {
			const raw = await readFile(lastNavigationPath, "utf8");
			const parsed = JSON.parse(raw);

			lastNavigation = normalizeRestorableNavigation(parsed) ?? {
				...defaultLastNavigation,
			};
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				lastNavigation = { ...defaultLastNavigation };
				return;
			}

			logError({
				error: error,
				message: "Failed to read last navigation.",
			});
			lastNavigation = { ...defaultLastNavigation };
		}
	};

	const save = async () => {
		try {
			await mkdir(userDataPath, { recursive: true });
			await writeFile(
				lastNavigationPath,
				JSON.stringify(lastNavigation, null, 2),
				"utf8",
			);
		} catch (error) {
			logError({
				error: error,
				message: "Failed to save last navigation.",
			});
		}
	};

	const remember = async (urlString) => {
		try {
			const rendererUrl = new URL(await resolveRendererUrl());
			const nextUrl = new URL(urlString);

			if (!sameRendererUrl(nextUrl, rendererUrl)) {
				return;
			}

			const normalizedNavigation = normalizeRestorableNavigation({
				hash: nextUrl.hash,
				pathname: nextUrl.pathname,
				search: nextUrl.search,
			});

			if (!normalizedNavigation) {
				return;
			}

			if (
				lastNavigation.pathname === normalizedNavigation.pathname &&
				lastNavigation.search === normalizedNavigation.search &&
				lastNavigation.hash === normalizedNavigation.hash
			) {
				return;
			}

			lastNavigation = normalizedNavigation;
			await save();
		} catch (error) {
			logError({
				error: error,
				message: "Failed to remember renderer navigation.",
			});
		}
	};

	const reset = async () => {
		lastNavigation = { ...defaultLastNavigation };
		await save();
	};

	return {
		get: () => lastNavigation,
		load,
		remember,
		reset,
	};
};

export const getDefaultDesktopNavigation = () => ({ ...defaultLastNavigation });
