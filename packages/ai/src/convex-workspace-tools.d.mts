import type { ConvexHttpClient } from "convex/browser";
import type { ToolSet } from "ai";
import type { Id } from "../../../convex/_generated/dataModel";
import type { WorkspaceToolConnection } from "./capability-registry.mjs";

export declare function buildConvexWorkspaceToolSet(args: {
	connections: WorkspaceToolConnection[];
	convexClient: ConvexHttpClient | null;
	workspaceId: Id<"workspaces"> | null;
}): Promise<ToolSet>;
