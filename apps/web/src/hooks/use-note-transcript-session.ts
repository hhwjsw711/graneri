import {
	isDesktopRuntime,
	onDesktopMeetingDetectionState,
} from "@workspace/platform/desktop";
import * as React from "react";
import { useNoteTranscriptScope } from "@/hooks/use-note-transcript-scope";
import { useStickyScrollToBottom } from "@/hooks/use-sticky-scroll-to-bottom";
import {
	createStoredTranscriptText,
	createVisibleTranscriptView,
	sortTranscriptUtterances,
} from "@/lib/note-transcript-session-view";
import {
	createEmptyLiveTranscriptState,
	createLiveTranscriptEntries,
	createSystemAudioCaptureStatus,
	createTranscriptRecoveryStatus,
	type LiveTranscriptState,
	type TranscriptUtterance,
} from "@/lib/transcript";
import { createTranscriptText } from "@/lib/transcript-session";
import { transcriptionSessionManager } from "@/lib/transcription-session-manager";
import type { Id } from "../../../../convex/_generated/dataModel";

const granolaIdleStopMs = 15 * 60 * 1000;
const granolaIdleCheckIntervalMs = 15 * 1000;

type UseNoteTranscriptSessionArgs = {
	autoStartTranscription?: boolean;
	noteId: Id<"notes"> | null;
	onAutoStartTranscriptionHandled?: () => void;
	onEnhanceTranscript?: (transcript: string) => Promise<void>;
	shouldLoadStoredTranscriptHistory?: boolean;
	stopTranscriptionWhenMeetingEnds?: boolean;
	transcriptionLanguage?: string | null;
};

export const useNoteTranscriptSession = ({
	autoStartTranscription,
	noteId,
	onAutoStartTranscriptionHandled,
	onEnhanceTranscript,
	shouldLoadStoredTranscriptHistory = false,
	stopTranscriptionWhenMeetingEnds,
	transcriptionLanguage,
}: UseNoteTranscriptSessionArgs) => {
	const [transcriptUtterances, setTranscriptUtterances] = React.useState<
		TranscriptUtterance[]
	>([]);
	const [pendingGenerateTranscript, setPendingGenerateTranscript] =
		React.useState("");
	const [isTranscriptDraftReady, setIsTranscriptDraftReady] =
		React.useState(false);
	const [activeTranscriptSessionId, setActiveTranscriptSessionId] =
		React.useState<Id<"transcriptSessions"> | null>(null);
	const [isGeneratingNotes, setIsGeneratingNotes] = React.useState(false);
	const [generatedTranscriptSessionId, setGeneratedTranscriptSessionId] =
		React.useState<Id<"transcriptSessions"> | null>(null);
	const [pendingAutoStartKey, setPendingAutoStartKey] = React.useState<
		string | null
	>(null);
	const {
		containerRef: transcriptViewportRef,
		isAtBottom: isTranscriptViewportAtBottom,
		scrollToBottom: scrollTranscriptToBottom,
	} = useStickyScrollToBottom();
	const previousSpeechListeningRef = React.useRef(false);
	const lastQueuedAutoStartKeyRef = React.useRef<string | null>(null);
	const hasHandledAutoStartRef = React.useRef(false);
	const shouldStopWhenMeetingEndsRef = React.useRef(false);
	const hasSeenMeetingSignalRef = React.useRef(false);
	const hasRequestedAutomaticStopRef = React.useRef(false);
	const hasRestoredTranscriptDraftRef = React.useRef(false);
	const hasHydratedStoredTranscriptSessionRef = React.useRef(false);
	const hasLoadedTranscriptDraftContentRef = React.useRef(false);
	const loadedTranscriptDraftUpdatedAtRef = React.useRef<number | null>(null);
	const lastAudioActivityAtRef = React.useRef<number | null>(null);
	if (lastAudioActivityAtRef.current === null) {
		lastAudioActivityAtRef.current = Date.now();
	}
	const transcriptUtterancesRef = React.useRef<TranscriptUtterance[]>([]);
	const listeningStartedAtRef = React.useRef<number | null>(null);
	const transcriptSessionStartPromiseRef =
		React.useRef<Promise<Id<"transcriptSessions"> | null> | null>(null);
	const activeTranscriptSessionIdRef =
		React.useRef<Id<"transcriptSessions"> | null>(null);
	const lastCompletedTranscriptSessionIdRef =
		React.useRef<Id<"transcriptSessions"> | null>(null);
	const persistedTranscriptUtteranceIds = React.useMemo(
		() => new Set<string>(),
		[],
	);
	const queuedTranscriptUtterancesRef = React.useRef<TranscriptUtterance[]>([]);
	const sessionSystemAudioModePersistedRef =
		React.useRef<Id<"transcriptSessions"> | null>(null);
	const {
		captureScopeKey,
		captureScopeNoteId,
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		currentNoteScopeKey,
		effectiveCurrentNoteTranscriptSessionRepository,
		isCurrentNoteSpeechListening,
		isScopedTranscriptionSession,
		isSpeechListening,
		isViewingCaptureScope,
		resolvedCaptureScopeKey,
		setCaptureScopeKey,
		transcriptionSession,
	} = useNoteTranscriptScope({
		// react-doctor-disable-next-line react-doctor/no-event-handler
		noteId,
		// react-doctor-disable-next-line react-doctor/no-event-handler
		shouldLoadStoredTranscriptHistory,
	});
	const previousTranscriptDraftKeyRef = React.useRef(captureTranscriptDraftKey);
	const systemAudioStatus = isScopedTranscriptionSession
		? transcriptionSession.systemAudioStatus
		: createSystemAudioCaptureStatus();
	const recoveryStatus = isScopedTranscriptionSession
		? transcriptionSession.recoveryStatus
		: createTranscriptRecoveryStatus();
	const liveTranscript = React.useMemo<LiveTranscriptState>(
		() =>
			isScopedTranscriptionSession
				? transcriptionSession.liveTranscript
				: createEmptyLiveTranscriptState(),
		[isScopedTranscriptionSession, transcriptionSession.liveTranscript],
	);

	const orderedTranscriptUtterances = React.useMemo(
		() => sortTranscriptUtterances(transcriptUtterances),
		[transcriptUtterances],
	);

	const liveTranscriptEntries = React.useMemo(
		() => createLiveTranscriptEntries(liveTranscript),
		[liveTranscript],
	);

	const hasPendingGenerateTranscript = Boolean(
		pendingGenerateTranscript.trim(),
	);
	const captureLatestTranscriptSession =
		captureTranscriptSessionRepository.latestTranscriptSession;
	const captureLatestTranscriptSessionSummary =
		captureTranscriptSessionRepository.latestTranscriptSessionSummary;
	const currentNoteLatestTranscriptSession =
		effectiveCurrentNoteTranscriptSessionRepository.latestTranscriptSession;
	const currentNoteLatestTranscriptSessionSummary =
		effectiveCurrentNoteTranscriptSessionRepository.latestTranscriptSessionSummary;
	const latestTranscriptSessionSummary = isViewingCaptureScope
		? captureLatestTranscriptSessionSummary
		: currentNoteLatestTranscriptSessionSummary;
	const currentNoteStoredTranscript = React.useMemo(
		() =>
			createStoredTranscriptText({
				session: currentNoteLatestTranscriptSession,
				summary: currentNoteLatestTranscriptSessionSummary,
			}),
		[
			currentNoteLatestTranscriptSession,
			currentNoteLatestTranscriptSessionSummary,
		],
	);
	const {
		visibleDisplayTranscriptEntries,
		visibleExportTranscript,
		visibleFullTranscript,
		visibleLiveTranscriptEntries,
		visibleOrderedTranscriptUtterances,
		visibleTranscriptStartedAt,
	} = React.useMemo(
		() =>
			createVisibleTranscriptView({
				currentNoteLatestTranscriptSession,
				isViewingCaptureScope,
				listeningStartedAt: listeningStartedAtRef.current,
				liveTranscript,
				orderedTranscriptUtterances,
			}),
		[
			currentNoteLatestTranscriptSession,
			isViewingCaptureScope,
			liveTranscript,
			orderedTranscriptUtterances,
		],
	);
	const isTranscriptSessionReady = isViewingCaptureScope
		? previousTranscriptDraftKeyRef.current === captureTranscriptDraftKey &&
			isTranscriptDraftReady &&
			!captureTranscriptSessionRepository.isLatestTranscriptSessionSummaryLoading
		: !effectiveCurrentNoteTranscriptSessionRepository.isLatestTranscriptSessionSummaryLoading;
	const isStoredTranscriptLoading = isViewingCaptureScope
		? captureTranscriptSessionRepository.isLatestTranscriptSessionLoading
		: effectiveCurrentNoteTranscriptSessionRepository.isLatestTranscriptSessionLoading;
	const hasGeneratedLatestTranscript = Boolean(
		latestTranscriptSessionSummary?.generatedNoteAt ||
			(latestTranscriptSessionSummary &&
				latestTranscriptSessionSummary.sessionId ===
					generatedTranscriptSessionId),
	);
	const captureStoredTranscript =
		captureLatestTranscriptSession?.finalTranscript?.trim() ||
		captureLatestTranscriptSessionSummary?.finalTranscript?.trim() ||
		"";
	const visibleHasPendingGenerateTranscript = isViewingCaptureScope
		? hasPendingGenerateTranscript || Boolean(captureStoredTranscript)
		: Boolean(currentNoteStoredTranscript.trim());

	React.useEffect(() => {
		if (isSpeechListening) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-chain-state-updates, react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
		setCaptureScopeKey((currentScopeKey) =>
			currentScopeKey === resolvedCaptureScopeKey
				? currentScopeKey
				: resolvedCaptureScopeKey,
		);
	}, [isSpeechListening, resolvedCaptureScopeKey, setCaptureScopeKey]);

	React.useEffect(() => {
		if (
			!autoStartTranscription ||
			!noteId ||
			transcriptionLanguage === undefined
		) {
			lastQueuedAutoStartKeyRef.current = null;
			// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
			setPendingAutoStartKey(null);
			return;
		}

		const nextAutoStartKey = `${noteId}:capture`;

		if (lastQueuedAutoStartKeyRef.current === nextAutoStartKey) {
			return;
		}

		lastQueuedAutoStartKeyRef.current = nextAutoStartKey;
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setPendingAutoStartKey(nextAutoStartKey);
	}, [autoStartTranscription, noteId, transcriptionLanguage]);

	React.useEffect(() => {
		if (!pendingAutoStartKey) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setPendingAutoStartKey((currentValue) =>
				currentValue === pendingAutoStartKey ? null : currentValue,
			);
		}, 0);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [pendingAutoStartKey]);

	React.useEffect(() => {
		// Latch meeting-controlled auto-stop for the active capture even after
		// the route/query state is cleaned up post-start.
		// react-doctor-disable-next-line react-doctor/no-event-handler
		if (stopTranscriptionWhenMeetingEnds && isDesktopRuntime()) {
			// react-doctor-disable-next-line react-doctor/no-event-handler
			shouldStopWhenMeetingEndsRef.current = true;
		}
	}, [stopTranscriptionWhenMeetingEnds]);

	React.useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		return onDesktopMeetingDetectionState((state) => {
			if (state.hasMeetingSignal) {
				hasSeenMeetingSignalRef.current = true;
				shouldStopWhenMeetingEndsRef.current = true;
				return;
			}

			if (
				!shouldStopWhenMeetingEndsRef.current ||
				!hasSeenMeetingSignalRef.current ||
				!isSpeechListening ||
				hasRequestedAutomaticStopRef.current ||
				state.hasMeetingSignal
			) {
				return;
			}

			shouldStopWhenMeetingEndsRef.current = false;
			hasRequestedAutomaticStopRef.current = true;
			void transcriptionSessionManager.controller.stop();
		});
	}, [isSpeechListening]);

	React.useEffect(() => {
		activeTranscriptSessionIdRef.current = activeTranscriptSessionId;
	}, [activeTranscriptSessionId]);

	React.useEffect(() => {
		transcriptUtterancesRef.current = transcriptUtterances;
	}, [transcriptUtterances]);

	const resetTranscriptSessionState = React.useCallback(
		({ clearDraft = false }: { clearDraft?: boolean } = {}) => {
			setTranscriptUtterances([]);
			setPendingGenerateTranscript("");
			setIsTranscriptDraftReady(false);
			setActiveTranscriptSessionId(null);
			listeningStartedAtRef.current = null;
			hasRestoredTranscriptDraftRef.current = false;
			hasHydratedStoredTranscriptSessionRef.current = false;
			hasLoadedTranscriptDraftContentRef.current = false;
			previousSpeechListeningRef.current = false;
			transcriptSessionStartPromiseRef.current = null;
			activeTranscriptSessionIdRef.current = null;
			lastCompletedTranscriptSessionIdRef.current = null;
			sessionSystemAudioModePersistedRef.current = null;
			persistedTranscriptUtteranceIds.clear();
			queuedTranscriptUtterancesRef.current = [];

			if (clearDraft) {
				void captureTranscriptSessionRepository.clearDraft(
					captureTranscriptDraftKey,
				);
			}
		},
		[
			captureTranscriptDraftKey,
			captureTranscriptSessionRepository,
			persistedTranscriptUtteranceIds,
		],
	);

	const restoreTranscriptDraft = React.useCallback(
		(draft: {
			pendingGenerateTranscript: string;
			updatedAt: number;
			utterances: TranscriptUtterance[];
		}) => {
			hasLoadedTranscriptDraftContentRef.current = true;
			loadedTranscriptDraftUpdatedAtRef.current = draft.updatedAt;
			persistedTranscriptUtteranceIds.clear();
			for (const utterance of draft.utterances) {
				persistedTranscriptUtteranceIds.add(utterance.id);
			}
			setTranscriptUtterances(draft.utterances);
			setPendingGenerateTranscript(
				draft.pendingGenerateTranscript.trim() ||
					createTranscriptText(draft.utterances),
			);
		},
		[persistedTranscriptUtteranceIds],
	);

	const hydrateStoredTranscriptSession = React.useCallback(
		({
			generatedSessionId,
			latestServerTranscript,
			latestSession,
		}: {
			generatedSessionId: Id<"transcriptSessions"> | null;
			latestServerTranscript: string;
			latestSession: {
				generatedNoteAt?: number | null;
				sessionId: Id<"transcriptSessions">;
				utterances: TranscriptUtterance[];
			};
		}) => {
			hasHydratedStoredTranscriptSessionRef.current = true;
			activeTranscriptSessionIdRef.current = null;
			lastCompletedTranscriptSessionIdRef.current = latestSession.sessionId;
			setActiveTranscriptSessionId(null);
			persistedTranscriptUtteranceIds.clear();
			for (const utterance of latestSession.utterances) {
				persistedTranscriptUtteranceIds.add(utterance.id);
			}
			setTranscriptUtterances(latestSession.utterances);
			setPendingGenerateTranscript(
				latestSession.generatedNoteAt ||
					latestSession.sessionId === generatedSessionId
					? ""
					: latestServerTranscript,
			);
		},
		[persistedTranscriptUtteranceIds],
	);

	const markSpeechListeningStarted = React.useCallback(() => {
		listeningStartedAtRef.current = Date.now();
		setPendingGenerateTranscript("");
		hasRequestedAutomaticStopRef.current = false;
		lastAudioActivityAtRef.current = Date.now();
	}, []);

	const markSpeechListeningStopped = React.useCallback(() => {
		shouldStopWhenMeetingEndsRef.current = false;
		hasSeenMeetingSignalRef.current = false;
		hasRequestedAutomaticStopRef.current = false;
		const completedTranscript = createTranscriptText(
			transcriptUtterancesRef.current,
		);
		if (completedTranscript) {
			setPendingGenerateTranscript(completedTranscript);
		}

		const completedSessionId = activeTranscriptSessionIdRef.current;
		lastCompletedTranscriptSessionIdRef.current = completedSessionId;
		activeTranscriptSessionIdRef.current = null;
		setActiveTranscriptSessionId(null);
		sessionSystemAudioModePersistedRef.current = null;
		return completedSessionId;
	}, []);

	const persistTranscriptUtterance = React.useCallback(
		async (
			sessionId: Id<"transcriptSessions">,
			utterance: TranscriptUtterance,
			source: "live" | "refined",
		) => {
			if (persistedTranscriptUtteranceIds.has(utterance.id)) {
				return;
			}

			await captureTranscriptSessionRepository.appendUtterance({
				sessionId,
				source,
				utterance,
			});
			persistedTranscriptUtteranceIds.add(utterance.id);
		},
		[captureTranscriptSessionRepository, persistedTranscriptUtteranceIds],
	);

	const flushQueuedTranscriptUtterances = React.useCallback(
		async (sessionId: Id<"transcriptSessions">) => {
			const queuedUtterances = [...queuedTranscriptUtterancesRef.current];
			queuedTranscriptUtterancesRef.current = [];

			await Promise.all(
				queuedUtterances.map((utterance) =>
					persistTranscriptUtterance(sessionId, utterance, "live"),
				),
			);
		},
		[persistTranscriptUtterance],
	);

	const ensureTranscriptSession = React.useCallback(async () => {
		if (!captureScopeNoteId) {
			return null;
		}

		if (activeTranscriptSessionIdRef.current) {
			return activeTranscriptSessionIdRef.current;
		}

		if (transcriptSessionStartPromiseRef.current) {
			return await transcriptSessionStartPromiseRef.current;
		}

		persistedTranscriptUtteranceIds.clear();
		const nextSessionPromise = captureTranscriptSessionRepository
			.startSession({
				noteId: captureScopeNoteId,
				systemAudioSourceMode:
					systemAudioStatus.state === "connected"
						? systemAudioStatus.sourceMode
						: undefined,
			})
			.then(async (sessionId) => {
				activeTranscriptSessionIdRef.current = sessionId;
				lastCompletedTranscriptSessionIdRef.current = null;
				sessionSystemAudioModePersistedRef.current =
					systemAudioStatus.state === "connected" ? sessionId : null;
				setActiveTranscriptSessionId(sessionId);
				await flushQueuedTranscriptUtterances(sessionId);
				return sessionId;
			})
			.catch((error) => {
				console.error("Failed to start transcript session", error);
				return null;
			})
			.finally(() => {
				transcriptSessionStartPromiseRef.current = null;
			});

		transcriptSessionStartPromiseRef.current = nextSessionPromise;
		return await nextSessionPromise;
	}, [
		captureScopeNoteId,
		flushQueuedTranscriptUtterances,
		systemAudioStatus.sourceMode,
		systemAudioStatus.state,
		captureTranscriptSessionRepository,
		persistedTranscriptUtteranceIds,
	]);

	React.useEffect(() => {
		if (previousTranscriptDraftKeyRef.current === captureTranscriptDraftKey) {
			return;
		}

		const activeSessionId = activeTranscriptSessionIdRef.current;

		if (activeSessionId) {
			void captureTranscriptSessionRepository
				.completeSession({
					sessionId: activeSessionId,
				})
				.catch((error) => {
					console.error(
						"Failed to complete transcript session while switching notes",
						error,
					);
				});
		}

		previousTranscriptDraftKeyRef.current = captureTranscriptDraftKey;
		// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates, react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
		setGeneratedTranscriptSessionId(null);
		// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates, react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent
		resetTranscriptSessionState();
	}, [
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		resetTranscriptSessionState,
	]);

	React.useEffect(() => {
		let isCancelled = false;
		hasRestoredTranscriptDraftRef.current = false;
		hasLoadedTranscriptDraftContentRef.current = false;
		loadedTranscriptDraftUpdatedAtRef.current = null;
		// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state
		setIsTranscriptDraftReady(false);
		void captureTranscriptSessionRepository
			.loadDraft(captureTranscriptDraftKey)
			.then((draft) => {
				if (isCancelled || !draft) {
					return;
				}

				restoreTranscriptDraft(draft);
			})
			.finally(() => {
				if (!isCancelled) {
					hasRestoredTranscriptDraftRef.current = true;
					setIsTranscriptDraftReady(true);
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository.loadDraft,
		restoreTranscriptDraft,
	]);

	React.useEffect(() => {
		const latestSession = captureLatestTranscriptSession;
		const latestSessionSummary = captureLatestTranscriptSessionSummary;
		const latestServerTranscript = latestSession
			? createTranscriptText(latestSession.utterances) ||
				latestSession.finalTranscript
			: (latestSessionSummary?.finalTranscript ?? "");
		const latestSessionUpdatedAt =
			latestSessionSummary?.updatedAt ?? latestSession?.updatedAt ?? null;
		const hasNewerServerSnapshot =
			loadedTranscriptDraftUpdatedAtRef.current !== null &&
			latestSessionUpdatedAt !== null &&
			latestSessionUpdatedAt > loadedTranscriptDraftUpdatedAtRef.current;
		const hasMoreServerUtterances =
			latestSession != null &&
			latestSession.utterances.length > transcriptUtterances.length;
		const hasLongerServerTranscript =
			latestServerTranscript.length > pendingGenerateTranscript.trim().length;
		const shouldHydrateFromServer =
			!hasHydratedStoredTranscriptSessionRef.current &&
			activeTranscriptSessionIdRef.current === null &&
			transcriptSessionStartPromiseRef.current === null &&
			!previousSpeechListeningRef.current &&
			!isSpeechListening &&
			latestSession != null &&
			(!hasLoadedTranscriptDraftContentRef.current ||
				latestSessionSummary?.generatedNoteAt !== null ||
				hasNewerServerSnapshot ||
				hasMoreServerUtterances ||
				hasLongerServerTranscript);

		if (!isTranscriptDraftReady || !shouldHydrateFromServer || !latestSession) {
			return;
		}

		// react-doctor-disable-next-line react-doctor/no-derived-state
		hydrateStoredTranscriptSession({
			generatedSessionId: generatedTranscriptSessionId,
			latestServerTranscript,
			latestSession,
		});
		if (hasLoadedTranscriptDraftContentRef.current) {
			void captureTranscriptSessionRepository.clearDraft(
				captureTranscriptDraftKey,
			);
			hasLoadedTranscriptDraftContentRef.current = false;
			loadedTranscriptDraftUpdatedAtRef.current = null;
		}
	}, [
		captureLatestTranscriptSession,
		captureLatestTranscriptSessionSummary,
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		generatedTranscriptSessionId,
		hydrateStoredTranscriptSession,
		isSpeechListening,
		isTranscriptDraftReady,
		pendingGenerateTranscript,
		transcriptUtterances.length,
	]);

	React.useEffect(() => {
		if (!hasRestoredTranscriptDraftRef.current || !isTranscriptDraftReady) {
			return;
		}

		void captureTranscriptSessionRepository.saveDraft({
			noteKey: captureTranscriptDraftKey,
			utterances: transcriptUtterances,
			liveTranscript,
			pendingGenerateTranscript,
		});
	}, [
		isTranscriptDraftReady,
		liveTranscript,
		pendingGenerateTranscript,
		captureTranscriptDraftKey,
		transcriptUtterances,
		captureTranscriptSessionRepository,
	]);

	React.useEffect(() => {
		if (!isSpeechListening) {
			return;
		}

		void ensureTranscriptSession();
	}, [ensureTranscriptSession, isSpeechListening]);

	React.useEffect(() => {
		if (isSpeechListening && !previousSpeechListeningRef.current) {
			// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates, react-doctor/no-derived-state
			markSpeechListeningStarted();
		}

		if (!isSpeechListening && previousSpeechListeningRef.current) {
			// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates, react-doctor/no-derived-state
			const completedSessionId = markSpeechListeningStopped();

			if (completedSessionId) {
				void captureTranscriptSessionRepository
					.completeSession({
						sessionId: completedSessionId,
					})
					.catch((error) => {
						console.error("Failed to complete transcript session", error);
					});
			}
		}

		previousSpeechListeningRef.current = isSpeechListening;
	}, [
		captureTranscriptSessionRepository,
		isSpeechListening,
		markSpeechListeningStarted,
		markSpeechListeningStopped,
	]);

	React.useEffect(() => {
		if (liveTranscriptEntries.some((entry) => entry.text.trim().length > 0)) {
			lastAudioActivityAtRef.current = Date.now();
		}
	}, [liveTranscriptEntries]);

	React.useEffect(() => {
		if (!isSpeechListening) {
			return;
		}

		const intervalId = window.setInterval(() => {
			if (
				hasRequestedAutomaticStopRef.current ||
				Date.now() - lastAudioActivityAtRef.current < granolaIdleStopMs
			) {
				return;
			}

			shouldStopWhenMeetingEndsRef.current = false;
			hasSeenMeetingSignalRef.current = false;
			hasRequestedAutomaticStopRef.current = true;
			void transcriptionSessionManager.controller.stop();
		}, granolaIdleCheckIntervalMs);

		return () => window.clearInterval(intervalId);
	}, [isSpeechListening]);

	React.useEffect(() => {
		const sessionId = activeTranscriptSessionIdRef.current;

		if (
			!sessionId ||
			systemAudioStatus.state !== "connected" ||
			sessionSystemAudioModePersistedRef.current === sessionId
		) {
			return;
		}

		sessionSystemAudioModePersistedRef.current = sessionId;
		void captureTranscriptSessionRepository
			.setSystemAudioSourceMode({
				sessionId,
				systemAudioSourceMode: systemAudioStatus.sourceMode,
			})
			.catch((error) => {
				sessionSystemAudioModePersistedRef.current = null;
				console.error(
					"Failed to persist transcript session system audio",
					error,
				);
			});
	}, [
		captureTranscriptSessionRepository,
		systemAudioStatus.sourceMode,
		systemAudioStatus.state,
	]);

	React.useEffect(() => {
		if (!autoStartTranscription) {
			hasHandledAutoStartRef.current = false;
			return;
		}

		if (!isSpeechListening || hasHandledAutoStartRef.current) {
			return;
		}

		hasHandledAutoStartRef.current = true;
		onAutoStartTranscriptionHandled?.();
	}, [
		autoStartTranscription,
		isSpeechListening,
		onAutoStartTranscriptionHandled,
	]);

	const handleGenerateNotes = React.useCallback(() => {
		const transcript = isViewingCaptureScope
			? pendingGenerateTranscript.trim() ||
				createTranscriptText(transcriptUtterancesRef.current) ||
				captureStoredTranscript
			: currentNoteStoredTranscript.trim();

		if (!transcript || isGeneratingNotes || !onEnhanceTranscript) {
			return;
		}

		const targetTranscriptSessionRepository = isViewingCaptureScope
			? captureTranscriptSessionRepository
			: effectiveCurrentNoteTranscriptSessionRepository;
		const targetTranscriptDraftKey = isViewingCaptureScope
			? captureTranscriptDraftKey
			: currentNoteScopeKey;
		const targetSessionId = isViewingCaptureScope
			? (lastCompletedTranscriptSessionIdRef.current ??
				activeTranscriptSessionIdRef.current)
			: (currentNoteLatestTranscriptSessionSummary?.sessionId ??
				currentNoteLatestTranscriptSession?.sessionId ??
				null);

		setIsGeneratingNotes(true);
		void (async () => {
			try {
				await onEnhanceTranscript(transcript);

				if (targetSessionId) {
					await targetTranscriptSessionRepository.markGenerated({
						sessionId: targetSessionId,
					});
					if (isViewingCaptureScope) {
						setGeneratedTranscriptSessionId(targetSessionId);
						lastCompletedTranscriptSessionIdRef.current = targetSessionId;
					}
				}

				await targetTranscriptSessionRepository.clearDraft(
					targetTranscriptDraftKey,
				);
				if (isViewingCaptureScope) {
					setPendingGenerateTranscript("");
					setActiveTranscriptSessionId(null);
					activeTranscriptSessionIdRef.current = null;
					transcriptSessionStartPromiseRef.current = null;
					sessionSystemAudioModePersistedRef.current = null;
				}
			} catch (error) {
				console.error("Failed to generate notes from transcript", error);
			} finally {
				setIsGeneratingNotes(false);
			}
		})();
	}, [
		captureTranscriptDraftKey,
		captureTranscriptSessionRepository,
		captureStoredTranscript,
		currentNoteLatestTranscriptSession,
		currentNoteLatestTranscriptSessionSummary,
		currentNoteScopeKey,
		currentNoteStoredTranscript,
		effectiveCurrentNoteTranscriptSessionRepository,
		isViewingCaptureScope,
		isGeneratingNotes,
		onEnhanceTranscript,
		pendingGenerateTranscript,
	]);

	const handleTranscriptUtterance = React.useCallback(
		(utterance: TranscriptUtterance) => {
			const currentUtterances = transcriptUtterancesRef.current;
			lastAudioActivityAtRef.current = Date.now();
			const nextUtterances = [...currentUtterances, utterance];
			const nextTranscript = createTranscriptText(nextUtterances);
			transcriptUtterancesRef.current = nextUtterances;
			setTranscriptUtterances(nextUtterances);
			setPendingGenerateTranscript(nextTranscript);

			const activeSessionId = activeTranscriptSessionIdRef.current;
			if (activeSessionId) {
				void persistTranscriptUtterance(
					activeSessionId,
					utterance,
					"live",
				).catch((error) => {
					console.error("Failed to persist transcript utterance", error);
				});
				return;
			}

			queuedTranscriptUtterancesRef.current.push(utterance);
		},
		[persistTranscriptUtterance],
	);

	React.useEffect(() => {
		return transcriptionSessionManager.store.subscribeToEvents((event) => {
			if (
				transcriptionSessionManager.store.getSnapshot().scopeKey !==
				captureScopeKey
			) {
				return;
			}

			if (event.type === "session.utterance_committed") {
				handleTranscriptUtterance(event.utterance);
			}
		});
	}, [captureScopeKey, handleTranscriptUtterance]);

	return {
		activeTranscriptSessionId,
		autoStartKey: pendingAutoStartKey,
		captureScopeKey,
		currentNoteScopeKey: resolvedCaptureScopeKey,
		exportTranscript: visibleExportTranscript,
		fullTranscript: visibleFullTranscript,
		handleGenerateNotes,
		hasGeneratedLatestTranscript,
		hasPendingGenerateTranscript: visibleHasPendingGenerateTranscript,
		isCurrentNoteSpeechListening,
		isStoredTranscriptLoading,
		isTranscriptSessionReady,
		isGeneratingNotes,
		isSpeechListening,
		displayTranscriptEntries: visibleDisplayTranscriptEntries,
		liveTranscriptEntries: visibleLiveTranscriptEntries,
		orderedTranscriptUtterances: visibleOrderedTranscriptUtterances,
		recoveryStatus: isViewingCaptureScope
			? recoveryStatus
			: createTranscriptRecoveryStatus(),
		scrollTranscriptToBottom,
		systemAudioStatus: isViewingCaptureScope
			? systemAudioStatus
			: createSystemAudioCaptureStatus(),
		isTranscriptViewportAtBottom: isViewingCaptureScope
			? isTranscriptViewportAtBottom
			: true,
		transcriptStartedAt: visibleTranscriptStartedAt,
		transcriptViewportRef,
	};
};
