import { describe, expect, it } from "vitest";
import { buildChatAutomationContext } from "../../../packages/ai/src/automation-tools.mjs";
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
			automationActions: {
				createAutomation: async (automation) => {
					automations.push(automation);
					return null;
				},
				deleteAutomation: async () => null,
				getAutomation: async () => null,
				listAutomations: async () => [],
				runAutomationNow: async () => ({ status: "started" }),
				togglePaused: async () => null,
				updateAutomation: async () => null,
			},
			chatAttachmentsApi: {},
			chatId: "chat-1",
			convexClient,
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
		expect(Object.keys(context.tools)).toEqual(
			expect.arrayContaining([
				"create_automation",
				"delete_automation",
				"get_automation",
				"list_automations",
				"pause_automation",
				"resume_automation",
				"run_automation_now",
				"update_automation",
			]),
		);
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

describe("chat automation tools", () => {
	const automation = {
		id: "automation-1",
		title: "Daily review",
		prompt: "Review the workspace.",
		model: "gpt-5",
		reasoningEffort: "medium",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		schedulePeriod: "daily",
		scheduledAt: 2_000,
		timezone: "UTC",
		target: {
			kind: "workspace",
			label: "Workspace",
		},
		nextRunAt: 86_400_000,
		isPaused: false,
		chatId: "chat-1",
	};

	const createAutomationContext = (overrides = {}) =>
		buildChatAutomationContext({
			appConnections: [],
			automationActions: {
				createAutomation: async (input) => ({ ...automation, ...input }),
				deleteAutomation: async () => null,
				getAutomation: async () => automation,
				listAutomations: async () => [automation],
				runAutomationNow: async () => ({
					status: "started",
					chatId: automation.chatId,
				}),
				togglePaused: async () => ({
					...automation,
					isPaused: !automation.isPaused,
				}),
				updateAutomation: async (input) => ({ ...automation, ...input }),
				...overrides,
			},
			chatId: "chat-1",
			defaultModel: "gpt-5",
			defaultReasoningEffort: "medium",
			defaultTimezone: "UTC",
			webSearchEnabled: false,
		});

	it("exposes hosted automation management tools", () => {
		const context = createAutomationContext();

		expect(Object.keys(context.tools).sort()).toEqual([
			"create_automation",
			"delete_automation",
			"get_automation",
			"list_automations",
			"pause_automation",
			"resume_automation",
			"run_automation_now",
			"update_automation",
		]);
	});

	it("updates automations while preserving unspecified fields", async () => {
		const updateInputs: unknown[] = [];
		const context = createAutomationContext({
			updateAutomation: async (input: unknown) => {
				updateInputs.push(input);
				return {
					...automation,
					...(input as Record<string, unknown>),
				};
			},
		});

		const result = await context.tools.update_automation.execute?.({
			automationId: "automation-1",
			title: "Updated review",
		});

		expect(updateInputs).toEqual([
			expect.objectContaining({
				automationId: "automation-1",
				title: "Updated review",
				prompt: automation.prompt,
				schedulePeriod: automation.schedulePeriod,
				scheduledAt: automation.scheduledAt,
			}),
		]);
		expect(result).toMatchObject({
			id: automation.id,
			title: "Updated review",
		});
	});

	it("does not toggle pause or resume when already in the requested state", async () => {
		let toggleCount = 0;
		const pausedAutomation = { ...automation, isPaused: true };
		const context = createAutomationContext({
			getAutomation: async () => pausedAutomation,
			togglePaused: async () => {
				toggleCount += 1;
				return { ...pausedAutomation, isPaused: false };
			},
		});

		const pauseResult = await context.tools.pause_automation.execute?.({
			automationId: "automation-1",
		});
		const resumeResult = await context.tools.resume_automation.execute?.({
			automationId: "automation-1",
		});

		expect(toggleCount).toBe(1);
		expect(pauseResult).toMatchObject({ isPaused: true });
		expect(resumeResult).toMatchObject({ isPaused: false });
	});

	it("requires explicit delete wording for deletion", async () => {
		let deleteCount = 0;
		const context = createAutomationContext({
			deleteAutomation: async () => {
				deleteCount += 1;
				return null;
			},
		});

		await expect(
			context.tools.delete_automation.execute?.({
				automationId: "automation-1",
				confirmationText: "change it",
			}),
		).rejects.toThrow(/requires an explicit delete or remove/u);

		await expect(
			context.tools.delete_automation.execute?.({
				automationId: "automation-1",
				confirmationText: "delete this automation",
			}),
		).resolves.toMatchObject({
			confirmation: expect.objectContaining({
				kind: "delete_automation",
				title: "Delete automation?",
			}),
			id: "automation-1",
			requiresConfirmation: true,
		});
		expect(deleteCount).toBe(0);

		await expect(
			context.tools.delete_automation.execute?.({
				automationId: "automation-1",
				confirmed: true,
				confirmationText: "delete this automation",
			}),
		).resolves.toMatchObject({
			id: "automation-1",
			deleted: true,
		});
		expect(deleteCount).toBe(1);
	});
});
