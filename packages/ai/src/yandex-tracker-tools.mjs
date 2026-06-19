import { z } from "zod";
import { buildAiToolSet, defineAiTool } from "./ai-tool-definition.mjs";
import { toolUiMetadata } from "./tool-ui-metadata.mjs";

const env =
	typeof globalThis.process === "object" &&
	globalThis.process !== null &&
	typeof globalThis.process.env === "object" &&
	globalThis.process.env !== null
		? globalThis.process.env
		: {};

const TRACKER_API_BASE_URL =
	env.TRACKER_API_BASE_URL ?? "https://api.tracker.yandex.net";
const TRACKER_HOST_BASE_URL =
	env.TRACKER_HOST_BASE_URL ?? "https://tracker.yandex.ru";

const getYandexTrackerOrgHeader = (orgType) =>
	orgType === "x-cloud-org-id" ? "X-Cloud-Org-Id" : "X-Org-Id";

const buildYandexTrackerUrl = (baseUrl, pathname, query) => {
	const url = new URL(pathname, baseUrl);

	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value) {
				url.searchParams.set(key, value);
			}
		}
	}

	return url;
};

const trackerHeaders = (connection) => ({
	Authorization: `OAuth ${connection.token}`,
	[getYandexTrackerOrgHeader(connection.orgType)]: connection.orgId,
});

const toIssueUrl = (key) =>
	buildYandexTrackerUrl(
		TRACKER_HOST_BASE_URL,
		`/issue/${encodeURIComponent(key)}`,
	).toString();

const normalizeIssue = (issue) => {
	if (!issue.key || typeof issue.key !== "string") {
		return null;
	}

	const status =
		issue.status && typeof issue.status === "object" && issue.status !== null
			? typeof issue.status.display === "string"
				? issue.status.display
				: typeof issue.status.key === "string"
					? issue.status.key
					: undefined
			: undefined;
	const assignee =
		issue.assignee &&
		typeof issue.assignee === "object" &&
		issue.assignee !== null
			? typeof issue.assignee.display === "string"
				? issue.assignee.display
				: typeof issue.assignee.login === "string"
					? issue.assignee.login
					: undefined
			: undefined;

	return {
		key: issue.key,
		summary:
			typeof issue.summary === "string" && issue.summary.trim()
				? issue.summary
				: issue.key,
		status,
		assignee,
		url: toIssueUrl(issue.key),
	};
};

const trackerRequest = async (connection, method, pathname, options = {}) => {
	const response = await fetch(
		buildYandexTrackerUrl(TRACKER_API_BASE_URL, pathname, options.query),
		{
			method,
			headers: {
				...trackerHeaders(connection),
				...(options.body ? { "Content-Type": "application/json" } : null),
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		},
	);

	if (!response.ok) {
		const responseText = await response.text().catch(() => "");
		throw new Error(
			responseText.trim()
				? `Tracker request failed: ${responseText.trim()}`
				: `Tracker request failed (${response.status}).`,
		);
	}

	return await response.json();
};

export const searchYandexTrackerIssues = async (connection, query, limit = 5) => {
	const issues = await trackerRequest(
		connection,
		"POST",
		"/v3/issues/_search",
		{
			query: {
				perPage: String(limit),
			},
			body: {
				query,
			},
		},
	);
	const normalizedIssues = issues.map(normalizeIssue).filter(Boolean);

	return {
		connection: connection.displayName,
		issues: normalizedIssues,
		sources: normalizedIssues.map((issue) => ({
			type: "url",
			url: issue.url,
			title: issue.key,
		})),
	};
};

export const getYandexTrackerIssue = async (connection, issueKey) => {
	const issue = normalizeIssue(
		await trackerRequest(
			connection,
			"GET",
			`/v3/issues/${encodeURIComponent(issueKey)}`,
		),
	);

	if (!issue) {
		throw new Error("Tracker issue was not found.");
	}

	return {
		connection: connection.displayName,
		issue,
		sources: [
			{
				type: "url",
				url: issue.url,
				title: issue.key,
			},
		],
	};
};

export const buildYandexTrackerToolDefinitions = (connection) => [
	defineAiTool({
		name: "yandex_tracker_search",
		description:
			"Search the selected Yandex Tracker connection for project history, integrations, tickets, tasks, queues, comments, assignees, and status. Use this before saying context is unavailable when the request could plausibly be answered from Tracker.",
		inputSchema: z.object({
			query: z.string().min(1),
			limit: z.number().int().min(1).max(10).optional(),
		}),
		policy: {
			access: "read",
			capability: "search",
			provider: "yandex-tracker",
			requiresConnection: true,
		},
		ui: toolUiMetadata.yandex_tracker_search,
		execute: async ({ query, limit }) =>
			await searchYandexTrackerIssues(connection, query, limit ?? 5),
	}),
	defineAiTool({
		name: "yandex_tracker_get_issue",
		description:
			"Fetch a specific Yandex Tracker issue by key when the user mentions a ticket like PROJ-123 or clearly refers to a known issue key.",
		inputSchema: z.object({
			issueKey: z.string().min(1),
		}),
		policy: {
			access: "read",
			capability: "read",
			provider: "yandex-tracker",
			requiresConnection: true,
		},
		ui: toolUiMetadata.yandex_tracker_get_issue,
		execute: async ({ issueKey }) =>
			await getYandexTrackerIssue(connection, issueKey),
	}),
];

export const buildYandexTrackerTools = (connection) =>
	buildAiToolSet(buildYandexTrackerToolDefinitions(connection));
