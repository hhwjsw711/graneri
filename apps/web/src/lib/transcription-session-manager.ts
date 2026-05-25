import { DesktopTranscriptionControllerProxy } from "@/lib/desktop-transcription-controller-proxy";
import { shouldUseDesktopTranscriptionProxy } from "@/lib/desktop-transcription-session-mode";
import {
	TranscriptionController,
	type TranscriptionControllerDependencies,
	type TranscriptionControllerOptions,
} from "@/lib/transcription-controller";
import { TranscriptionSessionStore } from "@/lib/transcription-session-store";

const GLOBAL_TRANSCRIPTION_SESSION_SCOPE = "global" as const;

type TranscriptionControllerLike = {
	configure: (options: TranscriptionControllerOptions) => void | Promise<void>;
	detachSystemAudio: () => Promise<void>;
	requestSystemAudio: () => Promise<boolean>;
	start: () => Promise<boolean>;
	stop: (options?: {
		preserveUtterances?: boolean;
		resetError?: boolean;
		resetRecovery?: boolean;
	}) => Promise<void>;
};

type TranscriptionSessionManagerOptions = {
	controller: TranscriptionControllerLike;
	store: TranscriptionSessionStore;
};

// The app intentionally supports one active transcription session at a time.
// All UI surfaces subscribe to this single manager so capture ownership stays explicit.
class TranscriptionSessionManager {
	readonly scope = GLOBAL_TRANSCRIPTION_SESSION_SCOPE;

	readonly store: TranscriptionSessionStore;

	readonly controller: TranscriptionControllerLike;

	constructor({ controller, store }: TranscriptionSessionManagerOptions) {
		this.store = store;
		this.controller = controller;
	}
}

function createTranscriptionController(
	store: TranscriptionSessionStore,
	dependencies?: Partial<TranscriptionControllerDependencies>,
): TranscriptionControllerLike {
	if (dependencies) {
		return new TranscriptionController({
			...dependencies,
			store,
		});
	}

	if (shouldUseDesktopTranscriptionProxy()) {
		return new DesktopTranscriptionControllerProxy(store);
	}

	return new TranscriptionController({ store });
}

function createTranscriptionSessionManager(
	dependencies?: Partial<TranscriptionControllerDependencies>,
) {
	const store = new TranscriptionSessionStore();

	return new TranscriptionSessionManager({
		controller: createTranscriptionController(store, dependencies),
		store,
	});
}

export const transcriptionSessionManager = createTranscriptionSessionManager();
