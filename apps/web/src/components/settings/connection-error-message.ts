export const withoutTrailingPeriod = (message: string) =>
	message.trimEnd().replace(/\.+$/u, "");

export const getConvexErrorDataMessage = (error: unknown) => {
	if (!(error instanceof Error)) {
		return "";
	}

	const match = error.message.match(/Uncaught ConvexError:\s*(\{.*?\})\s+at/su);
	if (!match?.[1]) {
		return "";
	}

	try {
		const data = JSON.parse(match[1]) as unknown;
		return data &&
			typeof data === "object" &&
			"message" in data &&
			typeof data.message === "string"
			? data.message
			: "";
	} catch {
		return "";
	}
};

export const getConnectionErrorMessage = (error: unknown, fallback: string) => {
	const convexMessage = getConvexErrorDataMessage(error);
	if (convexMessage) {
		return withoutTrailingPeriod(convexMessage);
	}

	return error instanceof Error
		? withoutTrailingPeriod(error.message)
		: fallback;
};
