import { describe, expect, it } from "vitest";
import {
	createNoteCaptureRequestId,
	getNoteCaptureRequestIdForAutoStart,
} from "../src/lib/note-capture-request";

describe("note capture request", () => {
	it("uses a trimmed provided request id", () => {
		expect(createNoteCaptureRequestId(" request-1 ")).toBe("request-1");
		expect(
			getNoteCaptureRequestIdForAutoStart({
				autoStartCapture: true,
				captureRequestId: " request-2 ",
			}),
		).toBe("request-2");
	});

	it("does not create a request id unless capture should auto-start", () => {
		expect(
			getNoteCaptureRequestIdForAutoStart({
				autoStartCapture: false,
				captureRequestId: "request-1",
			}),
		).toBe(null);
	});

	it("creates a request id for auto-start capture without an existing id", () => {
		const captureRequestId = getNoteCaptureRequestIdForAutoStart({
			autoStartCapture: true,
			captureRequestId: null,
		});

		expect(captureRequestId).toEqual(expect.any(String));
		expect(captureRequestId).not.toBe("");
	});
});
