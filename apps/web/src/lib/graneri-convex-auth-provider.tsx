import type { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

const useGraneriConvexAuth = () => {
	const { data: session, isPending } = authClient.useSession();
	const [cachedToken, setCachedToken] = useState<string | null>(null);
	const pendingTokenRef = useRef<Promise<string | null> | null>(null);
	const previousSessionIdRef = useRef<string | undefined>(undefined);
	const sessionId = session?.session.id ?? undefined;

	useEffect(() => {
		if (previousSessionIdRef.current !== sessionId) {
			previousSessionIdRef.current = sessionId;
			pendingTokenRef.current = null;
			setCachedToken(null);
			return;
		}

		if (!session && !isPending && cachedToken) {
			setCachedToken(null);
		}
	}, [cachedToken, isPending, session, sessionId]);

	const fetchAccessToken = useCallback(
		async ({
			forceRefreshToken = false,
		}: {
			forceRefreshToken?: boolean;
		} = {}) => {
			if (cachedToken && !forceRefreshToken) {
				return cachedToken;
			}

			if (!forceRefreshToken && pendingTokenRef.current) {
				return pendingTokenRef.current;
			}

			pendingTokenRef.current = authClient.convex
				.token({ fetchOptions: { throw: false } })
				.then(({ data }) => {
					const token = data?.token || null;
					setCachedToken(token);
					return token;
				})
				.catch(() => {
					setCachedToken(null);
					return null;
				})
				.finally(() => {
					pendingTokenRef.current = null;
				});

			return pendingTokenRef.current;
		},
		[cachedToken],
	);

	return useMemo(
		() => ({
			isLoading: isPending && !cachedToken,
			isAuthenticated: Boolean(session?.session) || cachedToken !== null,
			fetchAccessToken,
		}),
		[cachedToken, fetchAccessToken, isPending, session?.session],
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
