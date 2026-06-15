import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useTranscriptSessionStopController } from "../src/hooks/use-transcript-session-stop-controller";

const transcriptSessionId = "transcript-session-1" as Id<"transcriptSessions">;

const createRepository = () => ({
	completeSession: vi.fn(async () => null),
	requestStopSession: vi.fn(async () => null),
});

it("stops local capture even when durable stop intent fails", async () => {
	const repository = createRepository();
	const stopCapture = vi.fn(async () => undefined);
	repository.requestStopSession.mockRejectedValueOnce(new Error("offline"));
	const { result } = renderHook(() =>
		useTranscriptSessionStopController({
			isSpeechListening: true,
			repository,
			stopCapture,
		}),
	);

	await expect(
		result.current.stopCaptureAfterRequest({
			activeSessionId: transcriptSessionId,
			hasPendingStart: false,
		}),
	).rejects.toThrow("offline");

	expect(repository.requestStopSession).toHaveBeenCalledWith({
		sessionId: transcriptSessionId,
	});
	expect(stopCapture).toHaveBeenCalledTimes(1);
});

it("terminalizes a session when stop wins a pending start race", async () => {
	const repository = createRepository();
	const stopCapture = vi.fn(async () => undefined);
	const { result } = renderHook(() =>
		useTranscriptSessionStopController({
			isSpeechListening: true,
			repository,
			stopCapture,
		}),
	);

	await act(async () => {
		await result.current.stopCaptureAfterRequest({
			activeSessionId: null,
			hasPendingStart: true,
		});
	});
	const didTerminalize = await result.current.terminalizeIfStopWonStartRace({
		sessionId: transcriptSessionId,
	});

	expect(didTerminalize).toBe(true);
	expect(repository.requestStopSession).toHaveBeenCalledWith({
		sessionId: transcriptSessionId,
	});
	expect(repository.completeSession).toHaveBeenCalledWith({
		sessionId: transcriptSessionId,
	});
	expect(stopCapture).toHaveBeenCalledTimes(1);
});

it("does not terminalize a session when capture is still listening", async () => {
	const repository = createRepository();
	const stopCapture = vi.fn(async () => undefined);
	const { result } = renderHook(() =>
		useTranscriptSessionStopController({
			isSpeechListening: true,
			repository,
			stopCapture,
		}),
	);

	const didTerminalize = await result.current.terminalizeIfStopWonStartRace({
		sessionId: transcriptSessionId,
	});

	expect(didTerminalize).toBe(false);
	expect(repository.requestStopSession).not.toHaveBeenCalled();
	expect(repository.completeSession).not.toHaveBeenCalled();
});
