export const createNoteSnapshot = ({
	title,
	content,
	searchableText,
}: {
	title: string;
	content: string;
	searchableText: string;
}) =>
	JSON.stringify({
		title,
		content,
		searchableText,
	});

export const isLatestNoteSaveRequest = ({
	requestId,
	latestRequestId,
}: {
	requestId: number;
	latestRequestId: number;
}) => requestId === latestRequestId;

export const canFlushQueuedNoteSave = ({
	queuedRequestId,
	latestRequestId,
	queuedSnapshot,
	lastSavedSnapshot,
}: {
	queuedRequestId: number;
	latestRequestId: number;
	queuedSnapshot: string;
	lastSavedSnapshot: string | null;
}) =>
	isLatestNoteSaveRequest({
		requestId: queuedRequestId,
		latestRequestId,
	}) && queuedSnapshot !== lastSavedSnapshot;

export type QueuedNoteSave<TPayload> = {
	requestId: number;
	snapshot: string;
	payload: TPayload;
};

export const getFlushableQueuedNoteSave = <TPayload>({
	lastSavedSnapshot,
	latestRequestId,
	queuedSave,
}: {
	lastSavedSnapshot: string | null;
	latestRequestId: number;
	queuedSave: QueuedNoteSave<TPayload> | null;
}) =>
	queuedSave &&
	canFlushQueuedNoteSave({
		lastSavedSnapshot,
		latestRequestId,
		queuedRequestId: queuedSave.requestId,
		queuedSnapshot: queuedSave.snapshot,
	})
		? queuedSave
		: null;
