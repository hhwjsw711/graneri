import { describe, expect, it } from "vitest";
import {
	type ConnectionQueryResults,
	connectionsSettingsReducer,
	createStableConnectionSettingsStore,
	getStableConnectionSettingsKey,
	initialConnectionsSettingsState,
	type JiraConnectionSettings,
	resolveConnectionSettings,
} from "@/components/settings/connection-settings-state";

const emptyResults: ConnectionQueryResults = {
	yandexTracker: undefined,
	yandexCalendar: undefined,
	context7: undefined,
	figma: undefined,
	linear: undefined,
	jira: undefined,
	jiraMcp: undefined,
	posthog: undefined,
	notion: undefined,
	zoom: undefined,
};

const jiraConnection: JiraConnectionSettings = {
	sourceId: "jira-source",
	provider: "jira",
	status: "connected",
	displayName: "Jira Sync",
	baseUrl: "https://example.atlassian.net",
	email: "owner@example.com",
};

describe("connection settings state", () => {
	it("resolves undefined query results from cached settings and preserves null disconnects", () => {
		const cachedSettings = resolveConnectionSettings({
			results: {
				...emptyResults,
				jira: jiraConnection,
			},
		});

		const loadingSettings = resolveConnectionSettings({
			cachedSettings,
			results: emptyResults,
		});

		expect(loadingSettings.jira).toBe(jiraConnection);

		const disconnectedSettings = resolveConnectionSettings({
			cachedSettings,
			results: {
				...emptyResults,
				jira: null,
			},
		});

		expect(disconnectedSettings.jira).toBeNull();
	});

	it("stores stable connection settings per user workspace key", () => {
		const store = createStableConnectionSettingsStore();
		const firstKey = getStableConnectionSettingsKey({
			email: "owner@example.com",
			workspaceId: "workspace-1",
		});
		const secondKey = getStableConnectionSettingsKey({
			email: "owner@example.com",
			workspaceId: "workspace-2",
		});

		expect(firstKey).toBe("owner@example.com:workspace-1");
		expect(secondKey).toBe("owner@example.com:workspace-2");
		expect(
			getStableConnectionSettingsKey({
				email: null,
				workspaceId: "workspace-1",
			}),
		).toBeNull();

		if (!firstKey || !secondKey) {
			throw new Error("expected stable keys");
		}

		store.update(firstKey, {
			...emptyResults,
			jira: jiraConnection,
		});
		store.update(secondKey, emptyResults);

		expect(store.get(firstKey)?.jira).toBe(jiraConnection);
		expect(store.get(secondKey)?.jira).toBeNull();
	});

	it("patches only the targeted remote MCP form state", () => {
		const state = connectionsSettingsReducer(initialConnectionsSettingsState, {
			type: "patchRemoteMcpFormState",
			key: "figmaFormState",
			value: {
				name: "Figma OAuth",
				oauthClientId: "client-id",
			},
		});

		expect(state.figmaFormState).toMatchObject({
			name: "Figma OAuth",
			baseUrl: initialConnectionsSettingsState.figmaFormState.baseUrl,
			oauthClientId: "client-id",
		});
		expect(state.linearFormState).toBe(
			initialConnectionsSettingsState.linearFormState,
		);
	});
});
