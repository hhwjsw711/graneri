import { describe, expect, it } from "vitest";
import {
	buildHostedChatRunContext,
	getHostedChatLocalFolderReferenceIds,
	getHostedChatLocalFolderReferencePaths,
} from "../../../packages/ai/src/hosted-chat-run-context.mjs";

describe("hosted chat run context", () => {
	it("extracts web local folder paths and desktop local folder ids", () => {
		const folders = [
			{ id: "folder-1", path: "/tmp/one" },
			{ id: "", path: "" },
			{ id: "folder-2" },
			{ path: "/tmp/two" },
		];

		expect(getHostedChatLocalFolderReferencePaths(folders)).toEqual([
			"/tmp/one",
			"/tmp/two",
		]);
		expect(getHostedChatLocalFolderReferenceIds(folders)).toEqual([
			"folder-1",
			"folder-2",
		]);
	});

	it("loads sources, builds tools, and preserves route-owned local folder resolution", async () => {
		const latencyStages: string[] = [];
		const automations: unknown[] = [];
		const localFolderArguments: unknown[] = [];
		const convexClient = {
			query: async () => null,
			mutation: async () => null,
		};

		const context = await buildHostedChatRunContext({
			appsEnabled: false,
			chatAttachmentsApi: {},
			chatId: "chat-1",
			convexClient,
			createAutomation: async (automation) => {
				automations.push(automation);
				return null;
			},
			defaultModel: "gpt-5",
			defaultReasoningEffort: "medium",
			defaultTimezone: "UTC",
			getActiveStreamSession: () => null,
			getNotesContext: async () => "notes",
			getSelectedAppConnections: async () => {
				throw new Error(
					"app connections should not load when apps are disabled",
				);
			},
			getSelectedRecipe: async () => ({
				name: "Daily",
				prompt: "Summarize the day.",
			}),
			getStoredNoteContext: async () => "stored note",
			getUserProfileContext: async () => ({ name: "Murad" }),
			localFolders: [{ id: "folder-1", path: "/tmp/project" }],
			logLatency: (stage) => latencyStages.push(stage),
			message: {
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Use the project" }],
			},
			noteId: "note-1",
			resolveLocalFolderRoots: (folders) => {
				localFolderArguments.push(folders);
				return [{ id: "folder-1", name: "Project", path: "/tmp/project" }];
			},
			selectedSourceIds: ["source-1"],
			workspaceId: "workspace-1",
		});

		expect(context.localFolderRoots).toEqual([
			{ id: "folder-1", name: "Project", path: "/tmp/project" },
		]);
		expect(context.selectedAppConnections).toHaveLength(0);
		expect(context.finalizedToolSet.hasTools).toBe(true);
		expect(context.systemPrompt).toContain("stored note");
		expect(context.systemPrompt).toContain("Project");
		expect(localFolderArguments).toEqual([
			[{ id: "folder-1", path: "/tmp/project" }],
		]);
		expect(automations).toEqual([]);
		expect(latencyStages).toEqual([
			"context.sources_loaded",
			"tools.workspace_ready",
			"tools.finalized",
		]);
	});
});
