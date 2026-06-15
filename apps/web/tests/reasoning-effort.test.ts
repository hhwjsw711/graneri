import { beforeEach, describe, expect, it } from "vitest";
import {
	getStoredChatReasoningEffort,
	storeChatReasoningEffort,
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
});
