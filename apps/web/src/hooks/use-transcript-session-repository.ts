import { useConvex, useMutation, useQuery } from "convex/react";
import * as React from "react";
import type {
	LiveTranscriptState,
	SystemAudioCaptureSourceMode,
	TranscriptUtterance,
} from "@/lib/transcript";
import {
	clearTranscriptDraft,
	loadTranscriptDraft,
	saveTranscriptDraft,
} from "@/lib/transcript-draft";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type TranscriptDraftRecord = Awaited<ReturnType<typeof loadTranscriptDraft>>;
type TranscriptSessionStatus = Doc<"transcriptSessionStates">["status"];
type TranscriptRefinementStatus =
	Doc<"transcriptSessionStates">["refinementStatus"];

type TranscriptSessionSnapshot = {
	finalTranscript: string;
	generatedNoteAt: number | null;
	refinementError: string | null;
	refinementStatus: TranscriptRefinementStatus;
	sessionId: Id<"transcriptSessions">;
	status: TranscriptSessionStatus;
	updatedAt: number;
	utterances: TranscriptUtterance[];
};

type TranscriptSessionSummary = Omit<TranscriptSessionSnapshot, "utterances">;
type LatestTranscriptSessionState = {
	isFetching: boolean;
	noteId: Id<"notes"> | null;
	value: TranscriptSessionSnapshot | null | undefined;
};

export type TranscriptSessionRepository = ReturnType<
	typeof useTranscriptSessionRepository
>;

const toTranscriptUtteranceInput = (
	utterance: TranscriptUtterance,
	source: "live" | "refined",
) => ({
	utteranceId: utterance.id,
	speaker: utterance.speaker,
	source,
	text: utterance.text,
	startedAt: utterance.startedAt,
	endedAt: utterance.endedAt,
});

export const useTranscriptSessionRepository = (
	noteId: Id<"notes"> | null,
	{
		shouldAutoLoadLatestTranscriptSession = true,
	}: {
		shouldAutoLoadLatestTranscriptSession?: boolean;
	} = {},
) => {
	const convex = useConvex();
	const startTranscriptSessionMutation = useMutation(
		api.transcriptSessions.startSession,
	);
	const requestStopTranscriptSessionMutation = useMutation(
		api.transcriptSessions.requestStopSession,
	);
	const appendTranscriptUtteranceMutation = useMutation(
		api.transcriptSessions.appendUtterance,
	);
	const completeTranscriptSessionMutation = useMutation(
		api.transcriptSessions.completeSession,
	);
	const setTranscriptSessionSystemAudioSourceModeMutation = useMutation(
		api.transcriptSessions.setSystemAudioSourceMode,
	);
	const markTranscriptSessionGeneratedMutation = useMutation(
		api.transcriptSessions.markGenerated,
	);
	const latestTranscriptSessionSummaryQuery = useQuery(
		api.transcriptSessions.getLatestSummaryForNote,
		noteId
			? {
					noteId,
				}
			: "skip",
	);
	const [latestTranscriptSessionState, setLatestTranscriptSessionState] =
		React.useState<LatestTranscriptSessionState>(() => ({
			isFetching: false,
			noteId,
			value: noteId ? undefined : null,
		}));
	const latestTranscriptSessionRequestIdRef = React.useRef(0);
	const latestTranscriptSession =
		latestTranscriptSessionState.noteId === noteId
			? latestTranscriptSessionState.value
			: noteId
				? undefined
				: null;
	const isFetchingLatestTranscriptSession =
		latestTranscriptSessionState.noteId === noteId
			? latestTranscriptSessionState.isFetching
			: false;
	const isLatestTranscriptSessionLoading = Boolean(
		noteId &&
			(isFetchingLatestTranscriptSession ||
				(shouldAutoLoadLatestTranscriptSession &&
					latestTranscriptSessionSummaryQuery !== null &&
					latestTranscriptSession === undefined)),
	);
	const latestTranscriptSessionSummary =
		React.useMemo<TranscriptSessionSummary | null>(
			() =>
				latestTranscriptSessionSummaryQuery
					? {
							sessionId: latestTranscriptSessionSummaryQuery._id,
							finalTranscript:
								latestTranscriptSessionSummaryQuery.finalTranscript?.trim() ||
								"",
							generatedNoteAt:
								latestTranscriptSessionSummaryQuery.generatedNoteAt ?? null,
							refinementError:
								latestTranscriptSessionSummaryQuery.refinementError ?? null,
							refinementStatus:
								latestTranscriptSessionSummaryQuery.refinementStatus,
							status: latestTranscriptSessionSummaryQuery.status,
							updatedAt: latestTranscriptSessionSummaryQuery.updatedAt,
						}
					: null,
			[latestTranscriptSessionSummaryQuery],
		);
	const isLatestTranscriptSessionSummaryLoading = Boolean(
		noteId && latestTranscriptSessionSummaryQuery === undefined,
	);

	const refreshLatestTranscriptSession = React.useCallback(async () => {
		const requestId = latestTranscriptSessionRequestIdRef.current + 1;
		latestTranscriptSessionRequestIdRef.current = requestId;

		if (!noteId) {
			setLatestTranscriptSessionState({
				isFetching: false,
				noteId: null,
				value: null,
			});
			return null;
		}

		setLatestTranscriptSessionState((currentState) => ({
			isFetching: true,
			noteId,
			value: currentState.noteId === noteId ? currentState.value : undefined,
		}));

		try {
			const result = await convex.query(
				api.transcriptSessions.getStoredTranscriptForNote,
				{
					noteId,
				},
			);
			const nextValue: TranscriptSessionSnapshot | null = result
				? {
						sessionId: result.session._id,
						finalTranscript: result.session.finalTranscript?.trim() || "",
						generatedNoteAt: result.session.generatedNoteAt ?? null,
						refinementError: result.session.refinementError ?? null,
						refinementStatus: result.session.refinementStatus,
						status: result.session.status,
						updatedAt: result.session.updatedAt,
						utterances: result.utterances.map((utterance) => ({
							id: utterance.utteranceId,
							speaker: utterance.speaker as TranscriptUtterance["speaker"],
							text: utterance.text,
							startedAt: utterance.startedAt,
							endedAt: utterance.endedAt,
						})),
					}
				: null;

			if (latestTranscriptSessionRequestIdRef.current === requestId) {
				React.startTransition(() => {
					setLatestTranscriptSessionState({
						isFetching: false,
						noteId,
						value: nextValue,
					});
				});
			}

			return nextValue;
		} catch (error) {
			if (latestTranscriptSessionRequestIdRef.current === requestId) {
				setLatestTranscriptSessionState((currentState) => ({
					isFetching: false,
					noteId,
					value:
						currentState.noteId === noteId ? currentState.value : undefined,
				}));
			}
			throw error;
		}
	}, [convex, noteId]);

	React.useEffect(() => {
		if (
			!shouldAutoLoadLatestTranscriptSession ||
			!noteId ||
			latestTranscriptSessionSummaryQuery === undefined
		) {
			return;
		}

		if (latestTranscriptSessionSummary === null) {
			// The latest-session cache mirrors Convex query state for this note scope.
			// react-doctor-disable-next-line react-doctor/no-chain-state-updates react-doctor/no-derived-state
			setLatestTranscriptSessionState({
				isFetching: false,
				noteId,
				value: null,
			});
			return;
		}

		if (
			latestTranscriptSession !== undefined &&
			latestTranscriptSession?.sessionId ===
				latestTranscriptSessionSummary.sessionId
		) {
			return;
		}

		void refreshLatestTranscriptSession();
	}, [
		latestTranscriptSession,
		latestTranscriptSessionSummary,
		latestTranscriptSessionSummaryQuery,
		noteId,
		refreshLatestTranscriptSession,
		shouldAutoLoadLatestTranscriptSession,
	]);

	React.useEffect(() => {
		if (
			!noteId ||
			!latestTranscriptSessionSummary ||
			latestTranscriptSession === undefined ||
			latestTranscriptSession === null ||
			latestTranscriptSession.sessionId !==
				latestTranscriptSessionSummary.sessionId
		) {
			return;
		}

		if (
			latestTranscriptSession.finalTranscript ===
				latestTranscriptSessionSummary.finalTranscript &&
			latestTranscriptSession.generatedNoteAt ===
				latestTranscriptSessionSummary.generatedNoteAt &&
			latestTranscriptSession.refinementStatus ===
				latestTranscriptSessionSummary.refinementStatus &&
			latestTranscriptSession.refinementError ===
				latestTranscriptSessionSummary.refinementError
		) {
			return;
		}

		void refreshLatestTranscriptSession();
	}, [
		latestTranscriptSession,
		latestTranscriptSessionSummary,
		noteId,
		refreshLatestTranscriptSession,
	]);

	const startSession = React.useCallback(
		async ({
			noteId,
			systemAudioSourceMode,
		}: {
			noteId: Id<"notes">;
			systemAudioSourceMode?: SystemAudioCaptureSourceMode;
		}) =>
			await startTranscriptSessionMutation({
				noteId,
				systemAudioSourceMode,
			}),
		[startTranscriptSessionMutation],
	);

	const appendUtterance = React.useCallback(
		async ({
			sessionId,
			source,
			utterance,
		}: {
			sessionId: Id<"transcriptSessions">;
			source: "live" | "refined";
			utterance: TranscriptUtterance;
		}) =>
			await appendTranscriptUtteranceMutation({
				sessionId,
				utterance: toTranscriptUtteranceInput(utterance, source),
			}),
		[appendTranscriptUtteranceMutation],
	);

	const completeSession = React.useCallback(
		async ({
			finalTranscript,
			sessionId,
			status,
		}: {
			finalTranscript?: string;
			sessionId: Id<"transcriptSessions">;
			status?: "completed" | "failed";
		}) =>
			await completeTranscriptSessionMutation({
				sessionId,
				finalTranscript,
				status,
			}),
		[completeTranscriptSessionMutation],
	);

	const requestStopSession = React.useCallback(
		async ({ sessionId }: { sessionId: Id<"transcriptSessions"> }) =>
			await requestStopTranscriptSessionMutation({
				sessionId,
			}),
		[requestStopTranscriptSessionMutation],
	);

	const setSystemAudioSourceMode = React.useCallback(
		async ({
			sessionId,
			systemAudioSourceMode,
		}: {
			sessionId: Id<"transcriptSessions">;
			systemAudioSourceMode: SystemAudioCaptureSourceMode;
		}) =>
			await setTranscriptSessionSystemAudioSourceModeMutation({
				sessionId,
				systemAudioSourceMode,
			}),
		[setTranscriptSessionSystemAudioSourceModeMutation],
	);

	const markGenerated = React.useCallback(
		async ({ sessionId }: { sessionId: Id<"transcriptSessions"> }) =>
			await markTranscriptSessionGeneratedMutation({
				sessionId,
			}),
		[markTranscriptSessionGeneratedMutation],
	);

	const loadDraft = React.useCallback(
		async (noteKey: string): Promise<TranscriptDraftRecord> =>
			await loadTranscriptDraft(noteKey),
		[],
	);

	const saveDraft = React.useCallback(
		async ({
			liveTranscript,
			noteKey,
			pendingGenerateTranscript,
			utterances,
		}: {
			liveTranscript: LiveTranscriptState;
			noteKey: string;
			pendingGenerateTranscript: string;
			utterances: TranscriptUtterance[];
		}) =>
			await saveTranscriptDraft({
				noteKey,
				utterances,
				liveTranscript,
				pendingGenerateTranscript,
			}),
		[],
	);

	const clearDraft = React.useCallback(
		async (noteKey: string) => await clearTranscriptDraft(noteKey),
		[],
	);

	return React.useMemo(
		() => ({
			appendUtterance,
			clearDraft,
			completeSession,
			isLatestTranscriptSessionLoading,
			isLatestTranscriptSessionSummaryLoading,
			latestTranscriptSession,
			latestTranscriptSessionSummary,
			loadDraft,
			markGenerated,
			refreshLatestTranscriptSession,
			requestStopSession,
			saveDraft,
			setSystemAudioSourceMode,
			startSession,
		}),
		[
			appendUtterance,
			clearDraft,
			completeSession,
			isLatestTranscriptSessionLoading,
			isLatestTranscriptSessionSummaryLoading,
			latestTranscriptSession,
			latestTranscriptSessionSummary,
			loadDraft,
			markGenerated,
			refreshLatestTranscriptSession,
			requestStopSession,
			saveDraft,
			setSystemAudioSourceMode,
			startSession,
		],
	);
};
