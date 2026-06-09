import { ConvexError, v } from "convex/values";
import { APP_SOURCE_PREFIX } from "../packages/ai/src/capability-metadata.mjs";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import {
	getDefaultAppConnectionDisplayName,
	getMcpAppConnectionPreviewLabel,
	isChatSourceAppConnectionProvider,
	requiresChatSourceToken,
} from "./appConnectionProviders";
import { enableYandexCalendarPreferenceForWorkspace } from "./calendarPreferences";

const yandexTrackerProviderValidator = v.literal("yandex-tracker");
const yandexCalendarProviderValidator = v.literal("yandex-calendar");
const jiraProviderValidator = v.literal("jira");
const jiraMcpProviderValidator = v.literal("jira-mcp");
const posthogProviderValidator = v.literal("posthog");
const notionProviderValidator = v.literal("notion");
const zoomProviderValidator = v.literal("zoom");
const context7ProviderValidator = v.literal("context7");
const figmaProviderValidator = v.literal("figma");
const linearProviderValidator = v.literal("linear");
const appConnectionStatusValidator = v.union(
	v.literal("connected"),
	v.literal("disconnected"),
);
const yandexTrackerOrgTypeValidator = v.union(
	v.literal("x-org-id"),
	v.literal("x-cloud-org-id"),
);

const yandexTrackerConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: yandexTrackerProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	orgType: yandexTrackerOrgTypeValidator,
	orgId: v.string(),
});

const yandexCalendarConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: yandexCalendarProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	email: v.string(),
	serverAddress: v.string(),
	calendarHomePath: v.string(),
});

const jiraConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: jiraProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	email: v.string(),
	accountId: v.optional(v.string()),
	webhookSecret: v.optional(v.string()),
	lastWebhookReceivedAt: v.optional(v.number()),
	lastMentionSyncAt: v.optional(v.number()),
});

const posthogConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: posthogProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
	oauthClientId: v.optional(v.string()),
});

const jiraMcpConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: jiraMcpProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
	oauthClientId: v.optional(v.string()),
});

const notionConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: notionProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
	oauthClientId: v.optional(v.string()),
});

const zoomConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: zoomProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
	oauthClientId: v.optional(v.string()),
});

const context7ConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: context7ProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
});

const figmaConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: figmaProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
	oauthClientId: v.optional(v.string()),
});

const linearConnectionSettingsValidator = v.object({
	sourceId: v.string(),
	provider: linearProviderValidator,
	status: appConnectionStatusValidator,
	displayName: v.string(),
	endpoint: v.string(),
	oauthClientId: v.optional(v.string()),
});

const yandexCalendarCredentialsValidator = v.union(
	v.object({
		provider: yandexCalendarProviderValidator,
		displayName: v.string(),
		email: v.string(),
		password: v.string(),
		serverAddress: v.string(),
		calendarHomePath: v.string(),
	}),
	v.null(),
);

const appConnectionSourceValidator = v.object({
	id: v.string(),
	title: v.string(),
	preview: v.string(),
	provider: v.union(
		yandexCalendarProviderValidator,
		yandexTrackerProviderValidator,
		jiraProviderValidator,
		jiraMcpProviderValidator,
		posthogProviderValidator,
		notionProviderValidator,
		zoomProviderValidator,
		context7ProviderValidator,
		figmaProviderValidator,
		linearProviderValidator,
	),
});

const yandexTrackerChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: yandexTrackerProviderValidator,
	displayName: v.string(),
	orgType: yandexTrackerOrgTypeValidator,
	orgId: v.string(),
	token: v.string(),
});

const yandexCalendarChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: yandexCalendarProviderValidator,
	displayName: v.string(),
	email: v.string(),
	password: v.string(),
	serverAddress: v.string(),
	calendarHomePath: v.string(),
});

const posthogChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: posthogProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
	oauthClientId: v.optional(v.string()),
	oauthAccessToken: v.string(),
});

const jiraMcpChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: jiraMcpProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
	oauthClientId: v.optional(v.string()),
	oauthAccessToken: v.string(),
});

const notionChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: notionProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
	oauthClientId: v.optional(v.string()),
	oauthAccessToken: v.string(),
});

const zoomChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: zoomProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
	oauthClientId: v.optional(v.string()),
	oauthAccessToken: v.string(),
});

const context7ChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: context7ProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
});

const figmaChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: figmaProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
	oauthClientId: v.optional(v.string()),
	oauthAccessToken: v.string(),
});

const linearChatToolConnectionValidator = v.object({
	sourceId: v.string(),
	provider: linearProviderValidator,
	displayName: v.string(),
	baseUrl: v.string(),
	env: v.optional(v.record(v.string(), v.string())),
	oauthClientId: v.optional(v.string()),
	oauthAccessToken: v.string(),
});

export const chatToolConnectionValidator = v.union(
	yandexCalendarChatToolConnectionValidator,
	yandexTrackerChatToolConnectionValidator,
	jiraMcpChatToolConnectionValidator,
	posthogChatToolConnectionValidator,
	notionChatToolConnectionValidator,
	zoomChatToolConnectionValidator,
	context7ChatToolConnectionValidator,
	figmaChatToolConnectionValidator,
	linearChatToolConnectionValidator,
);

const REMOVE_ALL_APP_CONNECTIONS_BATCH_SIZE = 100;

const jiraWebhookConnectionValidator = v.union(
	v.object({
		connectionId: v.id("appConnections"),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		baseUrl: v.string(),
		email: v.string(),
		token: v.string(),
		accountId: v.optional(v.string()),
	}),
	v.null(),
);

const zoomOAuthConnectionValidator = v.object({
	connectionId: v.id("appConnections"),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	baseUrl: v.string(),
	oauthClientId: v.string(),
	oauthClientSecret: v.string(),
	oauthRefreshToken: v.string(),
	tokenExpiresAt: v.optional(v.number()),
});

const mcpOAuthProviderValidator = v.union(
	figmaProviderValidator,
	linearProviderValidator,
	v.literal("notion"),
	v.literal("posthog"),
	v.literal("zoom"),
	jiraMcpProviderValidator,
);

const mcpOAuthConnectionValidator = v.object({
	connectionId: v.id("appConnections"),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	provider: mcpOAuthProviderValidator,
	baseUrl: v.string(),
	oauthClientId: v.string(),
	oauthClientSecret: v.optional(v.string()),
	oauthRefreshToken: v.string(),
	tokenExpiresAt: v.optional(v.number()),
});

type YandexTrackerConnectionSettings = {
	sourceId: string;
	provider: "yandex-tracker";
	status: "connected" | "disconnected";
	displayName: string;
	orgType: "x-org-id" | "x-cloud-org-id";
	orgId: string;
};

type YandexCalendarConnectionSettings = {
	sourceId: string;
	provider: "yandex-calendar";
	status: "connected" | "disconnected";
	displayName: string;
	email: string;
	serverAddress: string;
	calendarHomePath: string;
};

type JiraConnectionSettings = {
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

type JiraMcpConnectionSettings = {
	sourceId: string;
	provider: "jira-mcp";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type PostHogConnectionSettings = {
	sourceId: string;
	provider: "posthog";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
};

type NotionConnectionSettings = {
	sourceId: string;
	provider: "notion";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
};

type ZoomConnectionSettings = {
	sourceId: string;
	provider: "zoom";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type Context7ConnectionSettings = {
	sourceId: string;
	provider: "context7";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
};

type FigmaConnectionSettings = {
	sourceId: string;
	provider: "figma";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type LinearConnectionSettings = {
	sourceId: string;
	provider: "linear";
	status: "connected" | "disconnected";
	displayName: string;
	endpoint: string;
	oauthClientId?: string;
};

type RemoteHeaderMcpProvider = "context7";
type RemoteHeaderMcpConnectionSettings = Context7ConnectionSettings;

type ConnectionActivitySnapshot = {
	lastWebhookReceivedAt?: number;
	lastMentionSyncAt?: number;
};

type AppConnectionSource = {
	id: string;
	title: string;
	preview: string;
	provider:
		| "jira"
		| "jira-mcp"
		| "notion"
		| "posthog"
		| "zoom"
		| "context7"
		| "figma"
		| "linear"
		| "yandex-calendar"
		| "yandex-tracker";
};

export type ChatToolConnection =
	| {
			sourceId: string;
			provider: "yandex-calendar";
			displayName: string;
			email: string;
			password: string;
			serverAddress: string;
			calendarHomePath: string;
	  }
	| {
			sourceId: string;
			provider: "yandex-tracker";
			displayName: string;
			orgType: "x-org-id" | "x-cloud-org-id";
			orgId: string;
			token: string;
	  }
	| {
			sourceId: string;
			provider: "jira-mcp";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
			oauthClientId?: string;
			oauthAccessToken: string;
	  }
	| {
			sourceId: string;
			provider: "posthog";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
			oauthClientId?: string;
			oauthAccessToken: string;
	  }
	| {
			sourceId: string;
			provider: "notion";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
			oauthClientId?: string;
			oauthAccessToken: string;
	  }
	| {
			sourceId: string;
			provider: "zoom";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
			oauthClientId?: string;
			oauthAccessToken: string;
	  }
	| {
			sourceId: string;
			provider: "context7";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
	  }
	| {
			sourceId: string;
			provider: "figma";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
			oauthClientId?: string;
			oauthAccessToken: string;
	  }
	| {
			sourceId: string;
			provider: "linear";
			displayName: string;
			baseUrl: string;
			env?: Record<string, string>;
			oauthClientId?: string;
			oauthAccessToken: string;
	  };

const requireIdentity = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new ConvexError({
			code: "UNAUTHENTICATED",
			message: "You must be signed in to access app connections.",
		});
	}

	return identity;
};

const requireOwnedWorkspace = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const workspace = await ctx.db.get(workspaceId);

	if (!workspace || workspace.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "WORKSPACE_NOT_FOUND",
			message: "Workspace not found.",
		});
	}

	return workspace;
};

export const assertWorkspaceAccess = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		return null;
	},
});

const toAppSourceId = (id: Id<"appConnections">) => `${APP_SOURCE_PREFIX}${id}`;

const getProviderPreview = (connection: Doc<"appConnections">) => {
	switch (connection.provider) {
		case "yandex-calendar":
			return (
				connection.email ??
				getDefaultAppConnectionDisplayName(connection.provider)
			);
		case "jira":
			return getJiraSyncPreview(connection);
		case "jira-mcp":
		case "posthog":
		case "notion":
		case "zoom":
		case "context7":
		case "figma":
		case "linear":
			return getMcpPreview(
				connection,
				getMcpAppConnectionPreviewLabel(connection.provider),
			);
		case "yandex-tracker":
			return `${connection.orgType === "x-org-id" ? "Yandex 360" : "Yandex Cloud"} • Org ${connection.orgId}`;
	}
};

const getJiraSyncPreview = (connection: Doc<"appConnections">) => {
	if (!connection.baseUrl) {
		return connection.email ?? "Jira";
	}

	try {
		const hostname = new URL(connection.baseUrl).hostname;
		return connection.email ? `${hostname} • ${connection.email}` : hostname;
	} catch {
		return connection.email
			? `${connection.baseUrl} • ${connection.email}`
			: connection.baseUrl;
	}
};

const getMcpPreview = (
	connection: Doc<"appConnections">,
	defaultLabel: string,
) => {
	if (!connection.baseUrl) {
		return defaultLabel;
	}

	try {
		return new URL(connection.baseUrl).hostname;
	} catch {
		return connection.baseUrl;
	}
};

const parseConnectionEnv = (connection: Doc<"appConnections">) => {
	if (!connection.envJson) {
		return {};
	}

	const parsedEnv = JSON.parse(connection.envJson) as unknown;

	if (!parsedEnv || typeof parsedEnv !== "object" || Array.isArray(parsedEnv)) {
		return {};
	}

	const env = Object.fromEntries(
		Object.entries(parsedEnv).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" && entry[1].length > 0,
		),
	);

	return Object.keys(env).length > 0 ? { env } : {};
};

const generateWebhookSecret = () =>
	`${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;

const getOwnedConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	provider:
		| "jira"
		| "jira-mcp"
		| "notion"
		| "posthog"
		| "zoom"
		| "context7"
		| "figma"
		| "linear"
		| "yandex-calendar"
		| "yandex-tracker",
) =>
	await ctx.db
		.query("appConnections")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_provider", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("provider", provider),
		)
		.unique();

const getOwnedYandexTrackerConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await getOwnedConnection(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		"yandex-tracker",
	);

const getOwnedYandexCalendarConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await getOwnedConnection(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		"yandex-calendar",
	);

const getOwnedJiraConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "jira");

const getOwnedJiraMcpConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "jira-mcp");

const getOwnedPostHogConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "posthog");

const getOwnedNotionConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "notion");

const getOwnedZoomConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "zoom");

const getOwnedContext7Connection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "context7");

const getOwnedFigmaConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "figma");

const getOwnedLinearConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, "linear");

const getOwnedRemoteHeaderMcpConnection = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	provider: RemoteHeaderMcpProvider,
) => await getOwnedConnection(ctx, ownerTokenIdentifier, workspaceId, provider);

const getConnectionActivity = async (
	ctx: QueryCtx | MutationCtx,
	connectionId: Id<"appConnections">,
) =>
	await ctx.db
		.query("appConnectionActivities")
		.withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
		.unique();

const getConnectionActivitySnapshot = async (
	ctx: QueryCtx | MutationCtx,
	connectionId: Id<"appConnections">,
): Promise<ConnectionActivitySnapshot> => {
	const activity = await getConnectionActivity(ctx, connectionId);

	return {
		lastWebhookReceivedAt: activity?.lastWebhookReceivedAt,
		lastMentionSyncAt: activity?.lastMentionSyncAt,
	};
};

const upsertConnectionActivity = async (
	ctx: MutationCtx,
	connection: Doc<"appConnections">,
	patch: ConnectionActivitySnapshot,
) => {
	const activity = await getConnectionActivity(ctx, connection._id);
	const now = Date.now();

	if (activity) {
		await ctx.db.patch(activity._id, {
			...patch,
			updatedAt: now,
		});
		return;
	}

	await ctx.db.insert("appConnectionActivities", {
		connectionId: connection._id,
		ownerTokenIdentifier: connection.ownerTokenIdentifier,
		workspaceId: connection.workspaceId,
		...(patch.lastWebhookReceivedAt
			? { lastWebhookReceivedAt: patch.lastWebhookReceivedAt }
			: {}),
		...(patch.lastMentionSyncAt
			? { lastMentionSyncAt: patch.lastMentionSyncAt }
			: {}),
		createdAt: now,
		updatedAt: now,
	});
};

const deleteConnectionActivity = async (
	ctx: MutationCtx,
	connectionId: Id<"appConnections">,
) => {
	const activity = await getConnectionActivity(ctx, connectionId);

	if (activity) {
		await ctx.db.delete(activity._id);
	}
};

const toChatToolConnection = (
	connection: Doc<"appConnections"> | null,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
): ChatToolConnection | null => {
	if (
		!connection ||
		connection.ownerTokenIdentifier !== ownerTokenIdentifier ||
		connection.workspaceId !== workspaceId ||
		connection.status !== "connected"
	) {
		return null;
	}

	if (
		connection.provider === "yandex-calendar" &&
		connection.email &&
		connection.password &&
		connection.serverAddress &&
		connection.calendarHomePath
	) {
		return {
			sourceId: toAppSourceId(connection._id),
			provider: "yandex-calendar",
			displayName: connection.displayName,
			email: connection.email,
			password: connection.password,
			serverAddress: connection.serverAddress,
			calendarHomePath: connection.calendarHomePath,
		};
	}

	if (
		connection.provider === "yandex-tracker" &&
		connection.orgType &&
		connection.orgId &&
		connection.token
	) {
		return {
			sourceId: toAppSourceId(connection._id),
			provider: "yandex-tracker",
			displayName: connection.displayName,
			orgType: connection.orgType,
			orgId: connection.orgId,
			token: connection.token,
		};
	}

	if (
		(connection.provider === "figma" ||
			connection.provider === "jira-mcp" ||
			connection.provider === "linear" ||
			connection.provider === "posthog") &&
		connection.baseUrl &&
		connection.token
	) {
		return {
			sourceId: toAppSourceId(connection._id),
			provider: connection.provider,
			displayName: connection.displayName,
			baseUrl: connection.baseUrl,
			...parseConnectionEnv(connection),
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
			oauthAccessToken: connection.token,
		};
	}

	if (
		connection.provider === "notion" &&
		connection.baseUrl &&
		connection.token
	) {
		return {
			sourceId: toAppSourceId(connection._id),
			provider: "notion",
			displayName: connection.displayName,
			baseUrl: connection.baseUrl,
			...parseConnectionEnv(connection),
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
			oauthAccessToken: connection.token,
		};
	}

	if (
		connection.provider === "zoom" &&
		connection.baseUrl &&
		connection.token
	) {
		return {
			sourceId: toAppSourceId(connection._id),
			provider: "zoom",
			displayName: connection.displayName,
			baseUrl: connection.baseUrl,
			...parseConnectionEnv(connection),
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
			oauthAccessToken: connection.token,
		};
	}

	if (connection.provider === "context7" && connection.baseUrl) {
		return {
			sourceId: toAppSourceId(connection._id),
			provider: "context7",
			displayName: connection.displayName,
			baseUrl: connection.baseUrl,
			...parseConnectionEnv(connection),
		};
	}

	return null;
};

const normalizeConnectionId = (
	ctx: QueryCtx | MutationCtx,
	sourceId: string,
) => {
	if (!sourceId.startsWith(APP_SOURCE_PREFIX)) {
		return null;
	}

	return ctx.db.normalizeId(
		"appConnections",
		sourceId.slice(APP_SOURCE_PREFIX.length),
	);
};

export const listSources = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(appConnectionSourceValidator),
	handler: async (ctx, args): Promise<AppConnectionSource[]> => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connections = await ctx.db
			.query("appConnections")
			.withIndex(
				"by_ownerTokenIdentifier_and_workspaceId_and_status_and_updatedAt",
				(q) =>
					q
						.eq("ownerTokenIdentifier", identity.tokenIdentifier)
						.eq("workspaceId", args.workspaceId)
						.eq("status", "connected"),
			)
			.order("desc")
			.take(20);

		const sources: AppConnectionSource[] = [];

		for (const connection of connections) {
			if (requiresChatSourceToken(connection.provider) && !connection.token) {
				continue;
			}

			if (!isChatSourceAppConnectionProvider(connection.provider)) {
				continue;
			}

			sources.push({
				id: toAppSourceId(connection._id),
				title: connection.displayName,
				preview: getProviderPreview(connection),
				provider: connection.provider,
			});
		}

		return sources;
	},
});

export const getYandexTracker = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(yandexTrackerConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedYandexTrackerConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.orgType || !connection.orgId) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "yandex-tracker" as const,
			status: connection.status,
			displayName: connection.displayName,
			orgType: connection.orgType,
			orgId: connection.orgId,
		};
	},
});

export const getYandexCalendar = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(yandexCalendarConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedYandexCalendarConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (
			!connection?.email ||
			!connection.serverAddress ||
			!connection.calendarHomePath
		) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "yandex-calendar" as const,
			status: connection.status,
			displayName: connection.displayName,
			email: connection.email,
			serverAddress: connection.serverAddress,
			calendarHomePath: connection.calendarHomePath,
		};
	},
});

export const disableConnection = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		sourceId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		const connectionId = normalizeConnectionId(ctx, args.sourceId);
		if (!connectionId) {
			return null;
		}

		const connection = await ctx.db.get(connectionId);
		if (
			!connection ||
			connection.ownerTokenIdentifier !== identity.tokenIdentifier ||
			connection.workspaceId !== args.workspaceId
		) {
			return null;
		}

		await deleteConnectionActivity(ctx, connection._id);
		await ctx.db.delete(connection._id);

		return null;
	},
});

export const getJiraMcp = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(jiraMcpConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedJiraMcpConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl || !connection.token) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "jira-mcp" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
		};
	},
});

export const getJira = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(jiraConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedJiraConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl || !connection.email) {
			return null;
		}

		const activity = await getConnectionActivitySnapshot(ctx, connection._id);

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "jira" as const,
			status: connection.status,
			displayName: connection.displayName,
			baseUrl: connection.baseUrl,
			email: connection.email,
			...(connection.accountId ? { accountId: connection.accountId } : {}),
			...(connection.webhookSecret
				? { webhookSecret: connection.webhookSecret }
				: {}),
			...(activity.lastWebhookReceivedAt
				? { lastWebhookReceivedAt: activity.lastWebhookReceivedAt }
				: {}),
			...(activity.lastMentionSyncAt
				? { lastMentionSyncAt: activity.lastMentionSyncAt }
				: {}),
		};
	},
});

export const getPostHog = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(posthogConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedPostHogConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl || !connection.token) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "posthog" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
		};
	},
});

export const getNotion = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(notionConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedNotionConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "notion" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
		};
	},
});

export const getZoom = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(zoomConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedZoomConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "zoom" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
		};
	},
});

export const getContext7 = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(context7ConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedContext7Connection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "context7" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
		};
	},
});

export const getFigma = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(figmaConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedFigmaConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "figma" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
		};
	},
});

export const getLinear = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.union(linearConnectionSettingsValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedLinearConnection(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl) {
			return null;
		}

		return {
			sourceId: toAppSourceId(connection._id),
			provider: "linear" as const,
			status: connection.status,
			displayName: connection.displayName,
			endpoint: connection.baseUrl,
			...(connection.accountId ? { oauthClientId: connection.accountId } : {}),
		};
	},
});

export const getOwnedJiraConnectionInternal = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: jiraWebhookConnectionValidator,
	handler: async (ctx, args) => {
		const connection = await getOwnedJiraConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (!connection?.baseUrl || !connection.email || !connection.token) {
			return null;
		}

		return {
			connectionId: connection._id,
			ownerTokenIdentifier: connection.ownerTokenIdentifier,
			workspaceId: connection.workspaceId,
			baseUrl: connection.baseUrl,
			email: connection.email,
			token: connection.token,
			...(connection.accountId ? { accountId: connection.accountId } : {}),
		};
	},
});

export const getJiraWebhookConnection = internalQuery({
	args: {
		sourceId: v.string(),
		webhookSecret: v.string(),
	},
	returns: jiraWebhookConnectionValidator,
	handler: async (ctx, args) => {
		const connectionId = normalizeConnectionId(ctx, args.sourceId);

		if (!connectionId) {
			return null;
		}

		const connection = await ctx.db.get(connectionId);

		if (
			!connection ||
			connection.provider !== "jira" ||
			connection.status !== "connected" ||
			!connection.baseUrl ||
			!connection.email ||
			!connection.token ||
			!connection.webhookSecret ||
			connection.webhookSecret !== args.webhookSecret
		) {
			return null;
		}

		return {
			connectionId: connection._id,
			ownerTokenIdentifier: connection.ownerTokenIdentifier,
			workspaceId: connection.workspaceId,
			baseUrl: connection.baseUrl,
			email: connection.email,
			token: connection.token,
			...(connection.accountId ? { accountId: connection.accountId } : {}),
		};
	},
});

export const getZoomOAuthConnectionsForWorkspace = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(zoomOAuthConnectionValidator),
	handler: async (ctx, args) => {
		const connections = await ctx.db
			.query("appConnections")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_provider", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("provider", "zoom"),
			)
			.take(10);

		return connections
			.filter(
				(connection) =>
					connection.status === "connected" &&
					connection.baseUrl &&
					connection.accountId &&
					connection.oauthClientSecret &&
					connection.oauthRefreshToken,
			)
			.map((connection) => ({
				connectionId: connection._id,
				ownerTokenIdentifier: connection.ownerTokenIdentifier,
				workspaceId: connection.workspaceId,
				baseUrl: connection.baseUrl as string,
				oauthClientId: connection.accountId as string,
				oauthClientSecret: connection.oauthClientSecret as string,
				oauthRefreshToken: connection.oauthRefreshToken as string,
				...(connection.tokenExpiresAt
					? { tokenExpiresAt: connection.tokenExpiresAt }
					: {}),
			}));
	},
});

export const getMcpOAuthConnectionsForWorkspace = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		provider: mcpOAuthProviderValidator,
	},
	returns: v.array(mcpOAuthConnectionValidator),
	handler: async (ctx, args) => {
		const connections = await ctx.db
			.query("appConnections")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_provider", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("provider", args.provider),
			)
			.take(10);

		return connections
			.filter(
				(connection) =>
					connection.status === "connected" &&
					connection.baseUrl &&
					connection.accountId &&
					connection.oauthRefreshToken,
			)
			.map((connection) => ({
				connectionId: connection._id,
				ownerTokenIdentifier: connection.ownerTokenIdentifier,
				workspaceId: connection.workspaceId,
				provider: args.provider,
				baseUrl: connection.baseUrl as string,
				oauthClientId: connection.accountId as string,
				...(connection.oauthClientSecret
					? { oauthClientSecret: connection.oauthClientSecret }
					: {}),
				oauthRefreshToken: connection.oauthRefreshToken as string,
				...(connection.tokenExpiresAt
					? { tokenExpiresAt: connection.tokenExpiresAt }
					: {}),
			}));
	},
});

export const updateZoomOAuthTokens = internalMutation({
	args: {
		connectionId: v.id("appConnections"),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const connection = await ctx.db.get(args.connectionId);

		if (
			!connection ||
			connection.provider !== "zoom" ||
			connection.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
			connection.workspaceId !== args.workspaceId
		) {
			return null;
		}

		await ctx.db.patch(connection._id, {
			token: args.oauthAccessToken,
			...(args.oauthRefreshToken
				? { oauthRefreshToken: args.oauthRefreshToken }
				: {}),
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const updateMcpOAuthTokens = internalMutation({
	args: {
		connectionId: v.id("appConnections"),
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		provider: mcpOAuthProviderValidator,
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const connection = await ctx.db.get(args.connectionId);

		if (
			!connection ||
			connection.provider !== args.provider ||
			connection.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
			connection.workspaceId !== args.workspaceId
		) {
			return null;
		}

		await ctx.db.patch(connection._id, {
			token: args.oauthAccessToken,
			...(args.oauthRefreshToken
				? { oauthRefreshToken: args.oauthRefreshToken }
				: {}),
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const getSelectedForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		sourceIds: v.array(v.string()),
	},
	returns: v.array(chatToolConnectionValidator),
	handler: async (ctx, args): Promise<ChatToolConnection[]> => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const normalizedIds = args.sourceIds
			.map((sourceId) => normalizeConnectionId(ctx, sourceId))
			.filter(
				(id, index, values): id is Id<"appConnections"> =>
					Boolean(id) && values.indexOf(id) === index,
			);

		if (normalizedIds.length === 0) {
			return [];
		}

		const connections = await Promise.all(
			normalizedIds.map((id) => ctx.db.get(id)),
		);

		return connections
			.map((connection) =>
				toChatToolConnection(
					connection,
					identity.tokenIdentifier,
					args.workspaceId,
				),
			)
			.filter((connection): connection is ChatToolConnection =>
				Boolean(connection),
			);
	},
});

export const getSelectedForChatInternal = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		sourceIds: v.array(v.string()),
	},
	returns: v.array(chatToolConnectionValidator),
	handler: async (ctx, args): Promise<ChatToolConnection[]> => {
		const normalizedIds = args.sourceIds
			.map((sourceId) => normalizeConnectionId(ctx, sourceId))
			.filter(
				(id, index, values): id is Id<"appConnections"> =>
					Boolean(id) && values.indexOf(id) === index,
			);

		if (normalizedIds.length === 0) {
			return [];
		}

		const connections = await Promise.all(
			normalizedIds.map((id) => ctx.db.get(id)),
		);

		return connections
			.map((connection) =>
				toChatToolConnection(
					connection,
					args.ownerTokenIdentifier,
					args.workspaceId,
				),
			)
			.filter((connection): connection is ChatToolConnection =>
				Boolean(connection),
			);
	},
});

export const getYandexCalendarCredentials = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: yandexCalendarCredentialsValidator,
	handler: async (ctx, args) => {
		const connection = await getOwnedYandexCalendarConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (
			!connection ||
			connection.status !== "connected" ||
			!connection.email ||
			!connection.password ||
			!connection.serverAddress ||
			!connection.calendarHomePath
		) {
			return null;
		}

		return {
			provider: "yandex-calendar" as const,
			displayName: connection.displayName,
			email: connection.email,
			password: connection.password,
			serverAddress: connection.serverAddress,
			calendarHomePath: connection.calendarHomePath,
		};
	},
});

const deleteConnectionBatchForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const connections = await ctx.db
		.query("appConnections")
		.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_APP_CONNECTIONS_BATCH_SIZE);

	await Promise.all(
		connections.map(async (connection) => {
			await deleteConnectionActivity(ctx, connection._id);
			await ctx.db.delete(connection._id);
		}),
	);

	return {
		deletedCount: connections.length,
		hasMore: connections.length === REMOVE_ALL_APP_CONNECTIONS_BATCH_SIZE,
	};
};

const deleteConnectionBatchForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const connections = await ctx.db
		.query("appConnections")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(REMOVE_ALL_APP_CONNECTIONS_BATCH_SIZE);

	await Promise.all(
		connections.map(async (connection) => {
			await deleteConnectionActivity(ctx, connection._id);
			await ctx.db.delete(connection._id);
		}),
	);

	return {
		deletedCount: connections.length,
		hasMore: connections.length === REMOVE_ALL_APP_CONNECTIONS_BATCH_SIZE,
	};
};

export const upsertYandexTracker = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		orgType: yandexTrackerOrgTypeValidator,
		orgId: v.string(),
		token: v.string(),
	},
	returns: yandexTrackerConnectionSettingsValidator,
	handler: async (ctx, args): Promise<YandexTrackerConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const orgId = args.orgId.trim();
		const token = args.token.trim();
		const existingConnection = await getOwnedYandexTrackerConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (existingConnection) {
			await ctx.db.patch(existingConnection._id, {
				status: "connected",
				displayName: "Yandex Tracker",
				orgType: args.orgType,
				orgId,
				token,
				updatedAt: now,
			});

			return {
				sourceId: toAppSourceId(existingConnection._id),
				provider: "yandex-tracker" as const,
				status: "connected" as const,
				displayName: "Yandex Tracker",
				orgType: args.orgType,
				orgId,
			};
		}

		const id = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			provider: "yandex-tracker",
			status: "connected",
			displayName: "Yandex Tracker",
			orgType: args.orgType,
			orgId,
			token,
			createdAt: now,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(id),
			provider: "yandex-tracker" as const,
			status: "connected" as const,
			displayName: "Yandex Tracker",
			orgType: args.orgType,
			orgId,
		};
	},
});

export const upsertYandexCalendar = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		email: v.string(),
		password: v.string(),
		serverAddress: v.string(),
		calendarHomePath: v.string(),
	},
	returns: yandexCalendarConnectionSettingsValidator,
	handler: async (ctx, args): Promise<YandexCalendarConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const email = args.email.trim().toLowerCase();
		const password = args.password.trim();
		const serverAddress = args.serverAddress.trim();
		const calendarHomePath = args.calendarHomePath.trim();
		const existingConnection = await getOwnedYandexCalendarConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		let connectionId: Id<"appConnections">;

		if (existingConnection) {
			await ctx.db.patch(existingConnection._id, {
				status: "connected",
				displayName: "Yandex Calendar",
				email,
				password,
				serverAddress,
				calendarHomePath,
				updatedAt: now,
			});
			connectionId = existingConnection._id;
		} else {
			connectionId = await ctx.db.insert("appConnections", {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				provider: "yandex-calendar",
				status: "connected",
				displayName: "Yandex Calendar",
				email,
				password,
				serverAddress,
				calendarHomePath,
				createdAt: now,
				updatedAt: now,
			});
		}

		await enableYandexCalendarPreferenceForWorkspace(ctx, {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
		});

		return {
			sourceId: toAppSourceId(connectionId),
			provider: "yandex-calendar" as const,
			status: "connected" as const,
			displayName: "Yandex Calendar",
			email,
			serverAddress,
			calendarHomePath,
		};
	},
});

export const ensureJiraSyncMetadata = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		accountId: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const connection = await getOwnedJiraConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (!connection) {
			return null;
		}

		const patch: Partial<Doc<"appConnections">> = {};

		if (!connection.webhookSecret) {
			patch.webhookSecret = generateWebhookSecret();
		}

		if (args.accountId && connection.accountId !== args.accountId) {
			patch.accountId = args.accountId;
		}

		if (Object.keys(patch).length > 0) {
			patch.updatedAt = Date.now();
			await ctx.db.patch(connection._id, patch);
		}

		return null;
	},
});

export const recordJiraWebhookActivity = internalMutation({
	args: {
		connectionId: v.id("appConnections"),
		lastWebhookReceivedAt: v.number(),
		lastMentionSyncAt: v.optional(v.number()),
		accountId: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const connection = await ctx.db.get(args.connectionId);

		if (!connection || connection.provider !== "jira") {
			return null;
		}

		await upsertConnectionActivity(ctx, connection, {
			lastWebhookReceivedAt: args.lastWebhookReceivedAt,
			...(args.lastMentionSyncAt
				? { lastMentionSyncAt: args.lastMentionSyncAt }
				: {}),
		});

		if (args.accountId && connection.accountId !== args.accountId) {
			await ctx.db.patch(connection._id, {
				accountId: args.accountId,
				updatedAt: Date.now(),
			});
		}

		return null;
	},
});

export const upsertJira = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		baseUrl: v.string(),
		email: v.string(),
		token: v.string(),
		accountId: v.optional(v.string()),
	},
	returns: jiraConnectionSettingsValidator,
	handler: async (ctx, args): Promise<JiraConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const baseUrl = args.baseUrl.trim();
		const email = args.email.trim().toLowerCase();
		const token = args.token.trim();
		const accountId = args.accountId?.trim() || undefined;
		const existingConnection = await getOwnedJiraConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (existingConnection) {
			const webhookSecret =
				existingConnection.webhookSecret ?? generateWebhookSecret();
			const activity = await getConnectionActivitySnapshot(
				ctx,
				existingConnection._id,
			);
			const patch: Partial<Doc<"appConnections">> = {
				status: "connected",
				displayName: "Jira Sync",
				baseUrl,
				email,
				token,
				webhookSecret,
				updatedAt: now,
			};

			if (accountId) {
				patch.accountId = accountId;
			}

			await ctx.db.patch(existingConnection._id, patch);

			return {
				sourceId: toAppSourceId(existingConnection._id),
				provider: "jira" as const,
				status: "connected" as const,
				displayName: "Jira Sync",
				baseUrl,
				email,
				webhookSecret,
				...(activity.lastWebhookReceivedAt
					? { lastWebhookReceivedAt: activity.lastWebhookReceivedAt }
					: {}),
				...(activity.lastMentionSyncAt
					? { lastMentionSyncAt: activity.lastMentionSyncAt }
					: {}),
				...(accountId ? { accountId } : {}),
			};
		}

		const webhookSecret = generateWebhookSecret();
		const id = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			provider: "jira",
			status: "connected",
			displayName: "Jira Sync",
			baseUrl,
			email,
			token,
			webhookSecret,
			...(accountId ? { accountId } : {}),
			createdAt: now,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(id),
			provider: "jira" as const,
			status: "connected" as const,
			displayName: "Jira Sync",
			baseUrl,
			email,
			webhookSecret,
			...(accountId ? { accountId } : {}),
		};
	},
});

export const upsertJiraMcp = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: jiraMcpConnectionSettingsValidator,
	handler: async (ctx, args): Promise<JiraMcpConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const displayName =
			args.displayName.trim() || getDefaultAppConnectionDisplayName("jira-mcp");
		const baseUrl = args.baseUrl.trim();
		const envJson = args.env ? JSON.stringify(args.env) : undefined;
		const oauthClientId = args.oauthClientId?.trim() || undefined;
		const oauthClientSecret = args.oauthClientSecret?.trim() || undefined;
		const oauthRefreshToken = args.oauthRefreshToken?.trim() || undefined;
		const existingConnection = await getOwnedJiraMcpConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (existingConnection) {
			await ctx.db.patch(existingConnection._id, {
				status: "connected",
				displayName,
				baseUrl,
				envJson,
				...(oauthClientId ? { accountId: oauthClientId } : {}),
				...(oauthClientSecret ? { oauthClientSecret } : {}),
				token: args.oauthAccessToken,
				...(oauthRefreshToken ? { oauthRefreshToken } : {}),
				tokenExpiresAt: args.tokenExpiresAt,
				updatedAt: now,
			});

			return {
				sourceId: toAppSourceId(existingConnection._id),
				provider: "jira-mcp" as const,
				status: "connected" as const,
				displayName,
				endpoint: baseUrl,
				...(oauthClientId ? { oauthClientId } : {}),
			};
		}

		const id = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			provider: "jira-mcp",
			status: "connected",
			displayName,
			baseUrl,
			...(envJson ? { envJson } : {}),
			...(oauthClientId ? { accountId: oauthClientId } : {}),
			...(oauthClientSecret ? { oauthClientSecret } : {}),
			token: args.oauthAccessToken,
			...(oauthRefreshToken ? { oauthRefreshToken } : {}),
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			createdAt: now,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(id),
			provider: "jira-mcp" as const,
			status: "connected" as const,
			displayName,
			endpoint: baseUrl,
			...(oauthClientId ? { oauthClientId } : {}),
		};
	},
});

export const upsertPostHog = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: posthogConnectionSettingsValidator,
	handler: async (ctx, args): Promise<PostHogConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const displayName =
			args.displayName.trim() || getDefaultAppConnectionDisplayName("posthog");
		const baseUrl = args.baseUrl.trim();
		const envJson = args.env ? JSON.stringify(args.env) : undefined;
		const oauthClientId = args.oauthClientId?.trim() || undefined;
		const oauthClientSecret = args.oauthClientSecret?.trim() || undefined;
		const oauthRefreshToken = args.oauthRefreshToken?.trim() || undefined;
		const existingConnection = await getOwnedPostHogConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (existingConnection) {
			await ctx.db.patch(existingConnection._id, {
				status: "connected",
				displayName,
				baseUrl,
				envJson,
				...(oauthClientId ? { accountId: oauthClientId } : {}),
				...(oauthClientSecret ? { oauthClientSecret } : {}),
				token: args.oauthAccessToken,
				...(oauthRefreshToken ? { oauthRefreshToken } : {}),
				tokenExpiresAt: args.tokenExpiresAt,
				updatedAt: now,
			});

			return {
				sourceId: toAppSourceId(existingConnection._id),
				provider: "posthog" as const,
				status: "connected" as const,
				displayName,
				endpoint: baseUrl,
				...(oauthClientId ? { oauthClientId } : {}),
			};
		}

		const id = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			provider: "posthog",
			status: "connected",
			displayName,
			baseUrl,
			...(envJson ? { envJson } : {}),
			...(oauthClientId ? { accountId: oauthClientId } : {}),
			...(oauthClientSecret ? { oauthClientSecret } : {}),
			token: args.oauthAccessToken,
			...(oauthRefreshToken ? { oauthRefreshToken } : {}),
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			createdAt: now,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(id),
			provider: "posthog" as const,
			status: "connected" as const,
			displayName,
			endpoint: baseUrl,
			...(oauthClientId ? { oauthClientId } : {}),
		};
	},
});

export const upsertNotion = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: notionConnectionSettingsValidator,
	handler: async (ctx, args): Promise<NotionConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const displayName =
			args.displayName.trim() || getDefaultAppConnectionDisplayName("notion");
		const baseUrl = args.baseUrl.trim();
		const envJson = args.env ? JSON.stringify(args.env) : undefined;
		const oauthClientId = args.oauthClientId?.trim() || undefined;
		const oauthClientSecret = args.oauthClientSecret?.trim() || undefined;
		const oauthRefreshToken = args.oauthRefreshToken?.trim() || undefined;
		const existingConnection = await getOwnedNotionConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (existingConnection) {
			await ctx.db.patch(existingConnection._id, {
				status: "connected",
				displayName,
				baseUrl,
				envJson,
				...(oauthClientId ? { accountId: oauthClientId } : {}),
				...(oauthClientSecret ? { oauthClientSecret } : {}),
				token: args.oauthAccessToken,
				...(oauthRefreshToken ? { oauthRefreshToken } : {}),
				tokenExpiresAt: args.tokenExpiresAt,
				updatedAt: now,
			});

			return {
				sourceId: toAppSourceId(existingConnection._id),
				provider: "notion" as const,
				status: "connected" as const,
				displayName,
				endpoint: baseUrl,
				...(oauthClientId ? { oauthClientId } : {}),
			};
		}

		const id = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			provider: "notion",
			status: "connected",
			displayName,
			baseUrl,
			...(envJson ? { envJson } : {}),
			...(oauthClientId ? { accountId: oauthClientId } : {}),
			...(oauthClientSecret ? { oauthClientSecret } : {}),
			token: args.oauthAccessToken,
			...(oauthRefreshToken ? { oauthRefreshToken } : {}),
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			createdAt: now,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(id),
			provider: "notion" as const,
			status: "connected" as const,
			displayName,
			endpoint: baseUrl,
			...(oauthClientId ? { oauthClientId } : {}),
		};
	},
});

export const upsertZoom = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.optional(v.string()),
		oauthClientSecret: v.optional(v.string()),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: zoomConnectionSettingsValidator,
	handler: async (ctx, args): Promise<ZoomConnectionSettings> => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const displayName =
			args.displayName.trim() || getDefaultAppConnectionDisplayName("zoom");
		const baseUrl = args.baseUrl.trim();
		const envJson = args.env ? JSON.stringify(args.env) : undefined;
		const oauthClientId = args.oauthClientId?.trim() || undefined;
		const oauthClientSecret = args.oauthClientSecret?.trim() || undefined;
		const oauthRefreshToken = args.oauthRefreshToken?.trim() || undefined;
		const existingConnection = await getOwnedZoomConnection(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (existingConnection) {
			await ctx.db.patch(existingConnection._id, {
				status: "connected",
				displayName,
				baseUrl,
				envJson,
				accountId: oauthClientId,
				oauthClientSecret,
				token: args.oauthAccessToken,
				oauthRefreshToken,
				tokenExpiresAt: args.tokenExpiresAt,
				updatedAt: now,
			});

			return {
				sourceId: toAppSourceId(existingConnection._id),
				provider: "zoom" as const,
				status: "connected" as const,
				displayName,
				endpoint: baseUrl,
				...(oauthClientId ? { oauthClientId } : {}),
			};
		}

		const id = await ctx.db.insert("appConnections", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			provider: "zoom",
			status: "connected",
			displayName,
			baseUrl,
			...(envJson ? { envJson } : {}),
			...(oauthClientId ? { accountId: oauthClientId } : {}),
			...(oauthClientSecret ? { oauthClientSecret } : {}),
			token: args.oauthAccessToken,
			...(oauthRefreshToken ? { oauthRefreshToken } : {}),
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			createdAt: now,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(id),
			provider: "zoom" as const,
			status: "connected" as const,
			displayName,
			endpoint: baseUrl,
			...(oauthClientId ? { oauthClientId } : {}),
		};
	},
});

const toRemoteHeaderMcpConnectionSettings = (
	id: Id<"appConnections">,
	provider: RemoteHeaderMcpProvider,
	displayName: string,
	endpoint: string,
): RemoteHeaderMcpConnectionSettings => ({
	sourceId: toAppSourceId(id),
	provider,
	status: "connected",
	displayName,
	endpoint,
});

const upsertRemoteHeaderMcpConnection = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		displayName: string;
		baseUrl: string;
		env?: Record<string, string>;
	},
	provider: RemoteHeaderMcpProvider,
) => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	const now = Date.now();
	const displayName =
		args.displayName.trim() || getDefaultAppConnectionDisplayName(provider);
	const baseUrl = args.baseUrl.trim();
	const envJson = args.env ? JSON.stringify(args.env) : undefined;
	const existingConnection = await getOwnedRemoteHeaderMcpConnection(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		provider,
	);

	if (existingConnection) {
		await ctx.db.patch(existingConnection._id, {
			status: "connected",
			displayName,
			baseUrl,
			envJson,
			updatedAt: now,
		});

		return toRemoteHeaderMcpConnectionSettings(
			existingConnection._id,
			provider,
			displayName,
			baseUrl,
		);
	}

	const id = await ctx.db.insert("appConnections", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		provider,
		status: "connected",
		displayName,
		baseUrl,
		...(envJson ? { envJson } : {}),
		createdAt: now,
		updatedAt: now,
	});

	return toRemoteHeaderMcpConnectionSettings(
		id,
		provider,
		displayName,
		baseUrl,
	);
};

const upsertMcpOAuthConnection = async <TProvider extends "figma" | "linear">(
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		displayName: string;
		baseUrl: string;
		env?: Record<string, string>;
		oauthClientId: string;
		oauthClientSecret?: string;
		oauthAccessToken: string;
		oauthRefreshToken?: string;
		tokenExpiresAt?: number;
	},
	provider: TProvider,
): Promise<
	TProvider extends "figma" ? FigmaConnectionSettings : LinearConnectionSettings
> => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	const now = Date.now();
	const displayName =
		args.displayName.trim() || getDefaultAppConnectionDisplayName(provider);
	const baseUrl = args.baseUrl.trim();
	const envJson = args.env ? JSON.stringify(args.env) : undefined;
	const oauthClientId = args.oauthClientId.trim();
	const oauthClientSecret = args.oauthClientSecret?.trim() || undefined;
	const oauthRefreshToken = args.oauthRefreshToken?.trim() || undefined;
	const existingConnection =
		provider === "figma"
			? await getOwnedFigmaConnection(
					ctx,
					args.ownerTokenIdentifier,
					args.workspaceId,
				)
			: await getOwnedLinearConnection(
					ctx,
					args.ownerTokenIdentifier,
					args.workspaceId,
				);

	if (existingConnection) {
		await ctx.db.patch(existingConnection._id, {
			status: "connected",
			displayName,
			baseUrl,
			envJson,
			accountId: oauthClientId,
			oauthClientSecret,
			token: args.oauthAccessToken,
			...(oauthRefreshToken ? { oauthRefreshToken } : {}),
			tokenExpiresAt: args.tokenExpiresAt,
			updatedAt: now,
		});

		return {
			sourceId: toAppSourceId(existingConnection._id),
			provider,
			status: "connected" as const,
			displayName,
			endpoint: baseUrl,
			oauthClientId,
		} as TProvider extends "figma"
			? FigmaConnectionSettings
			: LinearConnectionSettings;
	}

	const id = await ctx.db.insert("appConnections", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		provider,
		status: "connected",
		displayName,
		baseUrl,
		...(envJson ? { envJson } : {}),
		accountId: oauthClientId,
		...(oauthClientSecret ? { oauthClientSecret } : {}),
		token: args.oauthAccessToken,
		...(oauthRefreshToken ? { oauthRefreshToken } : {}),
		...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
		createdAt: now,
		updatedAt: now,
	});

	return {
		sourceId: toAppSourceId(id),
		provider,
		status: "connected" as const,
		displayName,
		endpoint: baseUrl,
		oauthClientId,
	} as TProvider extends "figma"
		? FigmaConnectionSettings
		: LinearConnectionSettings;
};

export const upsertContext7 = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
	},
	returns: context7ConnectionSettingsValidator,
	handler: async (ctx, args): Promise<Context7ConnectionSettings> =>
		(await upsertRemoteHeaderMcpConnection(
			ctx,
			args,
			"context7",
		)) as Context7ConnectionSettings,
});

export const upsertFigma = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.string(),
		oauthClientSecret: v.optional(v.string()),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: figmaConnectionSettingsValidator,
	handler: async (ctx, args): Promise<FigmaConnectionSettings> =>
		await upsertMcpOAuthConnection(ctx, args, "figma"),
});

export const upsertLinear = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.string(),
		oauthClientSecret: v.optional(v.string()),
		oauthAccessToken: v.string(),
		oauthRefreshToken: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
	},
	returns: linearConnectionSettingsValidator,
	handler: async (ctx, args): Promise<LinearConnectionSettings> =>
		await upsertMcpOAuthConnection(ctx, args, "linear"),
});

const removeExpiredMcpOAuthStates = async (ctx: MutationCtx, now: number) => {
	const expiredStates = await ctx.db
		.query("mcpOAuthStates")
		.withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
		.take(50);

	await Promise.all(expiredStates.map((state) => ctx.db.delete(state._id)));
};

export const createMcpOAuthState = internalMutation({
	args: {
		provider: mcpOAuthProviderValidator,
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		displayName: v.string(),
		baseUrl: v.string(),
		env: v.optional(v.record(v.string(), v.string())),
		oauthClientId: v.string(),
		oauthClientSecret: v.optional(v.string()),
		oauthTokenEndpoint: v.optional(v.string()),
		codeVerifier: v.optional(v.string()),
		state: v.string(),
		expiresAt: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireOwnedWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		await removeExpiredMcpOAuthStates(ctx, now);

		await ctx.db.insert("mcpOAuthStates", {
			provider: args.provider,
			state: args.state,
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			displayName:
				args.displayName.trim() ||
				getDefaultAppConnectionDisplayName(args.provider),
			baseUrl: args.baseUrl.trim(),
			...(args.env ? { envJson: JSON.stringify(args.env) } : {}),
			oauthClientId: args.oauthClientId.trim(),
			...(args.oauthClientSecret
				? { oauthClientSecret: args.oauthClientSecret.trim() }
				: {}),
			...(args.oauthTokenEndpoint
				? { oauthTokenEndpoint: args.oauthTokenEndpoint.trim() }
				: {}),
			...(args.codeVerifier ? { codeVerifier: args.codeVerifier } : {}),
			expiresAt: args.expiresAt,
			createdAt: now,
		});

		return null;
	},
});

export const consumeMcpOAuthState = internalMutation({
	args: {
		provider: mcpOAuthProviderValidator,
		state: v.string(),
	},
	returns: v.union(
		v.object({
			provider: mcpOAuthProviderValidator,
			state: v.string(),
			ownerTokenIdentifier: v.string(),
			workspaceId: v.id("workspaces"),
			displayName: v.string(),
			baseUrl: v.string(),
			envJson: v.optional(v.string()),
			oauthClientId: v.string(),
			oauthClientSecret: v.optional(v.string()),
			oauthTokenEndpoint: v.optional(v.string()),
			codeVerifier: v.optional(v.string()),
			expiresAt: v.number(),
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		const state = await ctx.db
			.query("mcpOAuthStates")
			.withIndex("by_state", (q) => q.eq("state", args.state))
			.unique();

		if (!state || state.provider !== args.provider) {
			return null;
		}

		await ctx.db.delete(state._id);

		return {
			provider: state.provider,
			state: state.state,
			ownerTokenIdentifier: state.ownerTokenIdentifier,
			workspaceId: state.workspaceId,
			displayName: state.displayName,
			baseUrl: state.baseUrl,
			...(state.envJson ? { envJson: state.envJson } : {}),
			oauthClientId: state.oauthClientId,
			...(state.oauthClientSecret
				? { oauthClientSecret: state.oauthClientSecret }
				: {}),
			...(state.oauthTokenEndpoint
				? { oauthTokenEndpoint: state.oauthTokenEndpoint }
				: {}),
			...(state.codeVerifier ? { codeVerifier: state.codeVerifier } : {}),
			expiresAt: state.expiresAt,
		};
	},
});

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteConnectionBatchForWorkspace(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.appConnections.removeAllForWorkspace,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
					workspaceId: args.workspaceId,
				},
			);
		}

		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteConnectionBatchForOwner(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.appConnections.removeAllForOwner,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
				},
			);
		}

		return null;
	},
});
