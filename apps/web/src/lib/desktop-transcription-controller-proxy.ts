import { getRequiredDesktopBridge } from "@workspace/platform/desktop";
import type { TranscriptionControllerOptions } from "@/lib/transcription-controller";
import type {
	TranscriptionSessionEvent,
	TranscriptionSessionStore,
} from "@/lib/transcription-session-store";
import type { TranscriptionControllerState } from "@/lib/transcription-session-types";

type SerializedDesktopTranscriptionSessionEvent =
	| {
			type: "session.permission_failure";
			error: {
				code:
					| "permission_denied"
					| "device_unavailable"
					| "connection_failed"
					| "configuration_failed"
					| "unknown";
				message: string;
			};
	  }
	| {
			type: "session.utterance_committed";
			utterance: TranscriptionControllerState["utterances"][number];
	  };

const deserializeDesktopEvent = (
	event: SerializedDesktopTranscriptionSessionEvent,
): TranscriptionSessionEvent => event;

export class DesktopTranscriptionControllerProxy {
	private readonly store: TranscriptionSessionStore;

	private readonly initializationPromise: Promise<void>;

	constructor(store: TranscriptionSessionStore) {
		this.store = store;
		this.initializationPromise = this.initialize();
	}

	configure = async (options: TranscriptionControllerOptions) => {
		await this.initializationPromise;
		await getRequiredDesktopBridge().configureTranscriptionSession(options);
	};

	start = async () => {
		await this.initializationPromise;
		return await getRequiredDesktopBridge().startTranscriptionSession();
	};

	stop = async (options?: { reason?: string }) => {
		await this.initializationPromise;
		await getRequiredDesktopBridge().stopTranscriptionSession({
			reason: options?.reason,
		});
	};

	requestSystemAudio = async () => {
		await this.initializationPromise;
		return await getRequiredDesktopBridge().requestTranscriptionSystemAudio();
	};

	detachSystemAudio = async () => {
		await this.initializationPromise;
		await getRequiredDesktopBridge().detachTranscriptionSystemAudio();
	};

	private initialize = async () => {
		const desktopApi = getRequiredDesktopBridge();

		desktopApi.onTranscriptionSessionState((state) => {
			this.store.replaceState(state);
		});

		desktopApi.onTranscriptionSessionEvent((event) => {
			this.store.emitExternalEvent(deserializeDesktopEvent(event));
		});

		this.store.replaceState(await desktopApi.getTranscriptionSessionState());
	};
}
