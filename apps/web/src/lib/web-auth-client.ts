import {
	convexClient,
	crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type {
	AuthClientError,
	AuthClientResponse,
	AuthSession,
	GraneriAuthClient,
	JsonWebKeySet,
} from "@/lib/graneri-auth-client";

const createConfiguredAuthClient = (baseURL: string) =>
	createAuthClient({
		baseURL,
		plugins: [convexClient(), crossDomainClient()],
	});

const normalizeAuthError = (error: unknown): AuthClientError | null => {
	if (!error || typeof error !== "object") {
		return null;
	}

	const errorRecord = error as {
		message?: unknown;
		status?: unknown;
		statusText?: unknown;
	};

	return {
		message:
			typeof errorRecord.message === "string"
				? errorRecord.message
				: "Authentication request failed.",
		status: typeof errorRecord.status === "number" ? errorRecord.status : 500,
		statusText:
			typeof errorRecord.statusText === "string"
				? errorRecord.statusText
				: "Authentication request failed.",
	};
};

const toAuthClientResponse = <TData>({
	data,
	error,
}: {
	data?: TData | null;
	error?: unknown;
}): Awaited<AuthClientResponse<TData>> => ({
	data: data ?? null,
	error: normalizeAuthError(error),
});

export const createWebGraneriAuthClient = (
	baseURL: string,
): GraneriAuthClient => {
	const webAuthClient = createConfiguredAuthClient(baseURL);

	return {
		$fetch: async <TResult>(path: string, options = {}) =>
			(await webAuthClient.$fetch(path, options)) as TResult,
		convex: {
			jwks: async (options) =>
				toAuthClientResponse<JsonWebKeySet>(
					await webAuthClient.convex.jwks({
						fetchOptions: options?.fetchOptions,
					}),
				),
			token: async (options) =>
				toAuthClientResponse<{ token: string }>(
					await webAuthClient.convex.token({
						fetchOptions: options?.fetchOptions,
					}),
				),
		},
		crossDomain: {
			oneTimeToken: {
				verify: async (args) =>
					toAuthClientResponse<AuthSession>(
						await webAuthClient.crossDomain.oneTimeToken.verify(args),
					),
			},
		},
		getSession: async (options) =>
			toAuthClientResponse<AuthSession>(
				await webAuthClient.getSession({
					fetchOptions: options?.fetchOptions,
				}),
			),
		signIn: {
			social: async (args) =>
				toAuthClientResponse<unknown>(await webAuthClient.signIn.social(args)),
		},
		signOut: async () =>
			toAuthClientResponse<{ success: boolean }>(await webAuthClient.signOut()),
		updateSession: () => {
			webAuthClient.updateSession();
		},
		updateUser: async (body) =>
			toAuthClientResponse<unknown>(await webAuthClient.updateUser(body)),
		useSession: () => {
			const session = webAuthClient.useSession();
			return {
				data: session.data,
				error: session.error ? new Error(session.error.message) : null,
				isPending: session.isPending,
				isRefetching: session.isRefetching,
				refetch: () => {
					void session.refetch();
				},
			};
		},
	};
};
