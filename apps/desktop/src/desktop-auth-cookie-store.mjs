import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const authStoreFileMode = 0o600;
const authStoreDirMode = 0o700;
const authStoreFileName = "desktop-auth-cookies.json";

const isRecord = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const parseCookieJar = (value, origin) => {
	if (!isRecord(value)) {
		throw new Error(`Desktop auth cookie jar for ${origin} must be an object.`);
	}

	const cookieJar = {};

	for (const [name, entry] of Object.entries(value)) {
		if (!name) {
			throw new Error(`Desktop auth cookie name for ${origin} must be set.`);
		}

		if (!isRecord(entry)) {
			throw new Error(
				`Desktop auth cookie entry ${origin}/${name} must be an object.`,
			);
		}

		if (typeof entry.value !== "string") {
			throw new Error(
				`Desktop auth cookie entry ${origin}/${name} must include a string value.`,
			);
		}

		if (entry.expires !== null && typeof entry.expires !== "string") {
			throw new Error(
				`Desktop auth cookie entry ${origin}/${name} must include a string or null expires value.`,
			);
		}

		cookieJar[name] = {
			value: entry.value,
			expires: entry.expires,
		};
	}

	return cookieJar;
};

export const parseCookieJars = (value) => {
	if (!isRecord(value)) {
		throw new Error("Desktop auth cookie jars must be an object.");
	}

	const cookieJars = {};

	for (const [origin, cookieJar] of Object.entries(value)) {
		if (!origin) {
			throw new Error("Desktop auth cookie jar origin must be set.");
		}

		cookieJars[origin] = parseCookieJar(cookieJar, origin);
	}

	return cookieJars;
};

const readStoreFile = (filePath) => {
	if (!existsSync(filePath)) {
		return {};
	}

	const parsed = JSON.parse(readFileSync(filePath, "utf8"));
	if (!isRecord(parsed) || !("cookieJars" in parsed)) {
		throw new Error("Desktop auth cookie store must contain cookieJars.");
	}

	return parseCookieJars(parsed.cookieJars);
};

const writeStoreFile = (filePath, cookieJars) => {
	mkdirSync(dirname(filePath), {
		recursive: true,
		mode: authStoreDirMode,
	});

	const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(
		tempFilePath,
		`${JSON.stringify({ cookieJars: parseCookieJars(cookieJars) }, null, 2)}\n`,
		{ mode: authStoreFileMode },
	);
	chmodSync(tempFilePath, authStoreFileMode);
	renameSync(tempFilePath, filePath);
	chmodSync(filePath, authStoreFileMode);
};

export const createDesktopAuthCookieStore = ({ userDataPath }) => {
	const filePath = join(userDataPath, authStoreFileName);

	return {
		readCookieJars: () => readStoreFile(filePath),
		writeCookieJars: (cookieJars) => writeStoreFile(filePath, cookieJars),
	};
};
