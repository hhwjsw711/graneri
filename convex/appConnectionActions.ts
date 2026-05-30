"use node";

import { createHash, randomBytes } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction } from "./_generated/server";
import {
	chatToolConnectionValidator,
	type ChatToolConnection,
} from "./appConnections";
import {
	DEFAULT_CONTEXT7_MCP_ENDPOINT,
	validateContext7McpConnection,
} from "../packages/ai/src/context7-tools.mjs";
import {
	DEFAULT_JIRA_MCP_ENDPOINT,
} from "../packages/ai/src/jira-mcp-tools.mjs";
import {
	DEFAULT_LINEAR_MCP_ENDPOINT,
} from "../packages/ai/src/linear-tools.mjs";
import {
	refreshMcpSdkOAuthToken,
	startMcpSdkOAuth,
} from "./mcpOAuth";
import {
	verifyYandexCalendarConnection,
	YANDEX_CALENDAR_SERVER_ADDRESS,
} from "./yandexCalendar";

const yandexTrackerOrgTypeValidator = v.union(
	v.literal("x-org-id"),
	v.literal("x-cloud-org-id"),
);

const yandexTrackerConnectionResultValidator = v.object({
	sourceId: v.string(),
	provider: v.literal("yandex-tracker"),
	status: v.union(v.literal("connected"), v.literal("disconnected")),
	displayName: v.string(),
	orgType: yandexTrackerOrgTypeValidator,
	orgId: v.string(),
});

const yandexCalendarConnectionResultValidator = v.object({
	sourceId: v.string(),
	provider: v.literal("yandex-calendar"),
	status: v.union(v.literal("connected"), v.literal("disconnected")),
	displayName: v.string(),
	email: v.string(),
	serverAddress: v.string(),
	calendarHomePath: v.string(),
});

const jiraConnectionResultValidator = v.object({
	sourceId: v.string(),
	provider: v.literal("jira"),
	status: v.union(v.literal("connected"), v.literal("disconnected")),
	displayName: v.string(),
	baseUrl: v.string(),
	email: v.string(),
	accountId: v.optional(v.string()),
	webhookSecret: v.optional(v.string()),
	lastWebhookReceivedAt: v.optional(v.number()),
	lastMentionSyncAt: v.optional(v.number()),
});

const zoomOAuthStartResultValidator = v.object({
	authorizationUrl: v.string(),
});

const mcpOAuthStartResultValidator = v.object({
	authorizationUrl: v.string(),
});

const remoteHeaderMcpConnectionResultValidator = <
	TProvider extends "context7",
>(
	provider: TProvider,
) =>
	v.object({
		sourceId: v.string(),
		provider: v.literal(provider),
		status: v.union(v.literal("connected"), v.literal("disconnected")),
		displayName: v.string(),
		endpoint: v.string(),
	});

type YandexTrackerConnectionResult = {
	sourceId: string;
	provider: "yandex-tracker";
	status: "connected" | "disconnected";
	displayName: string;
	orgType: "x-org-id" | "x-cloud-org-id";
	orgId: string;
};

type YandexCalendarConnectionResult = {
	sourceId: string;
	provider: "yandex-calendar";
	status: "connected" | "disconnected";
	displayName: string;
	email: string;
	serverAddress: string;
	calendarHomePath: string;
};

type JiraConnectionResult = {
	sourceId: string;
	provider: "jira";
	status: "connected" | "disconnected";
	displayName: string;
	baseUrl: string;
	email: string;
	accountId?: string;
	webhookSecret?: string;
	lastWebhookReceivedAt?: number;
	lastMentionSyncAt?: number;
};

type ZoomOAuthStartResult = {
	authorizationUrl: string;
};

type McpOAuthStartResult = {
	authorizationUrl: string;
};

type RemoteHeaderMcpConnectionResult<
	TProvider extends "context7",
> = {
	sourceId: string;
	provider: TProvider;
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
};

const ZOOM_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MCP_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const FIGMA_MCP_CLIENT_REVIEW_MESSAGE =
	"Figma only allows MCP clients listed in the Figma MCP Catalog to use the hosted remote server. Graneri needs Figma remote MCP access approval before this connection can be started.";

const getConvexSiteUrl = () => {
	const siteUrl = process.env.CONVEX_SITE_URL?.trim();

	if (!siteUrl) {
		throw new ConvexError({
			code: "OAUTH_NOT_CONFIGURED",
			message: "OAuth redirect URL is not configured.",
		});
	}

	return siteUrl.replace(/\/+$/u, "");
};

const getZoomOAuthRedirectUri = () =>
	`${getConvexSiteUrl()}/api/oauth/zoom/callback`;

const createMcpOAuthState = () => randomBytes(32).toString("hex");

const getMcpOAuthRedirectUri = (
	provider: "figma" | "jira-mcp" | "linear" | "notion" | "posthog",
) =>
	`${getConvexSiteUrl()}/api/oauth/${provider}/callback`;

const getZoomOAuthConfig = (overrides: {
	oauthClientId?: string;
	oauthClientSecret?: string;
}) => {
	const oauthClientId =
		overrides.oauthClientId?.trim() ||
		process.env.ZOOM_OAUTH_CLIENT_ID?.trim();
	const oauthClientSecret =
		overrides.oauthClientSecret?.trim() ||
		process.env.ZOOM_OAUTH_CLIENT_SECRET?.trim();

	if (!oauthClientId || !oauthClientSecret) {
		throw new ConvexError({
			code: "ZOOM_OAUTH_NOT_CONFIGURED",
			message: "Zoom OAuth is not configured.",
		});
	}

	return { oauthClientId, oauthClientSecret };
};

type ZoomRefreshResponse = {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
};

const refreshZoomOAuthToken = async ({
	clientId,
	clientSecret,
	refreshToken,
}: {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}) => {
	const tokenUrl = new URL("https://zoom.us/oauth/token");
	tokenUrl.searchParams.set("grant_type", "refresh_token");
	tokenUrl.searchParams.set("refresh_token", refreshToken);

	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
		},
	});

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			`Zoom OAuth refresh failed (${response.status}).${responseText ? ` ${responseText}` : ""}`,
		);
	}

	const tokenResponse = (await response.json()) as ZoomRefreshResponse;

	if (typeof tokenResponse.access_token !== "string") {
		throw new Error("Zoom OAuth refresh did not return an access token.");
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

const refreshZoomTokensForWorkspace = async (
	ctx: ActionCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const refreshSkewMs = 2 * 60 * 1000;
	const connections = await ctx.runQuery(
		internal.appConnections.getZoomOAuthConnectionsForWorkspace,
		{ ownerTokenIdentifier, workspaceId },
	);

	await Promise.all(
		connections
			.filter(
				(connection) =>
					!connection.tokenExpiresAt ||
					connection.tokenExpiresAt <= Date.now() + refreshSkewMs,
			)
			.map(async (connection) => {
				const tokens = await refreshZoomOAuthToken({
					clientId: connection.oauthClientId,
					clientSecret: connection.oauthClientSecret,
					refreshToken: connection.oauthRefreshToken,
				});

				await ctx.runMutation(internal.appConnections.updateZoomOAuthTokens, {
					connectionId: connection.connectionId,
					ownerTokenIdentifier: connection.ownerTokenIdentifier,
					workspaceId: connection.workspaceId,
					oauthAccessToken: tokens.accessToken,
					...(tokens.refreshToken
						? { oauthRefreshToken: tokens.refreshToken }
						: {}),
					...(tokens.expiresIn
						? { tokenExpiresAt: Date.now() + tokens.expiresIn * 1000 }
						: {}),
				});
			}),
	);
};

type OAuthMetadata = {
	authorization_endpoint?: unknown;
	token_endpoint?: unknown;
	registration_endpoint?: unknown;
};

type ProtectedResourceMetadata = {
	authorization_servers?: unknown;
};

type DynamicClientRegistrationResponse = {
	client_id?: unknown;
	client_secret?: unknown;
};

type McpOAuthTokenResponse = {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
};

const base64UrlEncode = (value: Buffer) =>
	value
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");

const createPkceVerifier = () => base64UrlEncode(randomBytes(32));

const createPkceChallenge = (verifier: string) =>
	base64UrlEncode(createHash("sha256").update(verifier).digest());

const discoverMcpOAuthMetadata = async (baseUrl: string, displayName: string) => {
	const mcpUrl = new URL(baseUrl);
	const resourceMetadataUrls = [
		new URL(`/.well-known/oauth-protected-resource${mcpUrl.pathname}`, mcpUrl),
		new URL("/.well-known/oauth-protected-resource", mcpUrl),
	];
	let resourceResponse: Response | undefined;

	for (const resourceMetadataUrl of resourceMetadataUrls) {
		resourceResponse = await fetch(resourceMetadataUrl, {
			headers: { Accept: "application/json" },
		});
		if (resourceResponse.ok) {
			break;
		}
	}

	if (!resourceResponse?.ok) {
		throw new Error(
			`${displayName} MCP OAuth resource discovery failed (${resourceResponse?.status ?? "unknown"}).`,
		);
	}

	const protectedResource =
		(await resourceResponse.json()) as ProtectedResourceMetadata;
	const authServerUrl =
		Array.isArray(protectedResource.authorization_servers) &&
		typeof protectedResource.authorization_servers[0] === "string"
			? protectedResource.authorization_servers[0]
			: "";

	if (!authServerUrl) {
		throw new Error(
			`${displayName} MCP OAuth discovery did not return an auth server.`,
		);
	}

	const authServer = new URL(authServerUrl);
	const authServerPath = authServer.pathname.replace(/\/$/u, "");
	const metadataUrls = [
		new URL(
			`/.well-known/oauth-authorization-server${authServerPath === "/" ? "" : authServerPath}`,
			authServer.origin,
		),
		new URL("/.well-known/oauth-authorization-server", authServer.origin),
	];
	let metadataResponse: Response | undefined;

	for (const metadataUrl of metadataUrls) {
		metadataResponse = await fetch(metadataUrl, {
			headers: { Accept: "application/json" },
		});
		if (metadataResponse.ok) {
			break;
		}
	}

	if (!metadataResponse?.ok) {
		throw new Error(
			`${displayName} MCP OAuth metadata discovery failed (${metadataResponse?.status ?? "unknown"}).`,
		);
	}

	const metadata = (await metadataResponse.json()) as OAuthMetadata;

	if (
		typeof metadata.authorization_endpoint !== "string" ||
		typeof metadata.token_endpoint !== "string" ||
		typeof metadata.registration_endpoint !== "string"
	) {
		throw new Error(
			`${displayName} MCP OAuth metadata is missing required endpoints.`,
		);
	}

	return {
		authorizationEndpoint: metadata.authorization_endpoint,
		tokenEndpoint: metadata.token_endpoint,
		registrationEndpoint: metadata.registration_endpoint,
	};
};

const registerMcpOAuthClient = async ({
	registrationEndpoint,
	redirectUri,
	displayName,
}: {
	registrationEndpoint: string;
	redirectUri: string;
	displayName: string;
}) => {
	const response = await fetch(registrationEndpoint, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_name: "Graneri",
			redirect_uris: [redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		}),
	});

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			`${displayName} MCP OAuth client registration failed (${response.status}).${responseText ? ` ${responseText}` : ""}`,
		);
	}

	const registration =
		(await response.json()) as DynamicClientRegistrationResponse;

	if (typeof registration.client_id !== "string") {
		throw new Error(
			`${displayName} MCP OAuth client registration did not return a client ID.`,
		);
	}

	return {
		clientId: registration.client_id,
		clientSecret:
			typeof registration.client_secret === "string"
				? registration.client_secret
				: undefined,
	};
};

const refreshMcpOAuthToken = async ({
	baseUrl,
	clientId,
	clientSecret,
	refreshToken,
	displayName,
}: {
	baseUrl: string;
	clientId: string;
	clientSecret?: string;
	refreshToken: string;
	displayName: string;
}) => {
	const { tokenEndpoint } = await discoverMcpOAuthMetadata(baseUrl, displayName);
	const params = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: clientId,
	});

	if (clientSecret) {
		params.set("client_secret", clientSecret);
	}

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": "Graneri-MCP-Client/1.0",
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			`${displayName} MCP OAuth refresh failed (${response.status}).${responseText ? ` ${responseText}` : ""}`,
		);
	}

	const tokenResponse = (await response.json()) as McpOAuthTokenResponse;

	if (typeof tokenResponse.access_token !== "string") {
		throw new Error(
			`${displayName} MCP OAuth refresh did not return an access token.`,
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

const refreshMcpTokensForWorkspace = async (
	ctx: ActionCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	provider: "figma" | "jira-mcp" | "linear" | "notion" | "posthog",
) => {
	const refreshSkewMs = 2 * 60 * 1000;
	const connections = await ctx.runQuery(
		internal.appConnections.getMcpOAuthConnectionsForWorkspace,
		{ ownerTokenIdentifier, workspaceId, provider },
	);
	const displayName =
		provider === "jira-mcp"
			? "Jira"
			: provider === "figma"
				? "Figma"
				: provider === "linear"
					? "Linear"
			: provider === "posthog"
				? "PostHog"
				: "Notion";

	await Promise.all(
		connections
			.filter(
				(connection) =>
					!connection.tokenExpiresAt ||
					connection.tokenExpiresAt <= Date.now() + refreshSkewMs,
			)
			.map(async (connection) => {
				const tokens =
					provider === "jira-mcp" ||
					provider === "posthog" ||
					provider === "figma" ||
					provider === "linear"
						? await refreshMcpSdkOAuthToken({
								baseUrl: connection.baseUrl,
								redirectUri: getMcpOAuthRedirectUri(provider),
								client: {
									clientId: connection.oauthClientId,
									...(connection.oauthClientSecret
										? { clientSecret: connection.oauthClientSecret }
										: {}),
								},
								refreshToken: connection.oauthRefreshToken,
								displayName,
							})
						: await refreshMcpOAuthToken({
								baseUrl: connection.baseUrl,
								clientId: connection.oauthClientId,
								...(connection.oauthClientSecret
									? { clientSecret: connection.oauthClientSecret }
									: {}),
								refreshToken: connection.oauthRefreshToken,
								displayName,
							});

				await ctx.runMutation(internal.appConnections.updateMcpOAuthTokens, {
					connectionId: connection.connectionId,
					ownerTokenIdentifier: connection.ownerTokenIdentifier,
					workspaceId: connection.workspaceId,
					provider,
					oauthAccessToken: tokens.accessToken,
					...(tokens.refreshToken
						? { oauthRefreshToken: tokens.refreshToken }
						: {}),
					...(tokens.expiresIn
						? { tokenExpiresAt: Date.now() + tokens.expiresIn * 1000 }
						: {}),
				});
			}),
	);
};

type JiraCurrentUserResponse = {
	accountId?: unknown;
};

const TRACKER_API_BASE_URL =
	process.env.TRACKER_API_BASE_URL ?? "https://api.tracker.yandex.net";

const normalizeJiraBaseUrl = (value: string) => {
	const trimmedValue = value.trim();

	let url: URL;

	try {
		url = new URL(trimmedValue);
	} catch {
		throw new ConvexError({
			code: "INVALID_CONNECTION_DETAILS",
			message: "Jira base URL must be a valid URL.",
		});
	}

	url.pathname = url.pathname.replace(/\/+$/, "");
	url.search = "";
	url.hash = "";

	return url.toString().replace(/\/$/, "");
};

const normalizeZoomMcpEndpoint = (value: string) => {
	const trimmedValue = value.trim();

	let url: URL;

	try {
		url = new URL(trimmedValue);
	} catch {
		throw new ConvexError({
			code: "INVALID_CONNECTION_DETAILS",
			message: "Zoom MCP endpoint must be a valid URL.",
		});
	}

	if (url.protocol !== "https:") {
		throw new ConvexError({
			code: "INVALID_CONNECTION_DETAILS",
			message: "Zoom MCP endpoint must use HTTPS.",
		});
	}

	url.hash = "";

	return url.toString();
};

const normalizeRemoteMcpEndpoint = (
	value: string,
	{
		provider,
		label,
	}: {
		provider:
			| "context7"
			| "figma"
			| "jira-mcp"
			| "linear"
			| "notion"
			| "posthog";
		label: string;
	},
) => {
	const trimmedValue = value.trim();

	if (!trimmedValue) {
		throw new ConvexError({
			code: `${provider.toUpperCase()}_MCP_ENDPOINT_REQUIRED`,
			message: `${label} MCP endpoint is required.`,
		});
	}

	let url: URL;

	try {
		url = new URL(trimmedValue);
	} catch {
		throw new ConvexError({
			code: `${provider.toUpperCase()}_MCP_ENDPOINT_INVALID`,
			message: `${label} MCP endpoint must be a valid URL.`,
		});
	}

	if (url.protocol !== "https:") {
		throw new ConvexError({
			code: `${provider.toUpperCase()}_MCP_ENDPOINT_INVALID`,
			message: `${label} MCP endpoint must use HTTPS.`,
		});
	}

	url.hash = "";
	return url.toString();
};

const getJiraAuthHeader = (email: string, token: string) =>
	`Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;

const getTrackerHeaderName = (
	orgType: "x-org-id" | "x-cloud-org-id",
): "X-Org-Id" | "X-Cloud-Org-Id" =>
	orgType === "x-cloud-org-id" ? "X-Cloud-Org-Id" : "X-Org-Id";

const requireIdentity = async (ctx: ActionCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to connect app integrations.",
		});
	}

	return identity;
};

const sanitizeRemoteMcpEnv = (env?: Record<string, string>) =>
	Object.fromEntries(
		Object.entries(env ?? {})
			.map(([key, value]) => [key.trim(), value] as const)
			.filter(([key, value]) => key.length > 0 && value.length > 0),
	);

const startRemoteMcpOAuthConnection = async ({
	ctx,
	args,
	provider,
	label,
	defaultEndpoint,
	errorCode,
	errorMessage,
}: {
	ctx: ActionCtx;
	args: {
		workspaceId: Id<"workspaces">;
		displayName: string;
		baseUrl: string;
		env?: Record<string, string>;
		oauthClientId?: string;
		oauthClientSecret?: string;
	};
	provider: "figma" | "jira-mcp" | "linear" | "posthog";
	label: string;
	defaultEndpoint: string;
	errorCode: string;
	errorMessage: string;
}): Promise<McpOAuthStartResult> => {
	const identity = await requireIdentity(ctx);
	const redirectUri = getMcpOAuthRedirectUri(provider);
	const baseUrl = normalizeRemoteMcpEndpoint(
		args.baseUrl.trim() || defaultEndpoint,
		{ provider, label },
	);
	const displayName = args.displayName.trim() || label;
	const env = sanitizeRemoteMcpEnv(args.env);
	const requestedOAuthClientId = args.oauthClientId?.trim() || undefined;
	const requestedOAuthClientSecret =
		args.oauthClientSecret?.trim() || undefined;

	if (!redirectUri.startsWith("http")) {
		throw new ConvexError({
			code: errorCode,
			message: `${label} OAuth is not configured.`,
		});
	}

	let client: { clientId: string; clientSecret?: string };
	let oauthStart: Awaited<ReturnType<typeof startMcpSdkOAuth>>;
	try {
		client = requestedOAuthClientId
			? {
					clientId: requestedOAuthClientId,
					...(requestedOAuthClientSecret
						? { clientSecret: requestedOAuthClientSecret }
						: {}),
				}
			: { clientId: "" };
		oauthStart = await startMcpSdkOAuth({
			baseUrl,
			redirectUri,
			client: client.clientId ? client : undefined,
			createState: createMcpOAuthState,
		});
		client = oauthStart.client;
	} catch (error) {
		console.error(`Failed to prepare ${label} MCP OAuth connection`, error);

		throw new ConvexError({
			code: errorCode,
			message: errorMessage,
		});
	}

	await ctx.runMutation(internal.appConnections.createMcpOAuthState, {
		provider,
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId: args.workspaceId,
		displayName,
		baseUrl,
		...(Object.keys(env).length > 0 ? { env } : {}),
		oauthClientId: client.clientId,
		...(client.clientSecret ? { oauthClientSecret: client.clientSecret } : {}),
		codeVerifier: oauthStart.codeVerifier,
		state: oauthStart.state,
		expiresAt: Date.now() + MCP_OAUTH_STATE_TTL_MS,
	});

	return { authorizationUrl: oauthStart.authorizationUrl };
};

const remoteHeaderMcpConfigs = {
	context7: {
		defaultEndpoint: DEFAULT_CONTEXT7_MCP_ENDPOINT,
		defaultName: "Context7",
		errorCode: "CONTEXT7_MCP_CONNECTION_FAILED",
		failedMessage: "Failed to connect Context7 MCP.",
		label: "Context7",
		validateConnection: validateContext7McpConnection,
		upsert: internal.appConnections.upsertContext7,
	},
} as const;

const connectRemoteHeaderMcp = async <
	TProvider extends keyof typeof remoteHeaderMcpConfigs,
>(
	ctx: ActionCtx,
	args: {
		workspaceId: Id<"workspaces">;
		displayName: string;
		baseUrl: string;
		env?: Record<string, string>;
	},
	provider: TProvider,
): Promise<RemoteHeaderMcpConnectionResult<TProvider>> => {
	const config = remoteHeaderMcpConfigs[provider];
	const identity = await requireIdentity(ctx);
	const baseUrl = normalizeRemoteMcpEndpoint(
		args.baseUrl.trim() || config.defaultEndpoint,
		{
			provider,
			label: config.label,
		},
	);
	const displayName = args.displayName.trim() || config.defaultName;
	const env = sanitizeRemoteMcpEnv(args.env);
	const envArgs = Object.keys(env).length > 0 ? { env } : {};

	await ctx.runQuery(internal.appConnections.assertWorkspaceAccess, {
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId: args.workspaceId,
	});

	try {
		await config.validateConnection({
			baseUrl,
			displayName,
			...envArgs,
		});
	} catch (error) {
		console.error(`Failed to validate ${config.label} MCP connection`, error);
		throw new ConvexError({
			code: config.errorCode,
			message: config.failedMessage,
		});
	}

	return (await ctx.runMutation(config.upsert, {
		ownerTokenIdentifier: identity.tokenIdentifier,
		workspaceId: args.workspaceId,
		displayName,
		baseUrl,
		...envArgs,
	})) as RemoteHeaderMcpConnectionResult<TProvider>;
};

export const connectYandexTracker = action({
	args: {
		workspaceId: v.id("workspaces"),
		orgType: yandexTrackerOrgTypeValidator,
		orgId: v.string(),
		token: v.string(),
	},
	returns: yandexTrackerConnectionResultValidator,
	handler: async (ctx, args): Promise<YandexTrackerConnectionResult> => {
		const identity = await requireIdentity(ctx);
		const orgId = args.orgId.trim();
		const token = args.token.trim();

		if (!orgId || !token) {
			throw new ConvexError({
				code: "INVALID_CONNECTION_DETAILS",
				message: "Organization ID and OAuth token are required.",
			});
		}

		const response = await fetch(`${TRACKER_API_BASE_URL}/v3/myself`, {
			headers: {
				Authorization: `OAuth ${token}`,
				[getTrackerHeaderName(args.orgType)]: orgId,
			},
		});

		if (!response.ok) {
			const responseText = await response.text().catch(() => "");
			throw new ConvexError({
				code: "TRACKER_CONNECTION_FAILED",
				message: responseText.trim()
					? `Failed to connect Yandex Tracker: ${responseText.trim()}`
					: `Failed to connect Yandex Tracker (${response.status}).`,
			});
		}

		return await ctx.runMutation(internal.appConnections.upsertYandexTracker, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			orgType: args.orgType,
			orgId,
			token,
		});
	},
});

export const connectYandexCalendar = action({
	args: {
		workspaceId: v.id("workspaces"),
		email: v.string(),
		password: v.string(),
	},
	returns: yandexCalendarConnectionResultValidator,
	handler: async (ctx, args): Promise<YandexCalendarConnectionResult> => {
		const identity = await requireIdentity(ctx);
		const email = args.email.trim().toLowerCase();
		const password = args.password.trim();

		if (!email || !password) {
			throw new ConvexError({
				code: "INVALID_CONNECTION_DETAILS",
				message: "Email and app password are required.",
			});
		}

		try {
			const verifiedConnection = await verifyYandexCalendarConnection({
				email,
				password,
				serverAddress: YANDEX_CALENDAR_SERVER_ADDRESS,
			});

			return await ctx.runMutation(
				internal.appConnections.upsertYandexCalendar,
				{
					ownerTokenIdentifier: identity.tokenIdentifier,
					workspaceId: args.workspaceId,
					email: verifiedConnection.email,
					password,
					serverAddress: verifiedConnection.serverAddress,
					calendarHomePath: verifiedConnection.calendarHomePath,
				},
			);
		} catch (error) {
			throw new ConvexError({
				code: "YANDEX_CALENDAR_CONNECTION_FAILED",
				message:
					error instanceof Error
						? error.message
						: "Failed to connect Yandex Calendar.",
			});
		}
	},
});

export const connectJira = action({
	args: {
		workspaceId: v.id("workspaces"),
		baseUrl: v.string(),
		email: v.string(),
		token: v.string(),
	},
	returns: jiraConnectionResultValidator,
	handler: async (ctx, args): Promise<JiraConnectionResult> => {
		const identity = await requireIdentity(ctx);
		const baseUrl = normalizeJiraBaseUrl(args.baseUrl);
		const email = args.email.trim().toLowerCase();
		const token = args.token.trim();

		if (!email || !token) {
			throw new ConvexError({
				code: "INVALID_CONNECTION_DETAILS",
				message: "Jira email and API token are required.",
			});
		}

		const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
			headers: {
				Authorization: getJiraAuthHeader(email, token),
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const responseText = await response.text().catch(() => "");
			throw new ConvexError({
				code: "JIRA_CONNECTION_FAILED",
				message: responseText.trim()
					? `Failed to connect Jira: ${responseText.trim()}`
					: `Failed to connect Jira (${response.status}).`,
			});
		}

		const currentUser = (await response
			.json()
			.catch(() => null)) as JiraCurrentUserResponse | null;
		const accountId =
			currentUser && typeof currentUser.accountId === "string"
				? currentUser.accountId
				: undefined;

		return await ctx.runMutation(internal.appConnections.upsertJira, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			baseUrl,
			email,
			token,
			...(accountId ? { accountId } : {}),
		});
	},
});

export const connectJiraMcp = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
	},
	returns: mcpOAuthStartResultValidator,
	handler: async (ctx, args): Promise<McpOAuthStartResult> => {
		const identity = await requireIdentity(ctx);
		const redirectUri = getMcpOAuthRedirectUri("jira-mcp");
		const baseUrl = normalizeRemoteMcpEndpoint(
			args.baseUrl.trim() || DEFAULT_JIRA_MCP_ENDPOINT,
			{
				provider: "jira-mcp",
				label: "Jira",
			},
		);
		const displayName = args.displayName.trim() || "Jira";
		const env = Object.fromEntries(
			Object.entries(args.env ?? {}).filter(
				([key, value]) => key.trim().length > 0 && value.length > 0,
			),
		);
		const requestedOAuthClientId = args.oauthClientId?.trim() || undefined;
		const requestedOAuthClientSecret =
			args.oauthClientSecret?.trim() || undefined;

		if (!redirectUri.startsWith("http")) {
			throw new ConvexError({
				code: "JIRA_MCP_OAUTH_NOT_CONFIGURED",
				message: "Jira OAuth is not configured.",
			});
		}

		let client: { clientId: string; clientSecret?: string };
		let oauthStart: Awaited<ReturnType<typeof startMcpSdkOAuth>>;
		try {
			client = requestedOAuthClientId
				? {
						clientId: requestedOAuthClientId,
						...(requestedOAuthClientSecret
							? { clientSecret: requestedOAuthClientSecret }
							: {}),
					}
				: { clientId: "" };
			oauthStart = await startMcpSdkOAuth({
				baseUrl,
				redirectUri,
				client: client.clientId ? client : undefined,
				createState: createMcpOAuthState,
			});
			client = oauthStart.client;
		} catch (error) {
			console.error("Failed to prepare Jira MCP OAuth connection", error);
			throw new ConvexError({
				code: "JIRA_MCP_OAUTH_NOT_CONFIGURED",
				message: "Failed to start Jira OAuth.",
			});
		}

		await ctx.runMutation(internal.appConnections.createMcpOAuthState, {
			provider: "jira-mcp",
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			displayName,
			baseUrl,
			...(Object.keys(env).length > 0 ? { env } : {}),
			oauthClientId: client.clientId,
			...(client.clientSecret
				? { oauthClientSecret: client.clientSecret }
				: {}),
			codeVerifier: oauthStart.codeVerifier,
			state: oauthStart.state,
			expiresAt: Date.now() + MCP_OAUTH_STATE_TTL_MS,
		});

		return { authorizationUrl: oauthStart.authorizationUrl };
	},
});

export const connectContext7 = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
	},
	returns: remoteHeaderMcpConnectionResultValidator("context7"),
	handler: async (
		ctx,
		args,
	): Promise<RemoteHeaderMcpConnectionResult<"context7">> =>
		await connectRemoteHeaderMcp(ctx, args, "context7"),
});

export const connectFigma = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
	},
	returns: mcpOAuthStartResultValidator,
	handler: async (): Promise<McpOAuthStartResult> => {
		throw new ConvexError({
			code: "FIGMA_MCP_CLIENT_REVIEW_REQUIRED",
			message: FIGMA_MCP_CLIENT_REVIEW_MESSAGE,
		});
	},
});

export const connectLinear = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
	},
	returns: mcpOAuthStartResultValidator,
	handler: async (ctx, args): Promise<McpOAuthStartResult> =>
		await startRemoteMcpOAuthConnection({
			ctx,
			args,
			provider: "linear",
			label: "Linear",
			defaultEndpoint: DEFAULT_LINEAR_MCP_ENDPOINT,
			errorCode: "LINEAR_MCP_OAUTH_NOT_CONFIGURED",
			errorMessage: "Failed to start Linear OAuth.",
		}),
});

export const connectPostHog = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
	},
	returns: mcpOAuthStartResultValidator,
	handler: async (ctx, args): Promise<McpOAuthStartResult> => {
		const identity = await requireIdentity(ctx);
		const redirectUri = getMcpOAuthRedirectUri("posthog");
		const baseUrl = normalizeRemoteMcpEndpoint(args.baseUrl, {
			provider: "posthog",
			label: "PostHog",
		});
		const displayName = args.displayName.trim() || "PostHog";
		const env = Object.fromEntries(
			Object.entries(args.env ?? {}).filter(
				([key, value]) => key.trim().length > 0 && value.length > 0,
			),
		);
		const requestedOAuthClientId = args.oauthClientId?.trim() || undefined;
		const requestedOAuthClientSecret =
			args.oauthClientSecret?.trim() || undefined;

		if (!redirectUri.startsWith("http")) {
			throw new ConvexError({
				code: "POSTHOG_OAUTH_NOT_CONFIGURED",
				message: "PostHog OAuth is not configured.",
			});
		}

		let client: { clientId: string; clientSecret?: string };
		let oauthStart: Awaited<ReturnType<typeof startMcpSdkOAuth>>;
		try {
			client = requestedOAuthClientId
				? {
						clientId: requestedOAuthClientId,
						...(requestedOAuthClientSecret
							? { clientSecret: requestedOAuthClientSecret }
							: {}),
					}
				: { clientId: "" };
			oauthStart = await startMcpSdkOAuth({
				baseUrl,
				redirectUri,
				client: client.clientId ? client : undefined,
				createState: createMcpOAuthState,
			});
			client = oauthStart.client;
		} catch (error) {
			console.error("Failed to prepare PostHog MCP OAuth connection", error);
			throw new ConvexError({
				code: "POSTHOG_OAUTH_NOT_CONFIGURED",
				message: "Failed to start PostHog OAuth.",
			});
		}

		await ctx.runMutation(internal.appConnections.createMcpOAuthState, {
			provider: "posthog",
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			displayName,
			baseUrl,
			...(Object.keys(env).length > 0 ? { env } : {}),
			oauthClientId: client.clientId,
			...(client.clientSecret
				? { oauthClientSecret: client.clientSecret }
				: {}),
			codeVerifier: oauthStart.codeVerifier,
			state: oauthStart.state,
			expiresAt: Date.now() + MCP_OAUTH_STATE_TTL_MS,
		});

		return { authorizationUrl: oauthStart.authorizationUrl };
	},
});

export const connectNotion = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
	},
	returns: mcpOAuthStartResultValidator,
	handler: async (ctx, args): Promise<McpOAuthStartResult> => {
		const identity = await requireIdentity(ctx);
		const redirectUri = getMcpOAuthRedirectUri("notion");
		const baseUrl = normalizeRemoteMcpEndpoint(args.baseUrl, {
			provider: "notion",
			label: "Notion",
		});
		const displayName = args.displayName.trim() || "Notion";
		const env = Object.fromEntries(
			Object.entries(args.env ?? {}).filter(
				([key, value]) => key.trim().length > 0 && value.length > 0,
			),
		);
		const requestedOAuthClientId = args.oauthClientId?.trim() || undefined;
		const requestedOAuthClientSecret =
			args.oauthClientSecret?.trim() || undefined;

		if (!redirectUri.startsWith("http")) {
			throw new ConvexError({
				code: "NOTION_OAUTH_NOT_CONFIGURED",
				message: "Notion OAuth is not configured.",
			});
		}

		let metadata: Awaited<ReturnType<typeof discoverMcpOAuthMetadata>>;
		let client: { clientId: string; clientSecret?: string };
		try {
			metadata = await discoverMcpOAuthMetadata(baseUrl, "Notion");
			client = requestedOAuthClientId
				? {
						clientId: requestedOAuthClientId,
						...(requestedOAuthClientSecret
							? { clientSecret: requestedOAuthClientSecret }
							: {}),
					}
				: await registerMcpOAuthClient({
						registrationEndpoint: metadata.registrationEndpoint,
						redirectUri,
						displayName: "Notion",
					});
		} catch (error) {
			console.error("Failed to prepare Notion MCP OAuth connection", error);
			throw new ConvexError({
				code: "NOTION_OAUTH_NOT_CONFIGURED",
				message: "Failed to start Notion OAuth.",
			});
		}

		const codeVerifier = createPkceVerifier();
		const codeChallenge = createPkceChallenge(codeVerifier);
		const state = createMcpOAuthState();

		await ctx.runMutation(internal.appConnections.createMcpOAuthState, {
			provider: "notion",
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			displayName,
			baseUrl,
			...(Object.keys(env).length > 0 ? { env } : {}),
			oauthClientId: client.clientId,
			...(client.clientSecret
				? { oauthClientSecret: client.clientSecret }
				: {}),
			oauthTokenEndpoint: metadata.tokenEndpoint,
			codeVerifier,
			state,
			expiresAt: Date.now() + MCP_OAUTH_STATE_TTL_MS,
		});

		const authorizationUrl = new URL(metadata.authorizationEndpoint);
		authorizationUrl.searchParams.set("response_type", "code");
		authorizationUrl.searchParams.set("client_id", client.clientId);
		authorizationUrl.searchParams.set("redirect_uri", redirectUri);
		authorizationUrl.searchParams.set("state", state);
		authorizationUrl.searchParams.set("code_challenge", codeChallenge);
		authorizationUrl.searchParams.set("code_challenge_method", "S256");
		authorizationUrl.searchParams.set("prompt", "consent");

		return { authorizationUrl: authorizationUrl.toString() };
	},
});

export const connectZoom = action({
	args: {
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
	},
	returns: zoomOAuthStartResultValidator,
	handler: async (ctx, args): Promise<ZoomOAuthStartResult> => {
		const identity = await requireIdentity(ctx);
		const baseUrl = normalizeZoomMcpEndpoint(args.baseUrl);
		const displayName = args.displayName.trim() || "Zoom";
		const { oauthClientId, oauthClientSecret } = getZoomOAuthConfig({
			oauthClientId: args.oauthClientId,
			oauthClientSecret: args.oauthClientSecret,
		});
		const env = Object.fromEntries(
			Object.entries(args.env ?? {}).filter(
				([key, value]) => key.trim().length > 0 && value.length > 0,
			),
		);

		const state = createMcpOAuthState();
		await ctx.runMutation(internal.appConnections.createMcpOAuthState, {
			provider: "zoom",
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			displayName,
			baseUrl,
			env,
			oauthClientId,
			oauthClientSecret,
			state,
			expiresAt: Date.now() + ZOOM_OAUTH_STATE_TTL_MS,
		});

		const authorizationUrl = new URL("https://zoom.us/oauth/authorize");
		authorizationUrl.searchParams.set("response_type", "code");
		authorizationUrl.searchParams.set("client_id", oauthClientId);
		authorizationUrl.searchParams.set("redirect_uri", getZoomOAuthRedirectUri());
		authorizationUrl.searchParams.set("state", state);

		return { authorizationUrl: authorizationUrl.toString() };
	},
});

export const getSelectedForChatWithFreshTokens = action({
	args: {
		workspaceId: v.id("workspaces"),
		sourceIds: v.array(v.string()),
	},
	returns: v.array(chatToolConnectionValidator),
	handler: async (ctx, args): Promise<ChatToolConnection[]> => {
		const identity = await requireIdentity(ctx);
		await Promise.all([
			refreshMcpTokensForWorkspace(
				ctx,
				identity.tokenIdentifier,
				args.workspaceId,
				"figma",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				identity.tokenIdentifier,
				args.workspaceId,
				"jira-mcp",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				identity.tokenIdentifier,
				args.workspaceId,
				"notion",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				identity.tokenIdentifier,
				args.workspaceId,
				"posthog",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				identity.tokenIdentifier,
				args.workspaceId,
				"linear",
			),
			refreshZoomTokensForWorkspace(
				ctx,
				identity.tokenIdentifier,
				args.workspaceId,
			),
		]);
		return await ctx.runQuery(
			internal.appConnections.getSelectedForChatInternal,
			{
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
				sourceIds: args.sourceIds,
			},
		);
	},
});

export const getSelectedForChatInternalWithFreshTokens = internalAction({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		sourceIds: v.array(v.string()),
	},
	returns: v.array(chatToolConnectionValidator),
	handler: async (ctx, args): Promise<ChatToolConnection[]> => {
		await Promise.all([
			refreshMcpTokensForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
				"figma",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
				"jira-mcp",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
				"notion",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
				"posthog",
			),
			refreshMcpTokensForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
				"linear",
			),
			refreshZoomTokensForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
			),
		]);
		return await ctx.runQuery(
			internal.appConnections.getSelectedForChatInternal,
			{
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				sourceIds: args.sourceIds,
			},
		);
	},
});

export const prepareJiraMentionSync = action({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const connection = await ctx.runQuery(
			internal.appConnections.getOwnedJiraConnectionInternal,
			{
				ownerTokenIdentifier: identity.tokenIdentifier,
				workspaceId: args.workspaceId,
			},
		);

		if (!connection) {
			return null;
		}

		let accountId = connection.accountId;

		if (!accountId) {
			const response = await fetch(`${connection.baseUrl}/rest/api/3/myself`, {
				headers: {
					Authorization: getJiraAuthHeader(connection.email, connection.token),
					Accept: "application/json",
				},
			});

			if (!response.ok) {
				const responseText = await response.text().catch(() => "");
				throw new ConvexError({
					code: "JIRA_CONNECTION_FAILED",
					message: responseText.trim()
						? `Failed to prepare Jira sync: ${responseText.trim()}`
						: `Failed to prepare Jira sync (${response.status}).`,
				});
			}

			const currentUser = (await response
				.json()
				.catch(() => null)) as JiraCurrentUserResponse | null;
			accountId =
				currentUser && typeof currentUser.accountId === "string"
					? currentUser.accountId
					: undefined;
		}

		await ctx.runMutation(internal.appConnections.ensureJiraSyncMetadata, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			...(accountId ? { accountId } : {}),
		});

		return null;
	},
});
