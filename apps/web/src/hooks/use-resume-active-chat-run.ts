import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import { logError } from "@/lib/logger";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type AttachableRun =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;

const resumeRunPromises = new Map<string, Promise<void>>();

export const useResumeActiveChatRun = ({
	activeRun,
	chatId,
	enabled = true,
	resumeStream,
	workspaceId,
}: {
	activeRun: AttachableRun;
	chatId: string;
	enabled?: boolean;
	resumeStream: () => Promise<void>;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const resumedRunKeyRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;

		if (!workspaceId || !enabled || !activeRun) {
			if (!workspaceId || !enabled) {
				resumedRunKeyRef.current = null;
			}
			return () => {
				cancelled = true;
			};
		}

		const runKey = `${workspaceId}:${chatId}:${activeRun._id}`;
		if (resumedRunKeyRef.current === runKey || resumeRunPromises.has(runKey)) {
			return () => {
				cancelled = true;
			};
		}

		resumedRunKeyRef.current = runKey;
		const resumePromise = resumeStream()
			.catch((error: unknown) => {
				if (!cancelled && resumedRunKeyRef.current === runKey) {
					resumedRunKeyRef.current = null;
				}
				logError({
					event: "client.error",
					error: error,
					message: "Failed to resume active chat run",
				});
			})
			.finally(() => {
				if (resumeRunPromises.get(runKey) === resumePromise) {
					resumeRunPromises.delete(runKey);
				}
			});
		resumeRunPromises.set(runKey, resumePromise);

		return () => {
			cancelled = true;
		};
	}, [activeRun, chatId, enabled, resumeStream, workspaceId]);
};
