import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { authClient } from "@/lib/auth-client";

const useGraneriConvexAuth = () => {
	const { data: session, isPending } = authClient.useSession();
	const cachedTokenRef = useRef<string | null>(null);
	const pendingTokenRef = useRef<Promise<string | null> | null>(null);
	const cachedSessionIdRef = useRef<string | undefined>(undefined);
	const sessionId = session?.session.id ?? undefined;

	const fetchAccessToken = useCallback(
		async ({
			forceRefreshToken = false,
		}: {
			forceRefreshToken?: boolean;
		} = {}) => {
			if (!sessionId) {
				cachedSessionIdRef.current = undefined;
				cachedTokenRef.current = null;
				pendingTokenRef.current = null;
				return null;
			}

			if (cachedSessionIdRef.current !== sessionId) {
				cachedSessionIdRef.current = sessionId;
				cachedTokenRef.current = null;
				pendingTokenRef.current = null;
			}

			if (cachedTokenRef.current && !forceRefreshToken) {
				return cachedTokenRef.current;
			}

			if (!forceRefreshToken && pendingTokenRef.current) {
				return pendingTokenRef.current;
			}

			pendingTokenRef.current = authClient.convex
				.token({ fetchOptions: { throw: false } })
				.then(({ data }) => {
					const token = data?.token || null;
					cachedTokenRef.current = token;
					return token;
				})
				.catch(() => {
					cachedTokenRef.current = null;
					return null;
				})
				.finally(() => {
					pendingTokenRef.current = null;
				});

			return pendingTokenRef.current;
		},
		[sessionId],
	);

	return useMemo(
		() => ({
			isLoading: isPending,
			isAuthenticated: Boolean(sessionId),
			fetchAccessToken,
		}),
		[fetchAccessToken, isPending, sessionId],
	);
};

const useCrossDomainOneTimeToken = () => {
	useEffect(() => {
		const verifyOneTimeToken = async () => {
			if (typeof window === "undefined" || !window.location?.href) {
				return;
			}

			const url = new URL(window.location.href);
			const token = url.searchParams.get("ott");
			if (!token) {
				return;
			}

			url.searchParams.delete("ott");
			window.history.replaceState({}, "", url);

			const result = await authClient.crossDomain.oneTimeToken.verify({
				token,
			});
			const sessionToken = result.data?.session.token;
			if (!sessionToken) {
				return;
			}

			await authClient.getSession({
				fetchOptions: {
					headers: {
						Authorization: `Bearer ${sessionToken}`,
					},
				},
			});
			authClient.updateSession();
		};

		void verifyOneTimeToken();
	}, []);
};

export function GraneriConvexAuthProvider({
	children,
	client,
}: {
	children: React.ReactNode;
	client: ConvexReactClient;
}) {
	useCrossDomainOneTimeToken();

	return (
		<ConvexProviderWithAuth client={client} useAuth={useGraneriConvexAuth}>
			{children}
		</ConvexProviderWithAuth>
	);
}
