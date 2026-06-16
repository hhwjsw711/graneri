import { getDesktopBridge } from "@workspace/platform/desktop";
import * as React from "react";
import type {
	AuthSession,
	GraneriAuthClient,
	JsonWebKeySet,
} from "@/lib/graneri-auth-client";

type DesktopSessionData = AuthSession | null;

type SessionState = {
	data: DesktopSessionData;
	error: Error | null;
	isPending: boolean;
	isRefetching: boolean;
	refetch: () => void;
};

const defaultSessionState: SessionState = {
	data: null,
	error: null,
	isPending: true,
	isRefetching: false,
	refetch: () => {
		void refreshDesktopSession({ force: true });
	},
};

const listeners = new Set<() => void>();
let sessionState: SessionState = { ...defaultSessionState };
let pendingSessionRefresh: {
	generation: number;
	promise: Promise<SessionRefreshResult>;
	requestBearerToken: string | null;
} | null = null;
let sessionRefreshCacheState:
	| { status: "empty" }
	| { completedAt: number; status: "fresh" } = { status: "empty" };
let sessionRefreshGeneration = 0;

const sessionRefreshFreshMs = 2_000;

export const resetDesktopAuthClientForTests = () => {
	sessionState = { ...defaultSessionState };
	pendingSessionRefresh = null;
	sessionRefreshCacheState = { status: "empty" };
	sessionRefreshGeneration = 0;
	listeners.clear();
};

type SessionRefreshResult = {
	data: DesktopSessionData;
	error: {
		message: string;
		status: number;
		statusText: string;
	} | null;
};

type DesktopAuthFetchOptions = {
	path: string;
	method?: string;
	body?: unknown;
	headers?: HeadersInit;
	throw?: boolean;
};

type SessionRefreshOptions = {
	force?: boolean;
	headers?: HeadersInit;
};

type SignInSocialArgs = {
	provider: "google" | "github";
	scopes?: string[];
	callbackURL?: string;
	errorCallbackURL?: string;
	disableRedirect?: boolean;
};

type ConvexFetchOptions = {
	fetchOptions?: {
		headers?: HeadersInit;
	};
};

type OneTimeTokenVerifyArgs = {
	token: string;
};

type DesktopFetchOptions = {
	method?: string;
	headers?: HeadersInit;
	body?: unknown;
	throw?: boolean;
};

type UpdateUserArgs = {
	name?: string;
};

type DesktopAuthErrorShape = {
	message: string;
	status: number;
	statusText: string;
};

const normalizeHeaders = (
	headers?: HeadersInit,
): Record<string, string> | undefined => {
	if (!headers) {
		return undefined;
	}

	if (headers instanceof Headers) {
		return Object.fromEntries(headers.entries());
	}

	return Array.isArray(headers) ? Object.fromEntries(headers) : headers;
};

const getHeaderValue = (headers: HeadersInit | undefined, name: string) => {
	if (!headers) {
		return null;
	}

	if (headers instanceof Headers) {
		return headers.get(name);
	}

	const normalizedName = name.toLowerCase();
	const entries = Array.isArray(headers) ? headers : Object.entries(headers);
	const match = entries.find(([key]) => key.toLowerCase() === normalizedName);

	return typeof match?.[1] === "string" ? match[1] : null;
};

const getBearerToken = (headers?: HeadersInit) => {
	const authorization = getHeaderValue(headers, "authorization")?.trim();
	const match = authorization?.match(/^bearer\s+(.+)$/iu);

	return match?.[1]?.trim() || null;
};

const isDesktopSessionData = (
	value: unknown,
): value is {
	session: Record<string, unknown>;
	user: Record<string, unknown>;
} =>
	typeof value === "object" &&
	value !== null &&
	"session" in value &&
	"user" in value;

const notifyListeners = () => {
	for (const listener of listeners) {
		listener();
	}
};

const toDesktopAuthErrorShape = (
	error: unknown,
	fallbackMessage: string,
): DesktopAuthErrorShape => {
	const nextError = error instanceof Error ? error : new Error(fallbackMessage);

	return {
		message: nextError.message,
		status:
			"status" in nextError && typeof nextError.status === "number"
				? nextError.status
				: 500,
		statusText:
			"statusText" in nextError && typeof nextError.statusText === "string"
				? nextError.statusText
				: nextError.message,
	};
};

const setSessionState = (
	nextState: SessionState | ((current: SessionState) => SessionState),
) => {
	sessionState =
		typeof nextState === "function" ? nextState(sessionState) : nextState;
	notifyListeners();
};

const createSessionState = ({
	data,
	error,
	isPending,
}: {
	data: DesktopSessionData;
	error: Error | null;
	isPending: boolean;
}): SessionState => ({
	data,
	error,
	isPending,
	isRefetching: false,
	refetch: () => {
		void refreshDesktopSession({ force: true });
	},
});

const getFreshSessionRefreshResult = (): SessionRefreshResult | null => {
	if (
		sessionRefreshCacheState.status !== "fresh" ||
		Date.now() - sessionRefreshCacheState.completedAt > sessionRefreshFreshMs
	) {
		return null;
	}

	return {
		data: sessionState.data,
		error: sessionState.error
			? toDesktopAuthErrorShape(sessionState.error, "Failed to fetch session.")
			: null,
	};
};

const canUseFreshSessionForHeaders = (headers?: HeadersInit) => {
	const bearerToken = getBearerToken(headers);

	if (!bearerToken) {
		return !headers;
	}

	return sessionState.data?.session.token === bearerToken;
};

const markSessionRefreshFresh = () => {
	sessionRefreshCacheState = { completedAt: Date.now(), status: "fresh" };
};

const invalidateSessionRefreshes = () => {
	sessionRefreshGeneration += 1;
	pendingSessionRefresh = null;
	sessionRefreshCacheState = { status: "empty" };
};

const applySessionData = (data: DesktopSessionData, generation?: number) => {
	if (generation !== undefined && generation !== sessionRefreshGeneration) {
		return;
	}

	markSessionRefreshFresh();
	setSessionState(
		createSessionState({
			data,
			error: null,
			isPending: false,
		}),
	);
};

const getPendingSessionRefresh = ({
	force,
	headers,
}: Required<Pick<SessionRefreshOptions, "force">> &
	Pick<SessionRefreshOptions, "headers">) => {
	if (!pendingSessionRefresh) {
		return null;
	}

	if (pendingSessionRefresh.generation !== sessionRefreshGeneration) {
		pendingSessionRefresh = null;
		return null;
	}

	if (!force) {
		return pendingSessionRefresh.promise;
	}

	const bearerToken = getBearerToken(headers);
	if (bearerToken && pendingSessionRefresh.requestBearerToken === bearerToken) {
		return pendingSessionRefresh.promise;
	}

	return null;
};

const desktopAuthFetch = async ({
	path,
	method = "GET",
	body,
	headers,
	throw: shouldThrow,
}: DesktopAuthFetchOptions) => {
	const desktopBridge = getDesktopBridge();

	if (!desktopBridge?.authFetch) {
		throw new Error("Desktop auth bridge is not available.");
	}

	return await desktopBridge.authFetch({
		path,
		method,
		body,
		headers: normalizeHeaders(headers),
		throw: shouldThrow,
	});
};

const refreshDesktopSession = async ({
	force = false,
	headers,
}: SessionRefreshOptions = {}): Promise<SessionRefreshResult> => {
	const pendingRefresh = getPendingSessionRefresh({ force, headers });
	if (pendingRefresh) {
		return pendingRefresh;
	}

	if (!force || canUseFreshSessionForHeaders(headers)) {
		const freshSessionRefreshResult = getFreshSessionRefreshResult();
		if (freshSessionRefreshResult) {
			return freshSessionRefreshResult;
		}
	}

	setSessionState((current) => ({
		...current,
		error: null,
		isPending: true,
	}));

	const generation = sessionRefreshGeneration;
	const requestBearerToken = getBearerToken(headers);
	const sessionRefreshPromise = desktopAuthFetch({
		path: "/get-session",
		method: "GET",
		headers,
	})
		.then((data: unknown) => {
			const nextData = isDesktopSessionData(data) ? data : null;

			applySessionData(nextData, generation);

			return {
				data: nextData,
				error: null,
			};
		})
		.catch((error: unknown) => {
			const nextError =
				error instanceof Error ? error : new Error("Failed to fetch session.");
			const errorShape = toDesktopAuthErrorShape(
				error,
				"Failed to fetch session.",
			);

			if (generation === sessionRefreshGeneration) {
				markSessionRefreshFresh();
				setSessionState(
					createSessionState({
						data: null,
						error: nextError,
						isPending: false,
					}),
				);
			}

			return {
				data: null,
				error: errorShape,
			};
		})
		.finally(() => {
			if (
				pendingSessionRefresh?.generation === generation &&
				pendingSessionRefresh.promise === sessionRefreshPromise
			) {
				pendingSessionRefresh = null;
			}
		});

	pendingSessionRefresh = {
		generation,
		promise: sessionRefreshPromise,
		requestBearerToken,
	};
	return sessionRefreshPromise;
};

const fetchConvexEndpoint = async (path: string, headers?: HeadersInit) =>
	await desktopAuthFetch({
		path,
		method: "GET",
		headers,
	});

const useDesktopSession = () => {
	const [state, setState] = React.useState<SessionState>(sessionState);

	React.useEffect(() => {
		const listener = () => {
			setState(sessionState);
		};
		listeners.add(listener);

		if (sessionState.isPending) {
			void refreshDesktopSession();
		}

		return () => {
			listeners.delete(listener);
		};
	}, []);

	return state;
};

export const desktopAuthClient = {
	useSession: useDesktopSession,
	getSession: async ({ fetchOptions }: ConvexFetchOptions = {}) =>
		await refreshDesktopSession({
			force: Boolean(fetchOptions?.headers),
			headers: fetchOptions?.headers,
		}),
	updateUser: async (body: UpdateUserArgs) => {
		try {
			const data = await desktopAuthFetch({
				path: "/update-user",
				method: "POST",
				body,
				throw: true,
			});
			invalidateSessionRefreshes();
			await refreshDesktopSession({ force: true });

			return {
				data,
				error: null,
			};
		} catch (error) {
			return {
				data: null,
				error: toDesktopAuthErrorShape(error, "Failed to update user."),
			};
		}
	},
	signOut: async () => {
		await desktopAuthFetch({
			path: "/sign-out",
			method: "POST",
			body: {},
			throw: true,
		});
		invalidateSessionRefreshes();
		setSessionState(
			createSessionState({
				data: null,
				error: null,
				isPending: false,
			}),
		);
		return { data: { success: true }, error: null };
	},
	$fetch: async <TResult>(path: string, options: DesktopFetchOptions = {}) =>
		(await desktopAuthFetch({
			path,
			method: options.method,
			body: options.body,
			headers: options.headers,
			throw: options.throw,
		})) as TResult,
	signIn: {
		social: async ({
			provider,
			scopes,
			callbackURL,
			errorCallbackURL,
			disableRedirect,
		}: SignInSocialArgs) => {
			const desktopBridge = getDesktopBridge();
			const resolvedCallbackURL =
				callbackURL ??
				(desktopBridge
					? (await desktopBridge.getAuthCallbackUrl()).url
					: window.location.href);
			const result = await desktopAuthFetch({
				path: "/sign-in/social",
				method: "POST",
				body: {
					provider,
					callbackURL: resolvedCallbackURL,
					errorCallbackURL: errorCallbackURL ?? resolvedCallbackURL,
					disableRedirect: disableRedirect ?? true,
					scopes,
				},
				throw: true,
			});

			const url =
				result && typeof result === "object" && "url" in result
					? String(result.url ?? "")
					: "";

			if (!url) {
				throw new Error(
					`${provider === "google" ? "Google" : "GitHub"} sign-in URL was not returned.`,
				);
			}

			if (desktopBridge) {
				await desktopBridge.openExternalUrl(url);
			} else {
				window.location.assign(url);
			}

			return { data: result, error: null };
		},
	},
	convex: {
		token: async ({ fetchOptions }: ConvexFetchOptions = {}) => {
			const data = await fetchConvexEndpoint(
				"/convex/token",
				fetchOptions?.headers,
			);
			const token =
				data && typeof data === "object" && "token" in data ? data.token : null;
			return {
				data: typeof token === "string" ? { token } : null,
				error: null,
			};
		},
		jwks: async ({ fetchOptions }: ConvexFetchOptions = {}) => ({
			data: (await fetchConvexEndpoint(
				"/convex/jwks",
				fetchOptions?.headers,
			)) as JsonWebKeySet,
			error: null,
		}),
	},
	crossDomain: {
		oneTimeToken: {
			verify: async ({ token }: OneTimeTokenVerifyArgs) => {
				const data = await desktopAuthFetch({
					path: "/cross-domain/one-time-token/verify",
					method: "POST",
					body: { token },
				});

				if (isDesktopSessionData(data)) {
					invalidateSessionRefreshes();
					applySessionData(data);
				}

				return {
					data: isDesktopSessionData(data) ? data : null,
					error: null,
				};
			},
		},
	},
	updateSession: () => {
		void refreshDesktopSession();
	},
} satisfies GraneriAuthClient;
