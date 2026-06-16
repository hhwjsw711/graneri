import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	desktopAuthClient,
	resetDesktopAuthClientForTests,
} from "../src/lib/desktop-auth-client";

const { desktopBridgeMock } = vi.hoisted(() => ({
	desktopBridgeMock: {
		authFetch: vi.fn(),
		getAuthCallbackUrl: vi.fn(),
		openExternalUrl: vi.fn(),
		platform: "darwin",
	},
}));

vi.mock("@workspace/platform/desktop", () => ({
	getDesktopBridge: () => desktopBridgeMock,
}));

const createSession = (token = "session-token") => ({
	session: {
		id: "session-id",
		token,
	},
	user: {
		email: "murad@example.com",
		id: "user-id",
		name: "Murad",
	},
});

const createDeferred = <T,>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});

	return { promise, reject, resolve };
};

describe("desktop auth client", () => {
	beforeEach(() => {
		resetDesktopAuthClientForTests();
		desktopBridgeMock.authFetch.mockReset();
		desktopBridgeMock.getAuthCallbackUrl.mockReset();
		desktopBridgeMock.openExternalUrl.mockReset();
	});

	it("dedupes passive session reads and reuses a fresh settled result", async () => {
		const session = createSession();
		desktopBridgeMock.authFetch.mockResolvedValue(session);

		const first = renderHook(() => desktopAuthClient.useSession());
		const second = renderHook(() => desktopAuthClient.useSession());

		await waitFor(() => {
			expect(first.result.current.isPending).toBe(false);
			expect(second.result.current.isPending).toBe(false);
		});

		first.unmount();
		second.unmount();

		const third = renderHook(() => desktopAuthClient.useSession());

		await waitFor(() => {
			expect(third.result.current.isPending).toBe(false);
		});

		expect(third.result.current.data).toEqual(session);
		expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(1);
		expect(desktopBridgeMock.authFetch).toHaveBeenCalledWith({
			body: undefined,
			headers: undefined,
			method: "GET",
			path: "/get-session",
			throw: undefined,
		});

		third.unmount();
	});

	it("hydrates the desktop session from cross-domain verification without an immediate get-session fetch", async () => {
		const session = createSession("verified-token");
		desktopBridgeMock.authFetch.mockResolvedValue(session);

		await expect(
			desktopAuthClient.crossDomain.oneTimeToken.verify({
				token: "one-time-token",
			}),
		).resolves.toEqual({
			data: session,
			error: null,
		});

		await expect(
			desktopAuthClient.getSession({
				fetchOptions: {
					headers: {
						Authorization: "Bearer verified-token",
					},
				},
			}),
		).resolves.toEqual({
			data: session,
			error: null,
		});

		desktopAuthClient.updateSession();
		await Promise.resolve();

		expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(1);
		expect(desktopBridgeMock.authFetch).toHaveBeenCalledWith({
			body: { token: "one-time-token" },
			headers: undefined,
			method: "POST",
			path: "/cross-domain/one-time-token/verify",
			throw: undefined,
		});
	});

	it("does not let a stale pending session refresh overwrite cross-domain verification", async () => {
		const staleSession = createSession("stale-token");
		const verifiedSession = createSession("verified-token");
		const pendingGetSession = createDeferred<typeof staleSession>();
		desktopBridgeMock.authFetch
			.mockReturnValueOnce(pendingGetSession.promise)
			.mockResolvedValueOnce(verifiedSession);

		const initialSession = renderHook(() => desktopAuthClient.useSession());

		await waitFor(() => {
			expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(1);
		});

		await expect(
			desktopAuthClient.crossDomain.oneTimeToken.verify({
				token: "one-time-token",
			}),
		).resolves.toEqual({
			data: verifiedSession,
			error: null,
		});

		pendingGetSession.resolve(staleSession);
		await pendingGetSession.promise;

		const currentSession = renderHook(() => desktopAuthClient.useSession());

		expect(currentSession.result.current.data).toEqual(verifiedSession);
		expect(initialSession.result.current.data).toEqual(verifiedSession);
		expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(2);

		initialSession.unmount();
		currentSession.unmount();
	});

	it("forces a session refresh after user profile updates", async () => {
		const updatedSession = createSession("updated-token");
		desktopBridgeMock.authFetch
			.mockResolvedValueOnce({ success: true })
			.mockResolvedValueOnce(updatedSession);

		await expect(
			desktopAuthClient.updateUser({ name: "Murad" }),
		).resolves.toEqual({
			data: { success: true },
			error: null,
		});

		expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(2);
		expect(desktopBridgeMock.authFetch).toHaveBeenNthCalledWith(1, {
			body: { name: "Murad" },
			headers: undefined,
			method: "POST",
			path: "/update-user",
			throw: true,
		});
		expect(desktopBridgeMock.authFetch).toHaveBeenNthCalledWith(2, {
			body: undefined,
			headers: undefined,
			method: "GET",
			path: "/get-session",
			throw: undefined,
		});
	});

	it("does not reuse a stale pending session refresh after user profile updates", async () => {
		const staleSession = createSession("stale-token");
		const updatedSession = createSession("updated-token");
		const pendingGetSession = createDeferred<typeof staleSession>();
		desktopBridgeMock.authFetch
			.mockReturnValueOnce(pendingGetSession.promise)
			.mockResolvedValueOnce({ success: true })
			.mockResolvedValueOnce(updatedSession);

		const initialSession = renderHook(() => desktopAuthClient.useSession());

		await waitFor(() => {
			expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(1);
		});

		await expect(
			desktopAuthClient.updateUser({ name: "Murad" }),
		).resolves.toEqual({
			data: { success: true },
			error: null,
		});

		pendingGetSession.resolve(staleSession);
		await pendingGetSession.promise;

		const currentSession = renderHook(() => desktopAuthClient.useSession());

		expect(currentSession.result.current.data).toEqual(updatedSession);
		expect(initialSession.result.current.data).toEqual(updatedSession);
		expect(desktopBridgeMock.authFetch).toHaveBeenCalledTimes(3);
		expect(desktopBridgeMock.authFetch).toHaveBeenNthCalledWith(3, {
			body: undefined,
			headers: undefined,
			method: "GET",
			path: "/get-session",
			throw: undefined,
		});

		initialSession.unmount();
		currentSession.unmount();
	});
});
