import type { UIMessage } from "ai";
import * as React from "react";
import type { Id } from "../../../../convex/_generated/dataModel";

type AttachableRun = {
	_id: Id<"assistantRuns">;
	assistantMessageId: string;
};

const resumeRunPromises = new Map<string, Promise<void>>();

export const useResumeActiveChatRun = ({
	activeRun,
	chatId,
	enabled = true,
	resumeStream,
	setMessages,
	workspaceId,
}: {
	activeRun: AttachableRun | null | undefined;
	chatId: string;
	enabled?: boolean;
	resumeStream: () => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
	workspaceId: Id<"workspaces"> | null | undefined;
}) => {
	const resumedRunKeyRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		if (!workspaceId || !enabled || !activeRun) {
			if (!workspaceId || !enabled) {
				resumedRunKeyRef.current = null;
			}
			return;
		}

		const runKey = `${workspaceId}:${chatId}:${activeRun._id}`;
		if (resumedRunKeyRef.current === runKey || resumeRunPromises.has(runKey)) {
			return;
		}

		resumedRunKeyRef.current = runKey;
		setMessages((currentMessages) =>
			currentMessages.filter(
				(message) => message.id !== activeRun.assistantMessageId,
			),
		);
		const resumePromise = resumeStream()
			.catch((error: unknown) => {
				if (resumedRunKeyRef.current === runKey) {
					resumedRunKeyRef.current = null;
				}
				console.error("Failed to resume active chat run", error);
			})
			.finally(() => {
				if (resumeRunPromises.get(runKey) === resumePromise) {
					resumeRunPromises.delete(runKey);
				}
			});
		resumeRunPromises.set(runKey, resumePromise);
	}, [activeRun, chatId, enabled, resumeStream, setMessages, workspaceId]);
};
