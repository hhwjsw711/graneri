import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
	"cleanup expired trash",
	"0 2 * * *",
	internal.trash.cleanupExpiredItems,
	{},
);

crons.interval(
	"reconcile due automations",
	{ minutes: 1 },
	internal.automations.reconcileDueAutomations,
	{},
);

crons.interval(
	"cleanup expired assistant runs",
	{ minutes: 1 },
	internal.assistantRuns.cleanupExpiredAssistantRuns,
	{},
);

export default crons;
