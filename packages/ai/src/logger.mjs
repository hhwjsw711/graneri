import pino from "pino";

const env =
	typeof globalThis.process === "object" &&
	globalThis.process !== null &&
	typeof globalThis.process.env === "object" &&
	globalThis.process.env !== null
		? globalThis.process.env
		: {};

export const aiLogger = pino({
	base: {
		commit_hash: env.VERCEL_GIT_COMMIT_SHA ?? "local",
		environment: env.GRANERI_ENV_MODE ?? env.NODE_ENV ?? "local",
		region: env.VERCEL_REGION ?? "local",
		service: "ai",
		version: env.npm_package_version ?? "0.0.1",
	},
	level: "info",
});

export const serializeError = (error) => {
	if (!(error instanceof Error)) {
		return { message: String(error), type: "UnknownError" };
	}

	return {
		message: error.message,
		stack: error.stack,
		type: error.name,
	};
};
