import { describe, expect, it } from "vitest";
import {
	getConnectionErrorMessage,
	getConvexErrorDataMessage,
	withoutTrailingPeriod,
} from "@/components/settings/connection-error-message";

describe("connection error messages", () => {
	it("trims trailing periods from surfaced messages", () => {
		expect(withoutTrailingPeriod("Connection failed...")).toBe(
			"Connection failed",
		);
		expect(withoutTrailingPeriod("Connection failed.   ")).toBe(
			"Connection failed",
		);
	});

	it("extracts structured Convex error data messages", () => {
		const error = new Error(
			'Uncaught ConvexError: {"message":"Already connected."} at handler',
		);

		expect(getConvexErrorDataMessage(error)).toBe("Already connected.");
		expect(getConnectionErrorMessage(error, "Failed to connect")).toBe(
			"Already connected",
		);
	});

	it("falls back to plain Error messages and fallback strings", () => {
		expect(
			getConnectionErrorMessage(new Error("OAuth popup blocked."), "Fallback"),
		).toBe("OAuth popup blocked");
		expect(getConnectionErrorMessage("unknown", "Fallback")).toBe("Fallback");
	});

	it("ignores malformed Convex error payloads", () => {
		const error = new Error("Uncaught ConvexError: {bad json} at handler");

		expect(getConvexErrorDataMessage(error)).toBe("");
		expect(getConnectionErrorMessage(error, "Fallback")).toBe(
			"Uncaught ConvexError: {bad json} at handler",
		);
	});
});
