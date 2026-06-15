import { logError, logInfo } from "@/lib/logger";

type TranscriptionLoggerContext = {
	sessionId: string;
	scopeKey: string | null;
};

export type TranscriptionLogger = {
	info: (event: string, details?: Record<string, unknown>) => void;
	error: (event: string, details?: Record<string, unknown>) => void;
};

export const createTranscriptionLogger = ({
	sessionId,
	scopeKey,
}: TranscriptionLoggerContext): TranscriptionLogger => {
	const write = (
		level: "error" | "info",
		event: string,
		details?: Record<string, unknown>,
	) => {
		const payload = {
			event: `transcription.${event}`,
			scopeKey,
			sessionId,
			timestamp: new Date().toISOString(),
			...(details ?? {}),
		};

		if (level === "error") {
			logError(payload);
			return;
		}

		logInfo(payload);
	};

	return {
		info: (event, details) => write("info", event, details),
		error: (event, details) => write("error", event, details),
	};
};
