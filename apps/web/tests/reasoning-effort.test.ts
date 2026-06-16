import { beforeEach, describe, expect, it } from "vitest";
import {
	getStoredChatReasoningEffort,
	getStoredReasoningEffort,
	getStoredReasoningEffortOverride,
	resolveReasoningEffortPreference,
	storeChatReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";

describe("chat reasoning effort storage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("stores reasoning effort by normalized chat id", () => {
		storeChatReasoningEffort(" chat-1 ", "high");

		expect(getStoredChatReasoningEffort("chat-1")).toBe("high");
		expect(getStoredChatReasoningEffort(" chat-1 ")).toBe("high");
	});

	it("ignores blank chat ids instead of using a shared storage key", () => {
		storeChatReasoningEffort("", "high");
		storeChatReasoningEffort("   ", "low");

		expect(getStoredChatReasoningEffort("")).toBeNull();
		expect(getStoredChatReasoningEffort("   ")).toBeNull();
		expect(window.localStorage.length).toBe(0);
	});

	it("ignores unsupported stored values", () => {
		window.localStorage.setItem("graneri:chat-reasoning-effort:chat-1", "max");

		expect(getStoredChatReasoningEffort("chat-1")).toBeNull();
	});

	it("distinguishes missing global effort from an explicit global effort", () => {
		expect(getStoredReasoningEffortOverride()).toBeNull();
		expect(getStoredReasoningEffort()).toBe("medium");

		storeReasoningEffort("high");

		expect(getStoredReasoningEffortOverride()).toBe("high");
		expect(getStoredReasoningEffort()).toBe("high");
	});

	it("prefers saved chat effort over stale local overrides", () => {
		expect(
			resolveReasoningEffortPreference({
				persistedChatReasoningEffort: "medium",
				chatReasoningEffortOverride: "low",
				globalReasoningEffortOverride: "high",
				userPreferenceReasoningEffort: "xhigh",
				fallbackReasoningEffort: "medium",
			}),
		).toBe("medium");
	});

	it("uses local and server defaults only when the chat has no saved effort", () => {
		expect(
			resolveReasoningEffortPreference({
				persistedChatReasoningEffort: null,
				chatReasoningEffortOverride: "low",
				globalReasoningEffortOverride: "high",
				userPreferenceReasoningEffort: "xhigh",
				fallbackReasoningEffort: "medium",
			}),
		).toBe("low");

		expect(
			resolveReasoningEffortPreference({
				persistedChatReasoningEffort: null,
				chatReasoningEffortOverride: null,
				globalReasoningEffortOverride: null,
				userPreferenceReasoningEffort: "xhigh",
				fallbackReasoningEffort: "medium",
			}),
		).toBe("xhigh");
	});
});
