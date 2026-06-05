type TranscriptionAutoStopState = {
	hasRequestedAutomaticStop: boolean;
	hasSeenMeetingSignal: boolean;
	shouldStopWhenMeetingEnds: boolean;
};

const createTranscriptionAutoStopState = (): TranscriptionAutoStopState => ({
	hasRequestedAutomaticStop: false,
	hasSeenMeetingSignal: false,
	shouldStopWhenMeetingEnds: false,
});

export class TranscriptionAutoStopController {
	private readonly state: TranscriptionAutoStopState =
		createTranscriptionAutoStopState();

	resetRequest = () => {
		this.state.hasRequestedAutomaticStop = false;
	};

	reset = () => {
		Object.assign(this.state, createTranscriptionAutoStopState());
	};

	hasRequestedStop = () => this.state.hasRequestedAutomaticStop;

	markRequested = () => {
		this.state.hasRequestedAutomaticStop = true;
		this.state.hasSeenMeetingSignal = false;
		this.state.shouldStopWhenMeetingEnds = false;
	};

	queueMeetingAutoStart = ({ enabled }: { enabled: boolean }) => {
		this.state.hasRequestedAutomaticStop = false;
		this.state.hasSeenMeetingSignal = false;
		this.state.shouldStopWhenMeetingEnds = enabled;
	};

	latchMeetingAutoStop = ({ enabled }: { enabled: boolean }) => {
		if (enabled) {
			this.state.shouldStopWhenMeetingEnds = true;
		}
	};

	observeMeetingSignal = ({
		hasMeetingSignal,
		isSpeechListening,
	}: {
		hasMeetingSignal: boolean;
		isSpeechListening: boolean;
	}) => {
		if (hasMeetingSignal) {
			if (isSpeechListening && this.state.shouldStopWhenMeetingEnds) {
				this.state.hasSeenMeetingSignal = true;
			}
			return false;
		}

		if (
			!this.state.shouldStopWhenMeetingEnds ||
			!this.state.hasSeenMeetingSignal ||
			!isSpeechListening ||
			this.state.hasRequestedAutomaticStop
		) {
			return false;
		}

		this.markRequested();
		return true;
	};
}
