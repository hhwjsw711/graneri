import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import type { LinkedAccount } from "@/lib/google-integrations";

const linkedAccountsCache = new Map<string, LinkedAccount[]>();

export const useLinkedAccounts = (
	sessionUser: { email?: string | null } | null | undefined,
) => {
	const cacheKey = sessionUser?.email ?? null;
	const [accounts, setAccounts] = useState<LinkedAccount[]>(() =>
		cacheKey ? (linkedAccountsCache.get(cacheKey) ?? []) : [],
	);
	const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);

	// react-doctor-disable-next-line react-doctor/no-derived-state
	useEffect(() => {
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setAccounts(cacheKey ? (linkedAccountsCache.get(cacheKey) ?? []) : []);
	}, [cacheKey]);

	const loadAccounts = useCallback(async () => {
		if (!sessionUser) {
			setAccounts([]);
			return;
		}

		setIsLoadingAccounts(true);

		try {
			const result = await authClient.$fetch("/list-accounts", {
				method: "GET",
				throw: true,
			});
			const nextAccounts = Array.isArray(result)
				? (result as LinkedAccount[])
				: [];
			if (cacheKey) {
				linkedAccountsCache.set(cacheKey, nextAccounts);
			}
			setAccounts(nextAccounts);
		} catch (error) {
			console.error("Failed to load linked accounts", error);
			toast.error("Failed to load linked Google accounts");
		} finally {
			setIsLoadingAccounts(false);
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
		accounts,
		isLoadingAccounts,
		loadAccounts,
	};
};
