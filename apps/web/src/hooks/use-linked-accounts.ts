import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import type { LinkedAccount } from "@/lib/google-integrations";
import { logError } from "@/lib/logger";

const linkedAccountsCache = new Map<string, LinkedAccount[]>();

type LinkedAccountsState =
	| { accounts: LinkedAccount[]; cacheKey: string | null; status: "idle" }
	| {
			accounts: LinkedAccount[];
			cacheKey: string | null;
			requestId: number;
			status: "loading";
	  };

export const useLinkedAccounts = (
	sessionUser: { email?: string | null } | null | undefined,
) => {
	const cacheKey = sessionUser?.email ?? null;
	const [state, setState] = useState<LinkedAccountsState>(() => ({
		accounts: cacheKey ? (linkedAccountsCache.get(cacheKey) ?? []) : [],
		cacheKey,
		status: "idle",
	}));
	const requestIdRef = useRef(0);
	const visibleState =
		state.cacheKey === cacheKey
			? state
			: {
					accounts: cacheKey ? (linkedAccountsCache.get(cacheKey) ?? []) : [],
					cacheKey,
					status: "idle" as const,
				};

	const loadAccounts = useCallback(async () => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;

		if (!sessionUser) {
			setState({ accounts: [], cacheKey: null, status: "idle" });
			return;
		}

		setState((current) => ({
			accounts:
				current.cacheKey === cacheKey
					? current.accounts
					: cacheKey
						? (linkedAccountsCache.get(cacheKey) ?? [])
						: [],
			cacheKey,
			requestId,
			status: "loading",
		}));

		try {
			if (requestIdRef.current !== requestId) {
				return;
			}

			const result = await authClient.$fetch("/list-accounts", {
				method: "GET",
				throw: true,
			});
			const isCurrentRequest = requestIdRef.current === requestId;
			const nextAccounts = Array.isArray(result)
				? (result as LinkedAccount[])
				: [];
			if (!isCurrentRequest) {
				return;
			}

			if (cacheKey) {
				linkedAccountsCache.set(cacheKey, nextAccounts);
			}
			setState((current) =>
				current.status === "loading" && current.requestId === requestId
					? { accounts: nextAccounts, cacheKey, status: "idle" }
					: current,
			);
		} catch (error) {
			if (requestIdRef.current !== requestId) {
				return;
			}

			setState((current) =>
				current.status === "loading" && current.requestId === requestId
					? { accounts: current.accounts, cacheKey, status: "idle" }
					: current,
			);
			logError({
				event: "client.error",
				error: error,
				message: "Failed to load linked accounts",
			});
			toast.error("Failed to load linked Google accounts");
		}
	}, [cacheKey, sessionUser]);

	useEffect(() => {
		void loadAccounts();
	}, [loadAccounts]);

	useEffect(() => {
		const handleFocus = () => {
			void loadAccounts();
		};

		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [loadAccounts]);

	return {
		accounts: visibleState.accounts,
		isLoadingAccounts: visibleState.status === "loading",
		loadAccounts,
	};
};
