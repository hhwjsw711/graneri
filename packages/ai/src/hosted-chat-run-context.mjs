import { buildChatAutomationContext } from "./automation-tools.mjs";
import { buildSelectedAppSourceInstructions } from "./capability-metadata.mjs";
import { buildCoreChatToolPolicy } from "./chat-tool-policy.mjs";
import { buildConvexWorkspaceToolSet } from "./convex-workspace-tools.mjs";
import { buildHostedChatRunPlan } from "./hosted-chat-run-plan.mjs";
import {
	getHostedChatRecipeContext,
	getInlineHostedNoteContext,
} from "./hosted-chat-runtime.mjs";
import { createHostedWaitAgentTool } from "./hosted-chat-wait-agent-tool.mjs";
import {
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
} from "./local-folder-tools.mjs";

export const getHostedChatLocalFolderReferencePaths = (localFolders = []) =>
	localFolders.reduce((paths, folder) => {
		if (typeof folder?.path === "string" && folder.path.length > 0) {
			paths.push(folder.path);
		}
		return paths;
	}, []);

export const getHostedChatLocalFolderReferenceIds = (localFolders = []) =>
	localFolders
		.map((folder) => folder?.id)
		.filter((id) => typeof id === "string" && id.length > 0);

export const buildHostedChatRunContext = async ({
	appsEnabled = false,
	automationActions,
	chatAttachmentsApi,
	chatId,
	convexClient,
	defaultModel,
	defaultReasoningEffort,
	defaultTimezone,
	getActiveStreamSession,
	getNotesContext,
	getSelectedAppConnections,
	getSelectedRecipe,
	getStoredNoteContext,
	getUserProfileContext,
	localFolders = [],
	logLatency,
	message,
	noteContext,
	noteId,
	providerOptions,
	recipeSlug,
	resolveLocalFolderRoots,
	selectedSourceIds = [],
	webSearchEnabled = false,
	workspaceId,
}) => {
	const notesContext = await getNotesContext();
	const attachedNoteContext = noteId
		? await getStoredNoteContext({ noteId, workspaceId })
		: getInlineHostedNoteContext({
				title: noteContext?.title,
				text: noteContext?.text,
			});
	const selectedRecipe = await getSelectedRecipe({ recipeSlug, workspaceId });
	const recipeContext = getHostedChatRecipeContext(selectedRecipe);
	const userProfileContext = await getUserProfileContext();
	const selectedAppConnections = appsEnabled
		? await getSelectedAppConnections({
				selectedSourceIds,
				workspaceId,
			})
		: [];
	const selectedAppSourceInstructions = buildSelectedAppSourceInstructions(
		selectedAppConnections,
	);
	logLatency("context.sources_loaded", {
		appConnectionCount: selectedAppConnections.length,
		hasAttachedNoteContext: attachedNoteContext.length > 0,
		hasNotesContext: notesContext.length > 0,
		hasRecipeContext: recipeContext.length > 0,
		hasUserProfileContext: Boolean(userProfileContext),
	});

	const appTools = await buildConvexWorkspaceToolSet({
		connections: selectedAppConnections,
		convexClient,
		workspaceId,
	});
	const localFolderRoots = await resolveLocalFolderRoots(localFolders);
	const localFolderContext = buildLocalFolderSystemContext(localFolderRoots);
	logLatency("tools.workspace_ready", {
		appToolCount: Object.keys(appTools).length,
		localFolderCount: localFolderRoots.length,
	});

	const coreToolPolicy = buildCoreChatToolPolicy({
		chatAttachmentsApi,
		convexClient,
		message,
		webSearchEnabled,
	});
	const automationContext = buildChatAutomationContext({
		appConnections: selectedAppConnections,
		automationActions,
		chatId,
		defaultModel,
		defaultReasoningEffort,
		defaultTimezone,
		webSearchEnabled,
	});
	const runPlan = buildHostedChatRunPlan({
		additionalAgentTools: {
			wait_agent: createHostedWaitAgentTool({
				getActiveStreamSession,
			}),
		},
		appTools,
		automationContext,
		context: {
			notesContext,
			attachedNoteContext,
			recipeContext,
			userProfileContext,
		},
		coreToolPolicy,
		localFolderContext,
		localFolderTools:
			localFolderRoots.length > 0
				? buildLocalFolderTools(localFolderRoots)
				: {},
		model: defaultModel,
		providerOptions,
		selectedAppSourceInstructions,
		webSearchEnabled,
	});
	logLatency("tools.finalized", {
		deferredToolCount: runPlan.finalizedToolSet.deferredToolCount,
		hasEnabledTools: runPlan.finalizedToolSet.hasTools,
		hasToolSearch: runPlan.finalizedToolSet.hasToolSearch,
		toolCount: runPlan.finalizedToolSet.toolCount,
	});

	return {
		...runPlan,
		localFolderRoots,
		selectedAppConnections,
	};
};
