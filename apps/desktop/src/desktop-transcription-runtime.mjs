export function createTranscriptionSpeakerRuntime(speaker) {
	return {
		speaker,
		activeSourceMode: "unsupported",
		captureDispose: null,
		emittedItemIds: new Set(),
		lastCommittedItemId: null,
		liveItemId: null,
		sessionId: null,
		transportActive: false,
		turns: new Map(),
	};
}

export function createTranscriptRecoveryStatus(overrides = {}) {
	return {
		attempt: 0,
		maxAttempts: 0,
		message: null,
		state: "idle",
		...overrides,
	};
}

export function createEmptyLiveTranscriptState() {
	return {
		you: {
			speaker: "you",
			startedAt: null,
			text: "",
		},
		them: {
			speaker: "them",
			startedAt: null,
			text: "",
		},
	};
}
