type ResolveCanGenerateNotesArgs = {
	hasGeneratedLatestTranscript: boolean;
	hasPendingGenerateTranscript: boolean;
	isChatOpen: boolean;
	isGeneratingTemplateNote: boolean;
	isSpeechListening: boolean;
	isTranscriptOpen: boolean;
	isTranscriptSessionReady: boolean;
};

type NoteGenerateBlockedReason =
	| "transcript_not_ready"
	| "no_pending_transcript"
	| "already_generated"
	| "template_note"
	| "recording"
	| "chat_open"
	| "transcript_open";

type NoteGenerateAvailability =
	| { status: "available" }
	| { status: "blocked"; reason: NoteGenerateBlockedReason };

export const getNoteGenerateAvailability = ({
	hasGeneratedLatestTranscript,
	hasPendingGenerateTranscript,
	isChatOpen,
	isGeneratingTemplateNote,
	isSpeechListening,
	isTranscriptOpen,
	isTranscriptSessionReady,
}: ResolveCanGenerateNotesArgs): NoteGenerateAvailability => {
	if (!isTranscriptSessionReady) {
		return { status: "blocked", reason: "transcript_not_ready" };
	}

	if (!hasPendingGenerateTranscript) {
		return { status: "blocked", reason: "no_pending_transcript" };
	}

	if (hasGeneratedLatestTranscript) {
		return { status: "blocked", reason: "already_generated" };
	}

	if (isGeneratingTemplateNote) {
		return { status: "blocked", reason: "template_note" };
	}

	if (isSpeechListening) {
		return { status: "blocked", reason: "recording" };
	}

	if (isChatOpen) {
		return { status: "blocked", reason: "chat_open" };
	}

	if (isTranscriptOpen) {
		return { status: "blocked", reason: "transcript_open" };
	}

	return { status: "available" };
};

export const resolveCanGenerateNotes = (args: ResolveCanGenerateNotesArgs) =>
	getNoteGenerateAvailability(args).status === "available";
