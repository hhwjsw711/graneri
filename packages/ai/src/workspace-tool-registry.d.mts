import type { ToolSet } from "ai";
import type { Context7McpToolConnection } from "./context7-tools.mjs";
import type { FigmaMcpToolConnection } from "./figma-tools.mjs";
import type { JiraMcpToolConnection } from "./jira-mcp-tools.mjs";
import type { LinearMcpToolConnection } from "./linear-tools.mjs";
import type { NotionMcpToolConnection } from "./notion-tools.mjs";
import type { PostHogMcpToolConnection } from "./posthog-tools.mjs";
import type { YandexTrackerToolConnection } from "./yandex-tracker-tools.mjs";
import type { ZoomMcpToolConnection } from "./zoom-mcp-tools.mjs";

export type YandexCalendarToolConnection = {
	sourceId: string;
	provider: "yandex-calendar";
	displayName: string;
	email: string;
	password: string;
	serverAddress: string;
	calendarHomePath: string;
};

export type GoogleCalendarToolConnection = {
	id: string;
	provider: "google-calendar";
	title: string;
	preview: string;
};

export type GoogleDriveToolConnection = {
	id: string;
	provider: "google-drive";
	title: string;
	preview: string;
};

export type WorkspaceToolConnection =
	| Context7McpToolConnection
	| FigmaMcpToolConnection
	| JiraMcpToolConnection
	| LinearMcpToolConnection
	| NotionMcpToolConnection
	| PostHogMcpToolConnection
	| YandexTrackerToolConnection
	| YandexCalendarToolConnection
	| GoogleCalendarToolConnection
	| GoogleDriveToolConnection
	| ZoomMcpToolConnection;

export type WorkspaceToolAdapters = {
	googleCalendar?: {
		listEvents(args: {
			limit?: number;
			meetingsOnly?: boolean;
		}): Promise<unknown>;
		searchEvents(args: {
			query: string;
			limit?: number;
			meetingsOnly?: boolean;
		}): Promise<unknown>;
	};
	googleDrive?: {
		searchFiles(args: { query: string; limit?: number }): Promise<unknown>;
		getFile(args: { fileId: string }): Promise<unknown>;
	};
	yandexCalendar?: (connection: YandexCalendarToolConnection) => {
		listUpcomingEvents(args: { lookaheadMs: number }): Promise<{
			connection: string;
			events: unknown[];
		}>;
	};
};

export declare function normalizeWorkspaceCalendarEvents(
	events: unknown[],
	args?: { limit?: number; meetingsOnly?: boolean; query?: string },
): unknown[];

export declare function buildWorkspaceCalendarSources(
	events: unknown[],
): unknown[];

export declare function getWorkspaceCalendarLookaheadMs(): number;

export declare function buildWorkspaceToolSet(
	connections: WorkspaceToolConnection[],
	adapters?: WorkspaceToolAdapters,
): Promise<ToolSet>;
