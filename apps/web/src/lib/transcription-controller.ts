import { createBrowserSystemAudioStream } from "@/lib/capture/browser-system-audio";
import { createDesktopSystemAudioStream } from "@/lib/capture/desktop-system-audio";
import { createMicrophoneInputStream } from "@/lib/capture/microphone-input";
import {
	connectRealtimeTranscriptionTransport,
	type RealtimeTranscriptionSource,
	type RealtimeTranscriptionTransport,
	type RealtimeTranscriptionTransportEvent,
} from "@/lib/capture/realtime-transcription-transport";
import {
	createEmptyLiveTranscriptState,
	createSystemAudioCaptureStatus,
	createTranscriptRecoveryStatus,
	type LiveTranscriptState,
	type SystemAudioCaptureSourceMode,
	type TranscriptSpeaker,
	type TranscriptUtterance,
} from "@/lib/transcript";
import { createTranscriptionLogger } from "@/lib/transcription-logger";
import { TranscriptionSessionStore } from "@/lib/transcription-session-store";
import {
	createInitialTranscriptionControllerState,
	type TranscriptionControllerError,
	type TranscriptionControllerState,
} from "@/lib/transcription-session-types";

export type { TranscriptionControllerState } from "@/lib/transcription-session-types";

import {
	createSystemAudioStatusFromPolicy,
	ensureDesktopMicrophonePermission,
	getRealtimeAvailability,
	resolveTranscriptionPolicy,
	type TranscriptionPolicy,
} from "@/lib/transcription-policy";
import {
	isTranscriptPlaceholderText,
	shouldKeepInterruptedTranscriptTurn,
} from "../../../../packages/ai/src/transcription.mjs";

type TranscriptTurnState = {
	itemId: string;
	endedAt: number | null;
	failed: boolean;
	logprobs?: Array<{
		bytes?: number[];
		logprob?: number;
		token?: string;
	}> | null;
	previousItemId: string | null;
	startedAt: number | null;
	text: string;
	completed: boolean;
	committed: boolean;
};

type SpeakerRuntimeState = {
	data: {
		dispose: (() => void | Promise<void>) | null;
		disconnectReason: string | null;
		emittedItemIds: Set<string>;
		lastCommittedItemId: string | null;
		liveItemId: string | null;
		sessionId: string | null;
		stream: MediaStream | null;
		transport: RealtimeTranscriptionTransport | null;
		turns: Map<string, TranscriptTurnState>;
	};
	speaker: TranscriptSpeaker;
};

export type TranscriptionControllerOptions = {
	autoStartKey?: string | number | null;
	lang?: string;
	scopeKey?: string | null;
};

type PendingInputStream = {
	dispose?: () => void | Promise<void>;
	source: RealtimeTranscriptionSource;
	sourceMode: SystemAudioCaptureSourceMode;
	speaker: TranscriptSpeaker;
	stream: MediaStream;
};

type TranscriptionControllerConfig = {
	autoStartKey: string | number | null;
	lang?: string;
	scopeKey: string | null;
};

export type TranscriptionControllerDependencies = {
	connectTransport: typeof connectRealtimeTranscriptionTransport;
	createBrowserSystemAudioStream: typeof createBrowserSystemAudioStream;
	createDesktopSystemAudioStream: typeof createDesktopSystemAudioStream;
	createMicrophoneInputStream: typeof createMicrophoneInputStream;
	ensureMicrophonePermission: typeof ensureDesktopMicrophonePermission;
	getRealtimeAvailability: typeof getRealtimeAvailability;
	resolvePolicy: typeof resolveTranscriptionPolicy;
	scheduleTimeout: typeof window.setTimeout;
	clearScheduledTimeout: typeof window.clearTimeout;
	store: TranscriptionSessionStore;
};

const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_BACKOFF_MS = [750, 1_500, 3_000] as const;
const REALTIME_SESSION_ROLLOVER_MS = 29 * 60 * 1000;

const createSpeakerRuntimeState = (
	speaker: TranscriptSpeaker,
): SpeakerRuntimeState => ({
	speaker,
	data: {
		dispose: null,
		disconnectReason: null,
		emittedItemIds: new Set(),
		lastCommittedItemId: null,
		liveItemId: null,
		sessionId: null,
		stream: null,
		transport: null,
		turns: new Map(),
	},
});

const stopStreamTracks = (stream: MediaStream | null) => {
	if (!stream) {
		return;
	}

	for (const track of stream.getTracks()) {
		track.stop();
	}
};

const disposePendingInputStream = async ({
	dispose,
	stream,
}: PendingInputStream) => {
	stopStreamTracks(stream);
	await dispose?.();
};

const isNonRecoverableStartError = (error: unknown) => {
	if (
		error &&
		typeof error === "object" &&
		"name" in error &&
		typeof error.name === "string" &&
		[
			"AbortError",
			"NotAllowedError",
			"NotFoundError",
			"NotReadableError",
			"PermissionDeniedError",
			"SecurityError",
		].includes(error.name)
	) {
		return true;
	}

	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();

	return (
		message.includes("microphone access") ||
		message.includes("not configured") ||
		message.includes("permission") ||
		message.includes("system settings")
	);
};

const normalizeControllerError = (
	error: unknown,
): TranscriptionControllerError => {
	if (
		error &&
		typeof error === "object" &&
		"name" in error &&
		typeof error.name === "string"
	) {
		if (
			["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(
				error.name,
			)
		) {
			return {
				code: "permission_denied",
				message: error instanceof Error ? error.message : "Permission denied.",
			};
		}

		if (["NotFoundError", "NotReadableError"].includes(error.name)) {
			return {
				code: "device_unavailable",
				message:
					error instanceof Error
						? error.message
						: "Audio input device is unavailable.",
			};
		}
	}

	if (error instanceof Error) {
		if (error.message.toLowerCase().includes("connect")) {
			return {
				code: "connection_failed",
				message: error.message,
			};
		}

		if (isNonRecoverableStartError(error)) {
			return {
				code: "permission_denied",
				message: error.message,
			};
		}

		return {
			code: "configuration_failed",
			message: error.message,
		};
	}

	return {
		code: "unknown",
		message: "Failed to start live transcription.",
	};
};

export class TranscriptionController {
	private readonly dependencies: TranscriptionControllerDependencies;

	private readonly speakers: Record<TranscriptSpeaker, SpeakerRuntimeState> = {
		you: createSpeakerRuntimeState("you"),
		them: createSpeakerRuntimeState("them"),
	};

	private activePolicy: TranscriptionPolicy | null = null;

	private config: TranscriptionControllerConfig = {
		autoStartKey: null,
		lang: undefined,
		scopeKey: null,
	};

	private recoveryAttempt = 0;

	private reconnectTimeoutId: number | null = null;

	private rolloverTimeoutId: number | null = null;

	private shouldRestoreSystemAudioOnReconnect = false;

	private lastHandledAutoStartKey: string | number | null = null;

	private lifecycleOperationId = 0;

	private pendingStartPromise: Promise<boolean> | null = null;

	private pendingStopPromise: Promise<void> | null = null;

	private currentSessionCorrelationId: string | null = null;

	constructor(dependencies: Partial<TranscriptionControllerDependencies> = {}) {
		this.dependencies = {
			connectTransport: connectRealtimeTranscriptionTransport,
			createBrowserSystemAudioStream,
			createDesktopSystemAudioStream,
			createMicrophoneInputStream,
			ensureMicrophonePermission: ensureDesktopMicrophonePermission,
			getRealtimeAvailability,
			resolvePolicy: resolveTranscriptionPolicy,
			scheduleTimeout: globalThis.setTimeout.bind(globalThis),
			clearScheduledTimeout: globalThis.clearTimeout.bind(globalThis),
			store: new TranscriptionSessionStore(),
			...dependencies,
		};

		this.dependencies.store.dispatch({
			type: "session.state_patch",
			patch: {
				...createInitialTranscriptionControllerState(),
				isAvailable: this.dependencies.getRealtimeAvailability(),
			},
		});
	}

	subscribe = (listener: (state: TranscriptionControllerState) => void) =>
		this.dependencies.store.subscribe(listener);

	subscribeToEvents = (
		listener: Parameters<TranscriptionSessionStore["subscribeToEvents"]>[0],
	) => this.dependencies.store.subscribeToEvents(listener);

	getSnapshot = () => this.dependencies.store.getSnapshot();

	private getState = () => this.dependencies.store.getSnapshot();

	private patchState = (patch: Partial<TranscriptionControllerState>) => {
		this.dependencies.store.dispatch({
			type: "session.state_patch",
			patch,
		});
	};

	configure = ({
		autoStartKey = null,
		lang,
		scopeKey = null,
	}: TranscriptionControllerOptions) => {
		const previousScopeKey = this.config.scopeKey;
		this.config = {
			autoStartKey,
			lang,
			scopeKey,
		};

		this.patchState({
			autoStartKey,
			isAvailable: this.dependencies.getRealtimeAvailability(),
			scopeKey,
		});

		void this.refreshPolicy();

		if (previousScopeKey !== scopeKey) {
			this.lastHandledAutoStartKey = null;
			void this.stop({
				preserveUtterances: false,
				reason: "configure-scope-changed",
				resetError: true,
				resetRecovery: true,
			});
		}

		if (autoStartKey == null) {
			return;
		}

		this.requestAutoStart(autoStartKey);
	};

	start = async () => {
		// A new start must wait for the pending stop before observing or creating start work.
		// react-doctor-disable-next-line react-doctor/async-defer-await
		await this.pendingStopPromise;

		if (this.pendingStartPromise) {
			return await this.pendingStartPromise;
		}

		const startPromise = this.runStart({
			preserveUtterances: false,
			reason: "manual",
		}).finally(() => {
			if (this.pendingStartPromise === startPromise) {
				this.pendingStartPromise = null;
			}
		});

		this.pendingStartPromise = startPromise;
		return await startPromise;
	};

	stop = async ({
		preserveUtterances = true,
		reason: _reason,
		resetError = false,
		resetRecovery = true,
	}: {
		preserveUtterances?: boolean;
		reason?: string;
		resetError?: boolean;
		resetRecovery?: boolean;
	} = {}) => {
		if (this.pendingStopPromise) {
			return await this.pendingStopPromise;
		}

		const operationId = ++this.lifecycleOperationId;
		this.clearReconnectTimeout();
		this.clearRolloverTimeout();
		this.shouldRestoreSystemAudioOnReconnect = false;
		this.patchState({
			isConnecting: false,
			isListening: false,
			phase: "stopping",
		});

		const stopPromise = this.cleanupSession({
			operationId,
			preserveUtterances,
		})
			.finally(() => {
				if (this.pendingStopPromise === stopPromise) {
					this.pendingStopPromise = null;
				}
			})
			.then(() => {
				this.recoveryAttempt = 0;
				this.currentSessionCorrelationId = null;
				this.patchState({
					error: resetError ? null : this.getState().error,
					isConnecting: false,
					isListening: false,
					liveTranscript: createEmptyLiveTranscriptState(),
					phase: this.getState().phase === "failed" ? "failed" : "idle",
					recoveryStatus: resetRecovery
						? createTranscriptRecoveryStatus()
						: this.getState().recoveryStatus,
					systemAudioStatus: this.activePolicy
						? createSystemAudioStatusFromPolicy(this.activePolicy)
						: this.getState().systemAudioStatus,
					utterances: preserveUtterances ? this.getState().utterances : [],
				});
			});

		this.pendingStopPromise = stopPromise;
		return await stopPromise;
	};

	requestSystemAudio = async () => {
		if (this.getState().phase !== "listening") {
			return false;
		}

		return await this.attachSystemAudio({
			automatic: false,
			operationId: this.lifecycleOperationId,
		});
	};

	detachSystemAudio = async () => {
		this.shouldRestoreSystemAudioOnReconnect = false;
		await this.stopSpeaker("them");

		this.patchState({
			systemAudioStatus: this.activePolicy
				? createSystemAudioStatusFromPolicy(this.activePolicy)
				: createSystemAudioCaptureStatus(),
		});
	};

	private clearReconnectTimeout = () => {
		if (this.reconnectTimeoutId == null) {
			return;
		}

		this.dependencies.clearScheduledTimeout(this.reconnectTimeoutId);
		this.reconnectTimeoutId = null;
	};

	private clearRolloverTimeout = () => {
		if (this.rolloverTimeoutId == null) {
			return;
		}

		this.dependencies.clearScheduledTimeout(this.rolloverTimeoutId);
		this.rolloverTimeoutId = null;
	};

	private scheduleSessionRollover = () => {
		this.clearRolloverTimeout();

		this.rolloverTimeoutId = this.dependencies.scheduleTimeout(() => {
			this.rolloverTimeoutId = null;

			void this.handleTransportInterrupted({
				message: "Realtime transcription session reached the rollover window.",
				planned: true,
				speaker: "you",
			});
		}, REALTIME_SESSION_ROLLOVER_MS);
	};

	private refreshPolicy = async () => {
		const policy = await this.dependencies.resolvePolicy();
		this.activePolicy = policy;
		if (this.getState().systemAudioStatus.state === "connected") {
			return;
		}

		this.patchState({
			systemAudioStatus: createSystemAudioStatusFromPolicy(policy),
		});
	};

	private requestAutoStart = (autoStartKey: string | number) => {
		if (
			this.lastHandledAutoStartKey === autoStartKey ||
			this.getState().phase === "starting" ||
			this.getState().phase === "listening" ||
			this.getState().phase === "reconnecting"
		) {
			return;
		}

		void this.start().then((didStart) => {
			if (!didStart) {
				return;
			}

			this.lastHandledAutoStartKey = autoStartKey;
		});
	};

	private runStart = async ({
		preserveUtterances,
		reason,
	}: {
		preserveUtterances: boolean;
		reason: "manual" | "reconnect";
	}) => {
		const operationId = ++this.lifecycleOperationId;
		this.clearReconnectTimeout();
		const policy =
			this.activePolicy ?? (await this.dependencies.resolvePolicy());
		this.activePolicy = policy;
		const shouldRestoreSystemAudioOnReconnect =
			reason === "reconnect" && this.shouldRestoreSystemAudioOnReconnect;
		this.shouldRestoreSystemAudioOnReconnect = false;
		this.currentSessionCorrelationId = crypto.randomUUID();
		const logger = createTranscriptionLogger({
			scopeKey: this.config.scopeKey,
			sessionId: this.currentSessionCorrelationId,
		});
		const pendingStreams: PendingInputStream[] = [];

		this.patchState({
			error: null,
			isConnecting: true,
			isListening: false,
			liveTranscript: createEmptyLiveTranscriptState(),
			phase: reason === "reconnect" ? "reconnecting" : "starting",
			recoveryStatus:
				reason === "reconnect"
					? this.getState().recoveryStatus
					: createTranscriptRecoveryStatus(),
			systemAudioStatus: createSystemAudioStatusFromPolicy(policy),
			utterances: preserveUtterances ? this.getState().utterances : [],
		});

		try {
			logger.info("start.requested", {
				autoStartKey: this.config.autoStartKey,
				reason,
				systemAudioSourceMode: policy.systemAudioCapability.sourceMode,
			});

			await this.dependencies.ensureMicrophonePermission();

			const microphoneInputStream =
				await this.dependencies.createMicrophoneInputStream();
			const microphoneInput: PendingInputStream = {
				dispose:
					"dispose" in microphoneInputStream
						? microphoneInputStream.dispose
						: undefined,
				source: "microphone",
				sourceMode: "unsupported",
				speaker: "you",
				stream:
					"stream" in microphoneInputStream
						? microphoneInputStream.stream
						: microphoneInputStream,
			};
			pendingStreams.push(microphoneInput);

			if (!this.isCurrentOperation(operationId)) {
				await disposePendingInputStream(microphoneInput);
				return false;
			}

			// Speaker connection must settle before this operation can safely continue or bail.
			// react-doctor-disable-next-line react-doctor/async-defer-await
			await this.connectSpeaker({
				logger,
				operationId,
				pendingInput: microphoneInput,
			});

			if (!this.isCurrentOperation(operationId)) {
				return false;
			}

			this.recoveryAttempt = 0;
			this.patchState({
				error: null,
				isConnecting: false,
				isListening: true,
				phase: "listening",
				recoveryStatus: createTranscriptRecoveryStatus(),
			});
			this.scheduleSessionRollover();

			logger.info("start.succeeded", {
				reason,
			});

			if (policy.systemAudioCapability.shouldAutoBootstrap) {
				void this.attachSystemAudio({
					automatic: true,
					operationId,
				});
			} else if (shouldRestoreSystemAudioOnReconnect) {
				void this.attachSystemAudio({
					automatic: false,
					operationId,
				});
			}

			return true;
		} catch (error) {
			// Acquired streams must always be disposed before stale operations return.
			// react-doctor-disable-next-line react-doctor/async-defer-await
			await Promise.allSettled(
				pendingStreams.map((entry) => disposePendingInputStream(entry)),
			);

			if (!this.isCurrentOperation(operationId)) {
				return false;
			}

			const normalizedError = normalizeControllerError(error);
			logger.error("start.failed", {
				code: normalizedError.code,
				message: normalizedError.message,
			});

			await this.cleanupSession({
				operationId,
				preserveUtterances,
			});

			this.patchState({
				error: normalizedError,
				isConnecting: false,
				isListening: false,
				liveTranscript: createEmptyLiveTranscriptState(),
				phase: "failed",
				recoveryStatus: createTranscriptRecoveryStatus({
					attempt: this.recoveryAttempt,
					maxAttempts: MAX_RECOVERY_ATTEMPTS,
					message: normalizedError.message,
					state: "failed",
				}),
				systemAudioStatus: createSystemAudioStatusFromPolicy(policy),
				utterances: preserveUtterances ? this.getState().utterances : [],
			});

			if (normalizedError.code === "permission_denied") {
				this.dependencies.store.dispatch({
					type: "session.permission_failure",
					error: normalizedError,
				});
			}

			return false;
		}
	};

	private connectSpeaker = async ({
		logger,
		operationId,
		pendingInput,
	}: {
		logger: ReturnType<typeof createTranscriptionLogger>;
		operationId: number;
		pendingInput: PendingInputStream;
	}) => {
		const speakerState = this.speakers[pendingInput.speaker];
		const transport = await this.dependencies.connectTransport({
			lang: this.config.lang,
			logger,
			onEvent: (event) => {
				if (!this.isCurrentOperation(operationId)) {
					return;
				}

				this.handleTransportEvent(event);
			},
			onInterrupted: (message) => {
				if (!this.isCurrentOperation(operationId)) {
					return;
				}

				void this.handleTransportInterrupted({
					message,
					speaker: pendingInput.speaker,
				});
			},
			source: pendingInput.source,
			speaker: pendingInput.speaker,
			stream: pendingInput.stream,
		});

		if (!this.isCurrentOperation(operationId)) {
			await transport.close();
			await disposePendingInputStream(pendingInput);
			return;
		}

		speakerState.data.dispose = pendingInput.dispose ?? null;
		speakerState.data.sessionId ??= this.currentSessionCorrelationId;
		speakerState.data.stream = pendingInput.stream;
		speakerState.data.transport = transport;
	};

	private handleTransportEvent = (
		event: RealtimeTranscriptionTransportEvent,
	) => {
		const state = this.speakers[event.speaker].data;

		if (event.type === "transport_error") {
			void this.handleTransportInterrupted({
				message: event.message,
				speaker: event.speaker,
			});
			return;
		}

		if (event.type === "committed") {
			this.upsertTurn(event.speaker, event.itemId, {
				committed: true,
				endedAt: event.endedAt ?? null,
				previousItemId: event.previousItemId,
				...(event.startedAt == null ? {} : { startedAt: event.startedAt }),
			});
			this.emitOrderedTurns(event.speaker);
			return;
		}

		if (event.type === "partial") {
			const existingTurn = state.turns.get(event.itemId);
			const nextTurn = this.upsertTurn(event.speaker, event.itemId, {
				failed: false,
				logprobs: event.logprobs ?? existingTurn?.logprobs ?? null,
				startedAt: existingTurn?.startedAt ?? Date.now(),
				text: `${existingTurn?.text ?? ""}${event.textDelta}`,
			});

			state.liveItemId = event.itemId;
			this.updateLiveTranscript(event.speaker, {
				startedAt: nextTurn.startedAt,
				text: nextTurn.text,
			});
			return;
		}

		if (event.type === "turn_failed") {
			const existingTurn = state.turns.get(event.itemId);
			const source = event.speaker === "them" ? "systemAudio" : "microphone";
			const interruptedText =
				existingTurn?.text ||
				this.getState().liveTranscript[event.speaker].text ||
				"";
			const shouldKeepInterruptedText = shouldKeepInterruptedTranscriptTurn({
				logprobs: existingTurn?.logprobs ?? null,
				source,
				text: interruptedText,
			});
			this.upsertTurn(event.speaker, event.itemId, {
				committed: true,
				completed: shouldKeepInterruptedText,
				failed: !shouldKeepInterruptedText,
				logprobs: shouldKeepInterruptedText
					? (existingTurn?.logprobs ?? null)
					: null,
				startedAt:
					existingTurn?.startedAt ??
					this.getState().liveTranscript[event.speaker].startedAt ??
					Date.now(),
				text: shouldKeepInterruptedText ? interruptedText : "",
			});

			if (state.liveItemId === event.itemId) {
				state.liveItemId = null;
				this.clearLiveTranscript(event.speaker);
			}

			this.emitOrderedTurns(event.speaker);
			return;
		}

		const existingTurn = state.turns.get(event.itemId);
		this.upsertTurn(event.speaker, event.itemId, {
			completed: true,
			failed: false,
			logprobs: event.logprobs ?? existingTurn?.logprobs ?? null,
			startedAt:
				existingTurn?.startedAt ??
				this.getState().liveTranscript[event.speaker].startedAt ??
				Date.now(),
			text:
				event.text ||
				existingTurn?.text ||
				this.getState().liveTranscript[event.speaker].text,
		});
		this.emitOrderedTurns(event.speaker);
	};

	private upsertTurn = (
		speaker: TranscriptSpeaker,
		itemId: string,
		updates: Partial<TranscriptTurnState>,
	) => {
		const state = this.speakers[speaker].data;
		const currentValue = state.turns.get(itemId);
		const nextValue: TranscriptTurnState = {
			completed: currentValue?.completed ?? false,
			committed: currentValue?.committed ?? false,
			endedAt: currentValue?.endedAt ?? null,
			failed: currentValue?.failed ?? false,
			itemId,
			logprobs: currentValue?.logprobs ?? null,
			previousItemId: currentValue?.previousItemId ?? null,
			startedAt: currentValue?.startedAt ?? null,
			text: currentValue?.text ?? "",
			...updates,
		};

		state.turns.set(itemId, nextValue);
		return nextValue;
	};

	private updateLiveTranscript = (
		speaker: TranscriptSpeaker,
		value: Partial<LiveTranscriptState[TranscriptSpeaker]>,
	) => {
		this.patchState({
			liveTranscript: {
				...this.getState().liveTranscript,
				[speaker]: {
					...this.getState().liveTranscript[speaker],
					...value,
				},
			},
		});
	};

	private clearLiveTranscript = (speaker: TranscriptSpeaker) => {
		this.updateLiveTranscript(speaker, {
			startedAt: null,
			text: "",
		});
	};

	private appendUtterance = (utterance: TranscriptUtterance) => {
		this.dependencies.store.dispatch({
			type: "session.utterance_committed",
			utterance,
		});
	};

	private emitOrderedTurns = (speaker: TranscriptSpeaker) => {
		const state = this.speakers[speaker].data;
		const turnsByPreviousItemId = new Map(
			[...state.turns.values()].flatMap((turn) =>
				turn.committed &&
				(turn.completed || turn.failed) &&
				!state.emittedItemIds.has(turn.itemId)
					? [[turn.previousItemId, turn] as const]
					: [],
			),
		);

		for (;;) {
			const nextTurn = turnsByPreviousItemId.get(state.lastCommittedItemId);

			if (!nextTurn) {
				return;
			}

			const text = nextTurn.text.trim();
			if (!nextTurn.failed && text && !isTranscriptPlaceholderText(text)) {
				this.appendUtterance({
					endedAt: nextTurn.endedAt ?? Date.now(),
					id: `${state.sessionId ?? "session"}:${speaker}:${nextTurn.itemId}`,
					speaker,
					startedAt: nextTurn.startedAt ?? Date.now(),
					text,
				});
			}

			state.emittedItemIds.add(nextTurn.itemId);
			state.lastCommittedItemId = nextTurn.itemId;

			if (state.liveItemId === nextTurn.itemId) {
				state.liveItemId = null;
				this.clearLiveTranscript(speaker);
			}
		}
	};

	private stopSpeaker = async (speaker: TranscriptSpeaker) => {
		const state = this.speakers[speaker].data;
		const liveEntry = this.getState().liveTranscript[speaker];
		const source = speaker === "them" ? "systemAudio" : "microphone";
		const text = liveEntry.text.trim();

		if (
			shouldKeepInterruptedTranscriptTurn({
				source,
				text,
			})
		) {
			this.appendUtterance({
				endedAt: Date.now(),
				id: `${state.sessionId ?? "session"}:${speaker}:manual:${crypto.randomUUID()}`,
				speaker,
				startedAt: liveEntry.startedAt ?? Date.now(),
				text,
			});
		}

		await Promise.allSettled([state.transport?.close(), state.dispose?.()]);

		stopStreamTracks(state.stream);

		this.speakers[speaker] = createSpeakerRuntimeState(speaker);
		this.clearLiveTranscript(speaker);
	};

	private cleanupSession = async ({
		operationId,
		preserveUtterances,
	}: {
		operationId: number;
		preserveUtterances: boolean;
	}) => {
		await Promise.all([this.stopSpeaker("you"), this.stopSpeaker("them")]);
		this.clearRolloverTimeout();

		if (!this.isCurrentOperation(operationId)) {
			return;
		}

		this.patchState({
			isConnecting: false,
			isListening: false,
			liveTranscript: createEmptyLiveTranscriptState(),
			phase: "idle",
			systemAudioStatus: this.activePolicy
				? createSystemAudioStatusFromPolicy(this.activePolicy)
				: this.getState().systemAudioStatus,
			utterances: preserveUtterances ? this.getState().utterances : [],
		});
	};

	private handleTransportInterrupted = async ({
		message,
		planned = false,
		speaker,
	}: {
		message: string;
		planned?: boolean;
		speaker: TranscriptSpeaker;
	}) => {
		if (this.getState().phase === "stopping") {
			return;
		}

		if (speaker === "them") {
			this.shouldRestoreSystemAudioOnReconnect = false;
			await this.stopSpeaker("them");
			this.patchState({
				error: null,
				isConnecting: false,
				isListening: Boolean(this.speakers.you.data.transport),
				phase: this.speakers.you.data.transport ? "listening" : "idle",
				systemAudioStatus: this.activePolicy
					? createSystemAudioStatusFromPolicy(this.activePolicy)
					: createSystemAudioCaptureStatus(),
			});
			return;
		}

		this.shouldRestoreSystemAudioOnReconnect =
			Boolean(this.speakers.them.data.transport) &&
			!this.activePolicy?.systemAudioCapability.shouldAutoBootstrap;

		const operationId = ++this.lifecycleOperationId;
		// Session cleanup must run before planned/unplanned recovery branches inspect state.
		// react-doctor-disable-next-line react-doctor/async-defer-await
		await this.cleanupSession({
			operationId,
			preserveUtterances: true,
		});

		if (planned) {
			this.recoveryAttempt = 0;
			this.patchState({
				error: null,
				isConnecting: true,
				isListening: false,
				phase: "reconnecting",
				recoveryStatus: createTranscriptRecoveryStatus({
					attempt: 0,
					maxAttempts: MAX_RECOVERY_ATTEMPTS,
					message,
					state: "reconnecting",
				}),
			});

			this.reconnectTimeoutId = this.dependencies.scheduleTimeout(() => {
				this.reconnectTimeoutId = null;

				void this.runStart({
					preserveUtterances: true,
					reason: "reconnect",
				});
			}, 0);
			return;
		}

		const nextAttempt = this.recoveryAttempt + 1;
		if (nextAttempt > MAX_RECOVERY_ATTEMPTS) {
			this.patchState({
				error: {
					code: "connection_failed",
					message,
				},
				phase: "failed",
				recoveryStatus: createTranscriptRecoveryStatus({
					attempt: this.recoveryAttempt,
					maxAttempts: MAX_RECOVERY_ATTEMPTS,
					message,
					state: "failed",
				}),
			});
			return;
		}

		this.recoveryAttempt = nextAttempt;
		this.patchState({
			error: null,
			isConnecting: true,
			isListening: false,
			phase: "reconnecting",
			recoveryStatus: createTranscriptRecoveryStatus({
				attempt: nextAttempt,
				maxAttempts: MAX_RECOVERY_ATTEMPTS,
				message,
				state: "reconnecting",
			}),
		});

		const delay =
			RECOVERY_BACKOFF_MS[nextAttempt - 1] ??
			RECOVERY_BACKOFF_MS[RECOVERY_BACKOFF_MS.length - 1];

		this.reconnectTimeoutId = this.dependencies.scheduleTimeout(() => {
			this.reconnectTimeoutId = null;

			void this.runStart({
				preserveUtterances: true,
				reason: "reconnect",
			});
		}, delay);
	};

	private attachSystemAudio = async ({
		automatic,
		operationId,
	}: {
		automatic: boolean;
		operationId: number;
	}) => {
		const policy =
			this.activePolicy ?? (await this.dependencies.resolvePolicy());
		this.activePolicy = policy;

		if (
			!policy.systemAudioCapability.isSupported ||
			this.speakers.them.data.transport
		) {
			return false;
		}

		const logger = createTranscriptionLogger({
			scopeKey: this.config.scopeKey,
			sessionId: this.currentSessionCorrelationId ?? crypto.randomUUID(),
		});

		try {
			const systemAudioInput =
				policy.systemAudioCapability.sourceMode === "desktop-native"
					? await this.dependencies.createDesktopSystemAudioStream().then(
							(result) =>
								({
									dispose: result.dispose,
									source: "systemAudio",
									sourceMode: policy.systemAudioCapability.sourceMode,
									speaker: "them" as const,
									stream: result.stream,
								}) satisfies PendingInputStream,
						)
					: await this.dependencies
							.createBrowserSystemAudioStream()
							.then((stream) =>
								stream
									? ({
											source: "systemAudio",
											sourceMode: policy.systemAudioCapability.sourceMode,
											speaker: "them" as const,
											stream,
										} satisfies PendingInputStream)
									: null,
							);

			if (!systemAudioInput) {
				return false;
			}

			if (!this.isCurrentOperation(operationId)) {
				await disposePendingInputStream(systemAudioInput);
				return false;
			}

			this.patchState({
				systemAudioStatus: {
					sourceMode: policy.systemAudioCapability.sourceMode,
					state: "connected",
				},
			});

			await this.connectSpeaker({
				logger,
				operationId,
				pendingInput: systemAudioInput,
			});

			return true;
		} catch (error) {
			logger.error("system_audio.attach_failed", {
				automatic,
				message:
					error instanceof Error
						? error.message
						: "System audio attachment failed.",
			});
			this.patchState({
				systemAudioStatus: createSystemAudioStatusFromPolicy(policy),
			});
			return false;
		}
	};

	private isCurrentOperation = (operationId: number) =>
		this.lifecycleOperationId === operationId;
}
