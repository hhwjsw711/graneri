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
	const [googleSourcesError, setGoogleSourcesError] =
		React.useState<unknown>(null);

	// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
	React.useEffect(() => {
		let cancelled = false;

		if (!workspaceId) {
			// react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change
			setGoogleSources([]);
			setGoogleSourcesError(null);
			return () => {
				cancelled = true;
			};
		}

		void listGoogleSources({ workspaceId })
			.then((sources) => {
				if (!cancelled) {
					setGoogleSources(sources);
					setGoogleSourcesError(null);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setGoogleSourcesError(error);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [listGoogleSources, workspaceId]);

	const sources = React.useMemo(
		() => [...googleSources, ...(connectionSources ?? [])],
		[connectionSources, googleSources],
	);

	if (googleSourcesError) {
		throw googleSourcesError;
	}

	return sources;
}
