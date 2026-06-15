import type { IncomingMessage } from "node:http";
import os from "node:os";
import pino from "pino";

export type ServerWideEvent = Record<string, unknown> & {
	duration_ms?: number;
	errors?: Array<Record<string, unknown>>;
	event: string;
	method?: string;
	outcome?: "error" | "success";
	path?: string;
	status_code?: number;
	timestamp: string;
};

const serializeError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return { message: String(error), type: "UnknownError" };
	}

	return {
		message: error.message,
		type: error.name,
	};
};

const serverLogger = pino({
	base: {
		commit_hash: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
		environment:
			process.env.GRANERI_ENV_MODE ?? process.env.NODE_ENV ?? "local",
		instance_id: process.env.VERCEL_DEPLOYMENT_ID ?? os.hostname(),
		region: process.env.VERCEL_REGION ?? "local",
		service: "web-server",
		version: process.env.npm_package_version ?? "0.0.1",
	},
	level: "info",
});

export const createServerWideEvent = ({
	event,
	request,
}: {
	event: string;
	request?: IncomingMessage;
}): ServerWideEvent => ({
	event,
	method: request?.method,
	path: request?.url,
	request_id:
		typeof request?.headers["x-request-id"] === "string"
			? request.headers["x-request-id"]
			: undefined,
	timestamp: new Date().toISOString(),
});

export const recordServerError = ({
	details = {},
	error,
	event,
	operation,
}: {
	details?: Record<string, unknown>;
	error: unknown;
	event: ServerWideEvent;
	operation: string;
}) => {
	event.errors ??= [];
	event.errors.push({
		operation,
		...details,
		error: serializeError(error),
	});
};

export const emitServerWideEvent = ({
	event,
	level = "info",
	startedAt,
}: {
	event: ServerWideEvent;
	level?: "error" | "info";
	startedAt: number;
}) => {
	event.duration_ms = Date.now() - startedAt;

	if (level === "error") {
		serverLogger.error(event);
		return;
	}

	serverLogger.info(event);
};
