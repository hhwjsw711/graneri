export const createNoteCaptureRequestId = (value?: string | null) =>
	value?.trim() || crypto.randomUUID();

export const getNoteCaptureRequestIdForAutoStart = ({
	autoStartCapture,
	captureRequestId,
}: {
	autoStartCapture?: boolean;
	captureRequestId?: string | null;
}) =>
	autoStartCapture === true
		? createNoteCaptureRequestId(captureRequestId)
		: null;
