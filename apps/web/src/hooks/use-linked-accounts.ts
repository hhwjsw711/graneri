import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import type { LinkedAccount } from "@/lib/google-integrations";
import { logError } from "@/lib/logger";

const linkedAccountsCache = new Map<string, LinkedAccount[]>();

type LinkedAccountsState =
	| { accounts: LinkedAccount[]; status: "idle" }
	| { accounts: LinkedAccount[]; requestId: number; status: "loading" };

export const useLinkedAccounts = (
	sessionUser: { email?: string | null } | null | undefined,
) => {
	const cacheKey = sessionUser?.email ?? null;
	const [state, setState] = useState<LinkedAccountsState>(() => ({
		accounts: cacheKey ? (linkedAccountsCache.get(cacheKey) ?? []) : [],
		status: "idle",
	}));
	const requestIdRef = useRef(0);

	// react-doctor-disable-next-line react-doctor/no-derived-state
	useEffect(() => {
		requestIdRef.current += 1;
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setState({
			accounts: cacheKey ? (linkedAccountsCache.get(cacheKey) ?? []) : [],
			status: "idle",
		});
	}, [cacheKey]);

	const loadAccounts = useCallback(async () => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;

		if (!sessionUser) {
			setState({ accounts: [], status: "idle" });
			return;
		}

		setState((current) => ({
			accounts: current.accounts,
			requestId,
			status: "loading",
		}));

		try {
			const result = await authClient.$fetch("/list-accounts", {
				method: "GET",
				throw: true,
			});
			const nextAccounts = Array.isArray(result)
				? (result as LinkedAccount[])
				: [];
			if (requestIdRef.current !== requestId) {
				return;
			}

			if (cacheKey) {
				linkedAccountsCache.set(cacheKey, nextAccounts);
			}
			setState((current) =>
				current.status === "loading" && current.requestId === requestId
					? { accounts: nextAccounts, status: "idle" }
					: current,
			);
		} catch (error) {
			if (requestIdRef.current !== requestId) {
				return;
			}

			setState((current) =>
				current.status === "loading" && current.requestId === requestId
					? { accounts: current.accounts, status: "idle" }
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
		accounts: state.accounts,
		isLoadingAccounts: state.status === "loading",
		loadAccounts,
	};
};
