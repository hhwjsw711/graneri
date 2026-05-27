import type { OAuthTokens } from "@ai-sdk/mcp";
import { validateRemoteMcpConnection } from "../packages/ai/src/remote-mcp-tools.mjs";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { oauthCallbackHtmlResponse } from "./oauthCallbackHtml";

type McpOAuthProvider = "figma" | "jira-mcp" | "linear" | "notion" | "posthog";

type McpSdkOAuthClient = {
	clientId: string;
	clientSecret?: string;
};

type McpSdkOAuthTokenResult = {
	accessToken: string;
	refreshToken?: string;
	expiresIn?: number;
};

type ProviderConfig = {
	displayName: string;
};

const PROVIDER_CONFIG: Record<McpOAuthProvider, ProviderConfig> = {
	figma: { displayName: "Figma" },
	"jira-mcp": { displayName: "Jira" },
	linear: { displayName: "Linear" },
	notion: { displayName: "Notion" },
	posthog: { displayName: "PostHog" },
};

const usesMcpSdkOAuth = (provider: McpOAuthProvider) =>
	provider === "figma" ||
	provider === "jira-mcp" ||
	provider === "linear" ||
	provider === "posthog";

const ensureUrlCanParse = () => {
	if (typeof URL.canParse === "function") {
		return;
	}

	URL.canParse = (value: string | URL, base?: string | URL) => {
		try {
			new URL(value, base);
			return true;
		} catch {
			return false;
		}
	};
};

const getMcpSdkAuth = async () => {
	ensureUrlCanParse();
	const { auth } = await import("@ai-sdk/mcp");
	return auth;
};

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const getConvexSiteUrl = () => process.env.CONVEX_SITE_URL?.trim() ?? "";

const getRedirectUri = (provider: McpOAuthProvider) =>
	`${getConvexSiteUrl()}/api/oauth/${provider}/callback`;

type McpTokenResponse = {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
};

const getMcpSdkClientMetadata = (redirectUri: string) => ({
	redirect_uris: [redirectUri],
	client_name: "OpenGran",
	grant_types: ["authorization_code", "refresh_token"],
	response_types: ["code"],
});

const toMcpSdkClientInformation = (client: McpSdkOAuthClient) => ({
	client_id: client.clientId,
	...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
});

const toMcpSdkTokenResult = (
	tokens: OAuthTokens | undefined,
	displayName: string,
	action: string,
): McpSdkOAuthTokenResult => {
	if (!tokens?.access_token) {
		throw new Error(`${displayName} OAuth ${action} failed.`);
	}

	return {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresIn: tokens.expires_in,
	};
};

export const startMcpSdkOAuth = async ({
	baseUrl,
	redirectUri,
	client,
	createState,
}: {
	baseUrl: string;
	redirectUri: string;
	client?: McpSdkOAuthClient;
	createState: () => string;
}) => {
	const auth = await getMcpSdkAuth();
	let authorizationUrl: string | undefined;
	let codeVerifier: string | undefined;
	let state: string | undefined;
	let currentClient = client ?? { clientId: "" };

	const result = await auth(
		{
			tokens: () => undefined,
			saveTokens: () => undefined,
			redirectToAuthorization: (url) => {
				authorizationUrl = url.toString();
			},
			saveCodeVerifier: (value) => {
				codeVerifier = value;
			},
			codeVerifier: () => codeVerifier ?? "",
			get redirectUrl() {
				return redirectUri;
			},
			get clientMetadata() {
				return getMcpSdkClientMetadata(redirectUri);
			},
			clientInformation: () =>
				currentClient.clientId
					? toMcpSdkClientInformation(currentClient)
					: undefined,
			saveClientInformation: (clientInformation) => {
				currentClient = {
					clientId: clientInformation.client_id,
					...(clientInformation.client_secret
						? { clientSecret: clientInformation.client_secret }
						: {}),
				};
			},
			state: () => {
				state = createState();
				return state;
			},
			saveState: (value) => {
				state = value;
			},
			validateResourceURL: async (serverUrl, resource) =>
				new URL(resource ?? serverUrl),
		},
		{ serverUrl: baseUrl },
	);

	if (
		result !== "REDIRECT" ||
		!authorizationUrl ||
		!codeVerifier ||
		!state ||
		!currentClient.clientId
	) {
		throw new Error("MCP OAuth did not produce an authorization URL.");
	}

	return {
		authorizationUrl,
		codeVerifier,
		state,
		client: currentClient,
	};
};

const exchangeMcpSdkOAuthCode = async ({
	baseUrl,
	redirectUri,
	client,
	code,
	codeVerifier,
	state,
	displayName,
}: {
	baseUrl: string;
	redirectUri: string;
	client: McpSdkOAuthClient;
	code: string;
	codeVerifier: string;
	state: string;
	displayName: string;
}) => {
	const auth = await getMcpSdkAuth();
	let oauthTokens: OAuthTokens | undefined;

	const result = await auth(
		{
			tokens: () => undefined,
			saveTokens: (tokens) => {
				oauthTokens = tokens;
			},
			redirectToAuthorization: () => undefined,
			saveCodeVerifier: () => undefined,
			codeVerifier: () => codeVerifier,
			get redirectUrl() {
				return redirectUri;
			},
			get clientMetadata() {
				return getMcpSdkClientMetadata(redirectUri);
			},
			clientInformation: () => toMcpSdkClientInformation(client),
			storedState: () => state,
			validateResourceURL: async (serverUrl, resource) =>
				new URL(resource ?? serverUrl),
		},
		{
			serverUrl: baseUrl,
			authorizationCode: code,
			callbackState: state,
		},
	);

	if (result !== "AUTHORIZED") {
		throw new Error(`${displayName} OAuth authorization failed.`);
	}

	return toMcpSdkTokenResult(oauthTokens, displayName, "token exchange");
};

export const refreshMcpSdkOAuthToken = async ({
	baseUrl,
	redirectUri,
	client,
	refreshToken,
	displayName,
}: {
	baseUrl: string;
	redirectUri: string;
	client: McpSdkOAuthClient;
	refreshToken: string;
	displayName: string;
}) => {
	const auth = await getMcpSdkAuth();
	let oauthTokens: OAuthTokens | undefined;

	const result = await auth(
		{
			tokens: () => ({
				access_token: "",
				token_type: "Bearer",
				refresh_token: refreshToken,
			}),
			saveTokens: (tokens) => {
				oauthTokens = tokens;
			},
			redirectToAuthorization: () => undefined,
			saveCodeVerifier: () => undefined,
			codeVerifier: () => "",
			get redirectUrl() {
				return redirectUri;
			},
			get clientMetadata() {
				return getMcpSdkClientMetadata(redirectUri);
			},
			clientInformation: () => toMcpSdkClientInformation(client),
			validateResourceURL: async (serverUrl, resource) =>
				new URL(resource ?? serverUrl),
		},
		{ serverUrl: baseUrl },
	);

	if (result !== "AUTHORIZED") {
		throw new Error(`${displayName} OAuth refresh failed.`);
	}

	return toMcpSdkTokenResult(oauthTokens, displayName, "refresh");
};

const exchangeMcpOAuthCode = async ({
	clientId,
	clientSecret,
	code,
	codeVerifier,
	redirectUri,
	tokenEndpoint,
	displayName,
}: {
	clientId: string;
	clientSecret?: string;
	code: string;
	codeVerifier: string;
	redirectUri: string;
	tokenEndpoint: string;
	displayName: string;
}) => {
	const params = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		client_id: clientId,
		redirect_uri: redirectUri,
		code_verifier: codeVerifier,
	});

	if (clientSecret) {
		params.set("client_secret", clientSecret);
	}

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": "OpenGran-MCP-Client/1.0",
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			`${displayName} OAuth token exchange failed (${response.status}).${responseText ? ` ${responseText}` : ""}`,
		);
	}

	const tokenResponse = (await response.json()) as McpTokenResponse;

	if (typeof tokenResponse.access_token !== "string") {
		throw new Error(
			`${displayName} OAuth token exchange did not return an access token.`,
		);
	}

	return {
		accessToken: tokenResponse.access_token,
		refreshToken:
			typeof tokenResponse.refresh_token === "string"
				? tokenResponse.refresh_token
				: undefined,
		expiresIn:
			typeof tokenResponse.expires_in === "number"
				? tokenResponse.expires_in
				: undefined,
	};
};

export const handleMcpOAuthCallbackRequest = async (
	ctx: ActionCtx,
	request: Request,
	provider: McpOAuthProvider,
) => {
	const { displayName } = PROVIDER_CONFIG[provider];
	const url = new URL(request.url);
	const code = url.searchParams.get("code")?.trim();
	const state = url.searchParams.get("state")?.trim();
	const error = url.searchParams.get("error")?.trim();
	const errorDescription = url.searchParams.get("error_description")?.trim();

	if (error) {
		return oauthCallbackHtmlResponse(
			`${displayName} connection failed`,
			errorDescription || error,
			400,
		);
	}

	if (!code || !state) {
		return jsonResponse(
			{ message: `Missing ${displayName} OAuth code or state.` },
			400,
		);
	}

	const pendingState = await ctx.runMutation(
		internal.appConnections.consumeMcpOAuthState,
		{ provider, state },
	);

	if (!pendingState || pendingState.expiresAt < Date.now()) {
		return oauthCallbackHtmlResponse(
			`${displayName} connection expired`,
			`Start the ${displayName} connection again.`,
			400,
		);
	}

	const redirectUri = getRedirectUri(provider);
	if (!redirectUri.startsWith("http")) {
		return oauthCallbackHtmlResponse(
			`${displayName} connection failed`,
			"CONVEX_SITE_URL is not configured.",
			500,
		);
	}

	if (
		!pendingState.codeVerifier ||
		(!usesMcpSdkOAuth(provider) && !pendingState.oauthTokenEndpoint)
	) {
		return oauthCallbackHtmlResponse(
			`${displayName} connection failed`,
			`${displayName} OAuth state is incomplete.`,
			500,
		);
	}

	try {
		const codeVerifier = pendingState.codeVerifier;
		if (!codeVerifier) {
			throw new Error(`${displayName} OAuth state is incomplete.`);
		}
		const tokenEndpoint = pendingState.oauthTokenEndpoint;
		const tokens = await (async () => {
			if (usesMcpSdkOAuth(provider)) {
				return await exchangeMcpSdkOAuthCode({
					baseUrl: pendingState.baseUrl,
					redirectUri,
					client: {
						clientId: pendingState.oauthClientId,
						...(pendingState.oauthClientSecret
							? { clientSecret: pendingState.oauthClientSecret }
							: {}),
					},
					code,
					codeVerifier,
					state: pendingState.state,
					displayName,
				});
			}

			if (!tokenEndpoint) {
				throw new Error(`${displayName} OAuth state is incomplete.`);
			}

			return await exchangeMcpOAuthCode({
				clientId: pendingState.oauthClientId,
				...(pendingState.oauthClientSecret
					? { clientSecret: pendingState.oauthClientSecret }
					: {}),
				code,
				codeVerifier,
				redirectUri,
				tokenEndpoint,
				displayName,
			});
		})();
		const env = pendingState.envJson
			? (JSON.parse(pendingState.envJson) as Record<string, string>)
			: undefined;

		await validateRemoteMcpConnection({
			provider,
			displayName,
			baseUrl: pendingState.baseUrl,
			...(env ? { env } : {}),
			oauthClientId: pendingState.oauthClientId,
			oauthAccessToken: tokens.accessToken,
		});

		const mutation =
			provider === "figma"
				? internal.appConnections.upsertFigma
				: provider === "jira-mcp"
					? internal.appConnections.upsertJiraMcp
					: provider === "linear"
						? internal.appConnections.upsertLinear
						: provider === "posthog"
							? internal.appConnections.upsertPostHog
							: internal.appConnections.upsertNotion;

		await ctx.runMutation(mutation, {
			ownerTokenIdentifier: pendingState.ownerTokenIdentifier,
			workspaceId: pendingState.workspaceId,
			displayName: pendingState.displayName,
			baseUrl: pendingState.baseUrl,
			...(env ? { env } : {}),
			oauthClientId: pendingState.oauthClientId,
			...(pendingState.oauthClientSecret
				? { oauthClientSecret: pendingState.oauthClientSecret }
				: {}),
			oauthAccessToken: tokens.accessToken,
			...(tokens.refreshToken ? { oauthRefreshToken: tokens.refreshToken } : {}),
			...(tokens.expiresIn
				? { tokenExpiresAt: Date.now() + tokens.expiresIn * 1000 }
				: {}),
		});
	} catch (connectionError) {
		console.error(`Failed to complete ${displayName} OAuth connection`, connectionError);
		return oauthCallbackHtmlResponse(
			`${displayName} connection failed`,
			`OpenGran could not complete the ${displayName} connection.`,
			500,
		);
	}

	return oauthCallbackHtmlResponse(
		`${displayName} connected`,
		"You can close this window and return to OpenGran.",
	);
};
