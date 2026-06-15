import os from "node:os";
import pino from "pino";

const DESKTOP_LOGGER_BASE = {
	commit_hash: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
	environment: process.env.GRANERI_ENV_MODE ?? process.env.NODE_ENV ?? "local",
	instance_id: os.hostname(),
	region: process.env.VERCEL_REGION ?? "local",
	service: "desktop",
	version: process.env.npm_package_version ?? "0.1.0",
};

const normalizeMessage = ({ fallback, message }) => {
	if (typeof message !== "string") {
		return fallback;
	}

	const isFailure = /^Failed(\s+to)?\s+/i.test(message);
	const base = message
		.replace(/^\[[^\]]+\]\s*/, "")
		.replace(/^Failed\s+to\s+/i, "")
		.replace(/^Failed\s+/i, "")
		.replace(/\.$/, "")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();

	if (!base) {
		return fallback;
	}

	return isFailure ? `${base}_failed` : base;
};

export const serializeError = (error) => {
	if (error && typeof error === "object" && !(error instanceof Error)) {
		return error;
	}

	if (!(error instanceof Error)) {
		return { message: String(error), type: "UnknownError" };
	}

	return {
		message: error.message,
		stack: error.stack,
		type: error.name,
	};
};

const normalizeEvent = ({ defaultEvent, event }) => {
	const { event: explicitEvent, ...details } = event;

	return {
		...details,
		event:
			explicitEvent ??
			normalizeMessage({
				fallback: defaultEvent,
				message: event.message,
			}),
	};
};

export const logger = pino({
	base: DESKTOP_LOGGER_BASE,
	level:
		process.env.NODE_ENV === "test" ||
		process.argv.some((argument) => argument.includes("/tests/"))
			? "silent"
			: "info",
});

export const logInfo = (event) => {
	logger.info(normalizeEvent({ defaultEvent: "desktop.info", event }));
};

export const logError = ({ error, ...event }) => {
	logger.error({
		...normalizeEvent({ defaultEvent: "desktop.error", event }),
		error: error === undefined ? undefined : serializeError(error),
	});
};
