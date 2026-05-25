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
import type { Id } from "../../../../convex/_generated/dataModel";

type TranscriptDraftRecord = Awaited<ReturnType<typeof loadTranscriptDraft>>;

type TranscriptSessionSnapshot = {
	finalTranscript: string;
	generatedNoteAt: number | null;
	refinementError: string | null;
	refinementStatus: "idle" | "running" | "completed" | "failed";
	sessionId: Id<"transcriptSessions">;
	updatedAt: number;
	utterances: TranscriptUtterance[];
};

type TranscriptSessionSummary = Omit<TranscriptSessionSnapshot, "utterances">;

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
	const [latestTranscriptSession, setLatestTranscriptSession] = React.useState<
		TranscriptSessionSnapshot | null | undefined
	>(noteId ? undefined : null);
	const [
		isFetchingLatestTranscriptSession,
		setIsFetchingLatestTranscriptSession,
	] = React.useState(false);
	const latestTranscriptSessionRequestIdRef = React.useRef(0);
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
			setIsFetchingLatestTranscriptSession(false);
			setLatestTranscriptSession(null);
			return null;
		}

		setIsFetchingLatestTranscriptSession(true);

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
					setLatestTranscriptSession(nextValue);
					setIsFetchingLatestTranscriptSession(false);
				});
			}

			return nextValue;
		} catch (error) {
			if (latestTranscriptSessionRequestIdRef.current === requestId) {
				setIsFetchingLatestTranscriptSession(false);
			}
			throw error;
		}
	}, [convex, noteId]);

	// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state
	React.useEffect(() => {
		latestTranscriptSessionRequestIdRef.current += 1;
		// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
		setIsFetchingLatestTranscriptSession(false);
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setLatestTranscriptSession(noteId ? undefined : null);
	}, [noteId]);

	// react-doctor-disable-next-line react-doctor/no-chain-state-updates, react-doctor/no-derived-state
	React.useEffect(() => {
		if (
			!shouldAutoLoadLatestTranscriptSession ||
			!noteId ||
			latestTranscriptSessionSummaryQuery === undefined
		) {
			return;
		}

		if (latestTranscriptSessionSummary === null) {
			// react-doctor-disable-next-line react-doctor/no-chain-state-updates, react-doctor/no-derived-state
			setLatestTranscriptSession(null);
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
			status?: "capturing" | "completed" | "failed";
		}) =>
			await completeTranscriptSessionMutation({
				sessionId,
				finalTranscript,
				status,
			}),
		[completeTranscriptSessionMutation],
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
			saveDraft,
			setSystemAudioSourceMode,
			startSession,
		],
	);
};
