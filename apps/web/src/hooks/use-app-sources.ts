import { useAction, useQuery } from "convex/react";
import * as React from "react";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type AppSource = {
	id: string;
	title: string;
	preview: string;
	provider: ChatAppSourceProvider;
};

export function useAppSources(
	workspaceId: Id<"workspaces"> | null | undefined,
) {
	const connectionSources = useQuery(
		api.appConnections.listSources,
		workspaceId ? { workspaceId } : "skip",
	);
	const listGoogleSources = useAction(api.googleTools.listAvailableSources);
	const [googleSources, setGoogleSources] = React.useState<AppSource[]>([]);

	// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
	React.useEffect(() => {
		let cancelled = false;

		if (!workspaceId) {
			// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
			setGoogleSources([]);
			return () => {
				cancelled = true;
			};
		}

		void listGoogleSources({ workspaceId })
			.catch(() => [])
			.then((sources) => {
				if (!cancelled) {
					setGoogleSources(sources);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [listGoogleSources, workspaceId]);

	return React.useMemo(
		() => [...googleSources, ...(connectionSources ?? [])],
		[connectionSources, googleSources],
	);
}
