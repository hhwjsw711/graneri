import * as React from "react";
import type { TranscriptSessionRepository } from "@/hooks/use-transcript-session-repository";
import type { Id } from "../../../../convex/_generated/dataModel";

type TranscriptSessionStopRepository = Pick<
	TranscriptSessionRepository,
	"completeSession" | "requestStopSession"
>;

type UseTranscriptSessionStopControllerArgs = {
	isSpeechListening: boolean;
	repository: TranscriptSessionStopRepository;
	stopCapture: () => Promise<void>;
};

export const useTranscriptSessionStopController = ({
	isSpeechListening,
	repository,
	stopCapture,
}: UseTranscriptSessionStopControllerArgs) => {
	const isSpeechListeningRef = React.useRef(isSpeechListening);
	const stopRequestedWhileStartingRef = React.useRef(false);

	React.useEffect(() => {
		isSpeechListeningRef.current = isSpeechListening;
	}, [isSpeechListening]);

	const resetStartingStopRequest = React.useCallback(() => {
		stopRequestedWhileStartingRef.current = false;
	}, []);

	const requestStop = React.useCallback(
		async ({
			activeSessionId,
			hasPendingStart,
		}: {
			activeSessionId: Id<"transcriptSessions"> | null;
			hasPendingStart: boolean;
		}) => {
			if (activeSessionId) {
				await repository.requestStopSession({
					sessionId: activeSessionId,
				});
				return;
			}

			if (hasPendingStart) {
				stopRequestedWhileStartingRef.current = true;
			}
		},
		[repository],
	);

	const stopCaptureAfterRequest = React.useCallback(
		async ({
			activeSessionId,
			hasPendingStart,
		}: {
			activeSessionId: Id<"transcriptSessions"> | null;
			hasPendingStart: boolean;
		}) => {
			try {
				await requestStop({
					activeSessionId,
					hasPendingStart,
				});
			} finally {
				await stopCapture();
			}
		},
		[requestStop, stopCapture],
	);

	const terminalizeIfStopWonStartRace = React.useCallback(
		async ({ sessionId }: { sessionId: Id<"transcriptSessions"> }) => {
			if (
				!stopRequestedWhileStartingRef.current &&
				isSpeechListeningRef.current
			) {
				return false;
			}

			stopRequestedWhileStartingRef.current = false;
			await repository.requestStopSession({
				sessionId,
			});
			await repository.completeSession({
				sessionId,
			});
			return true;
		},
		[repository],
	);

	return React.useMemo(
		() => ({
			resetStartingStopRequest,
			stopCaptureAfterRequest,
			terminalizeIfStopWonStartRace,
		}),
		[
			resetStartingStopRequest,
			stopCaptureAfterRequest,
			terminalizeIfStopWonStartRace,
		],
	);
};
