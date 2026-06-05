import {
	getDesktopAuthCallbackUrl,
	getDesktopBridge,
	getDesktopMeetingDetectionState,
	isDesktopRuntime,
	onDesktopMeetingDetectionState,
	openDesktopExternalUrl,
	requestDesktopPermission,
	saveDesktopTextFile,
} from "@workspace/platform/desktop";
import type { DesktopMeetingDetectionState } from "@workspace/platform/desktop-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDesktopBridge = window.graneriDesktop;

const setDesktopBridge = (
	bridge: Partial<NonNullable<Window["graneriDesktop"]>> | undefined,
) => {
	window.graneriDesktop = bridge as Window["graneriDesktop"];
};

afterEach(() => {
	window.graneriDesktop = originalDesktopBridge;
	vi.restoreAllMocks();
});

describe("desktop platform bridge", () => {
	it("reports desktop runtime availability from the bridge", () => {
		setDesktopBridge(undefined);

		expect(getDesktopBridge()).toBeNull();
		expect(isDesktopRuntime()).toBe(false);

		setDesktopBridge({
			platform: "darwin",
		});

		expect(getDesktopBridge()?.platform).toBe("darwin");
		expect(isDesktopRuntime()).toBe(true);
	});

	it("uses desktop auth callback URLs and falls back to the browser URL", async () => {
		setDesktopBridge(undefined);

		await expect(
			getDesktopAuthCallbackUrl("https://app.example/auth"),
		).resolves.toBe("https://app.example/auth");

		setDesktopBridge({
			getAuthCallbackUrl: vi.fn().mockResolvedValue({
				url: "graneri://auth/callback",
			}),
			platform: "darwin",
		});

		await expect(
			getDesktopAuthCallbackUrl("https://app.example/auth"),
		).resolves.toBe("graneri://auth/callback");
	});

	it("opens external URLs through desktop when available", async () => {
		const openExternalUrl = vi.fn().mockResolvedValue({ ok: true });
		setDesktopBridge({
			openExternalUrl,
			platform: "darwin",
		});

		await expect(openDesktopExternalUrl("https://example.com")).resolves.toBe(
			true,
		);
		expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
	});

	it("returns false for desktop actions when the capability is unavailable", async () => {
		setDesktopBridge({
			platform: "darwin",
		});

		await expect(openDesktopExternalUrl("https://example.com")).resolves.toBe(
			false,
		);
		await expect(requestDesktopPermission("microphone")).resolves.toBeNull();
		await expect(
			saveDesktopTextFile("note.txt", "content"),
		).resolves.toBeNull();
	});

	it("proxies meeting detection subscriptions and state", async () => {
		const unsubscribe = vi.fn();
		const onMeetingDetectionState = vi.fn().mockReturnValue(unsubscribe);
		const getMeetingDetectionState = vi.fn().mockResolvedValue({
			calendarEvent: null,
			candidateStartedAt: null,
			confidence: 0,
			dismissedUntil: null,
			hasMeetingSignal: false,
			isMicrophoneActive: false,
			isSuppressed: false,
			sourceName: null,
			status: "idle",
		} satisfies DesktopMeetingDetectionState);
		const listener = vi.fn();

		setDesktopBridge({
			getMeetingDetectionState,
			onMeetingDetectionState,
			platform: "darwin",
		});

		expect(onDesktopMeetingDetectionState(listener)).toBe(unsubscribe);
		expect(onMeetingDetectionState).toHaveBeenCalledWith(listener);
		await expect(getDesktopMeetingDetectionState()).resolves.toMatchObject({
			status: "idle",
		});
	});
});
