import pino from "pino";

export const aiLogger = pino({
	base: {
		commit_hash: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
		environment: process.env.GRANERI_ENV_MODE ?? process.env.NODE_ENV ?? "local",
		region: process.env.VERCEL_REGION ?? "local",
		service: "ai",
		version: process.env.npm_package_version ?? "0.0.1",
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
